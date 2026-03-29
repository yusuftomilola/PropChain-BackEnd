import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StellarConnection {
  id: string;
  horizonUrl: string;
  network: 'mainnet' | 'testnet';
  inUse: boolean;
  createdAt: number;
  lastUsedAt: number;
  errorCount: number;
}

export interface PendingTransaction {
  id: string;
  xdr: string;
  addedAt: number;
  priority: 'low' | 'normal' | 'high';
}

export interface TransactionBatchResult {
  submitted: number;
  failed: number;
  hashes: string[];
  errors: Array<{ id: string; error: string }>;
}

export interface NetworkHealthStatus {
  mainnet: {
    reachable: boolean;
    latencyMs: number;
    lastCheckedAt: string;
  };
  testnet: {
    reachable: boolean;
    latencyMs: number;
    lastCheckedAt: string;
  };
  activeNetwork: 'mainnet' | 'testnet';
}

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StellarOptimizationService
 *
 * Optimises Stellar network interactions through connection pooling,
 * transaction batching, smart exponential-backoff retries, network
 * health monitoring, and automatic testnet failover.
 */
@Injectable()
export class StellarOptimizationService implements OnModuleDestroy {
  private readonly logger = new Logger(StellarOptimizationService.name);

  private readonly pool: Map<string, StellarConnection> = new Map();
  private readonly txQueue: PendingTransaction[] = [];

  private readonly POOL_SIZE = 5;
  private readonly BATCH_SIZE = 10;
  private readonly BATCH_INTERVAL_MS = 2_000;
  private readonly MAX_CONN_ERRORS = 3;
  private readonly HEALTH_CHECK_INTERVAL_MS = 30_000;

  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  private networkHealth: NetworkHealthStatus;
  private activeNetwork: 'mainnet' | 'testnet';

  constructor(private readonly configService: ConfigService) {
    const preferMainnet = this.configService.get<string>('STELLAR_NETWORK') !== 'testnet';
    this.activeNetwork = preferMainnet ? 'mainnet' : 'testnet';

    this.networkHealth = {
      mainnet: { reachable: true, latencyMs: 0, lastCheckedAt: new Date().toISOString() },
      testnet: { reachable: true, latencyMs: 0, lastCheckedAt: new Date().toISOString() },
      activeNetwork: this.activeNetwork,
    };

    this.initPool();
    this.startBatchProcessor();
    this.startHealthMonitor();
  }

  // ── Connection Pool ───────────────────────────────────────────────────────

  /**
   * Acquire a healthy connection from the pool.
   * Returns null if all connections are busy or unhealthy.
   */
  acquireConnection(): StellarConnection | null {
    for (const conn of this.pool.values()) {
      if (!conn.inUse && conn.errorCount < this.MAX_CONN_ERRORS) {
        conn.inUse = true;
        conn.lastUsedAt = Date.now();
        return conn;
      }
    }
    this.logger.warn('No available connections in pool');
    return null;
  }

  /**
   * Release a connection back to the pool.
   * If it has exceeded the error threshold it is replaced.
   */
  releaseConnection(connId: string, hadError = false): void {
    const conn = this.pool.get(connId);
    if (!conn) return;

    if (hadError) conn.errorCount += 1;

    if (conn.errorCount >= this.MAX_CONN_ERRORS) {
      this.logger.warn(`Replacing unhealthy connection ${connId}`);
      this.pool.delete(connId);
      this.pool.set(connId, this.createConnection(connId));
    } else {
      conn.inUse = false;
      this.pool.set(connId, conn);
    }
  }

  /** Current pool utilisation stats. */
  getPoolStats(): { total: number; inUse: number; available: number } {
    const values = Array.from(this.pool.values());
    const inUse = values.filter((c) => c.inUse).length;
    return { total: values.length, inUse, available: values.length - inUse };
  }

  // ── Transaction Batching ──────────────────────────────────────────────────

  /**
   * Queue a signed transaction XDR for batched submission.
   */
  enqueueTransaction(xdr: string, priority: PendingTransaction['priority'] = 'normal'): string {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.txQueue.push({ id, xdr, addedAt: Date.now(), priority });
    this.logger.debug(`Enqueued transaction ${id} (priority=${priority}, queue=${this.txQueue.length})`);
    return id;
  }

  /**
   * Flush the current transaction batch immediately.
   * High-priority transactions are submitted first.
   */
  async flushBatch(): Promise<TransactionBatchResult> {
    if (this.txQueue.length === 0) {
      return { submitted: 0, failed: 0, hashes: [], errors: [] };
    }

    // Sort: high → normal → low
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    this.txQueue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const batch = this.txQueue.splice(0, this.BATCH_SIZE);
    const result: TransactionBatchResult = { submitted: 0, failed: 0, hashes: [], errors: [] };

    for (const tx of batch) {
      try {
        const hash = await this.submitWithRetry(tx.xdr);
        result.submitted += 1;
        result.hashes.push(hash);
      } catch (err: any) {
        result.failed += 1;
        result.errors.push({ id: tx.id, error: err.message });
        this.logger.error(`Batch tx ${tx.id} failed: ${err.message}`);
      }
    }

    this.logger.log(
      `Batch flushed: ${result.submitted} submitted, ${result.failed} failed`,
    );
    return result;
  }

  // ── Retry mechanism ───────────────────────────────────────────────────────

  /**
   * Submit a raw XDR string with exponential back-off retry.
   */
  async submitWithRetry(
    xdr: string,
    options: Partial<RetryOptions> = {},
  ): Promise<string> {
    const opts: RetryOptions = {
      maxAttempts: options.maxAttempts ?? 4,
      initialDelayMs: options.initialDelayMs ?? 500,
      maxDelayMs: options.maxDelayMs ?? 16_000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
    };

    let delay = opts.initialDelayMs;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        const conn = this.acquireConnection();
        if (!conn) throw new Error('No connections available');

        try {
          // Placeholder for actual Stellar SDK submission:
          // const server = new StellarSdk.Server(conn.horizonUrl);
          // const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, conn.network);
          // const result = await server.submitTransaction(tx);
          const mockHash = `hash_${Date.now()}_${attempt}`;
          this.releaseConnection(conn.id);
          this.logger.debug(`Transaction submitted on attempt ${attempt}`);
          return mockHash;
        } catch (err) {
          this.releaseConnection(conn.id, true);
          throw err;
        }
      } catch (err: any) {
        if (attempt === opts.maxAttempts) throw err;

        this.logger.warn(
          `Submit attempt ${attempt}/${opts.maxAttempts} failed. Retrying in ${delay}ms`,
        );
        await this.sleep(delay);
        delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
      }
    }

    throw new Error('Unreachable');
  }

  // ── Network Health Monitoring ─────────────────────────────────────────────

  /**
   * Run a health check against both mainnet and testnet horizon endpoints.
   */
  async checkNetworkHealth(): Promise<NetworkHealthStatus> {
    const mainnetUrl =
      this.configService.get<string>('STELLAR_MAINNET_URL') ??
      'https://horizon.stellar.org';
    const testnetUrl =
      this.configService.get<string>('STELLAR_TESTNET_URL') ??
      'https://horizon-testnet.stellar.org';

    const check = async (url: string) => {
      const start = Date.now();
      try {
        // In production replace with: await fetch(`${url}/`);
        const latencyMs = Date.now() - start + Math.floor(Math.random() * 50); // simulated
        return { reachable: true, latencyMs, lastCheckedAt: new Date().toISOString() };
      } catch {
        return { reachable: false, latencyMs: -1, lastCheckedAt: new Date().toISOString() };
      }
    };

    this.networkHealth.mainnet = await check(mainnetUrl);
    this.networkHealth.testnet = await check(testnetUrl);

    // Auto-failover: if mainnet is down, switch to testnet
    if (!this.networkHealth.mainnet.reachable && this.activeNetwork === 'mainnet') {
      this.logger.warn('Mainnet unreachable — failing over to testnet');
      this.activeNetwork = 'testnet';
      this.networkHealth.activeNetwork = 'testnet';
      this.rebuildPool('testnet');
    } else if (
      this.networkHealth.mainnet.reachable &&
      this.activeNetwork === 'testnet' &&
      this.configService.get<string>('STELLAR_NETWORK') !== 'testnet'
    ) {
      this.logger.log('Mainnet restored — switching back from testnet');
      this.activeNetwork = 'mainnet';
      this.networkHealth.activeNetwork = 'mainnet';
      this.rebuildPool('mainnet');
    }

    return this.networkHealth;
  }

  /** Return the cached network health status. */
  getNetworkHealth(): NetworkHealthStatus {
    return this.networkHealth;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  onModuleDestroy(): void {
    if (this.batchTimer) clearInterval(this.batchTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private initPool(): void {
    for (let i = 0; i < this.POOL_SIZE; i++) {
      const id = `conn_${i}`;
      this.pool.set(id, this.createConnection(id));
    }
    this.logger.log(`Connection pool initialised with ${this.POOL_SIZE} connections`);
  }

  private createConnection(id: string): StellarConnection {
    const isMainnet = this.activeNetwork === 'mainnet';
    return {
      id,
      horizonUrl: isMainnet
        ? (this.configService.get<string>('STELLAR_MAINNET_URL') ?? 'https://horizon.stellar.org')
        : (this.configService.get<string>('STELLAR_TESTNET_URL') ?? 'https://horizon-testnet.stellar.org'),
      network: this.activeNetwork,
      inUse: false,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      errorCount: 0,
    };
  }

  private rebuildPool(network: 'mainnet' | 'testnet'): void {
    this.pool.clear();
    this.activeNetwork = network;
    this.initPool();
  }

  private startBatchProcessor(): void {
    this.batchTimer = setInterval(() => {
      if (this.txQueue.length > 0) {
        this.flushBatch().catch((err) =>
          this.logger.error(`Batch flush error: ${err.message}`),
        );
      }
    }, this.BATCH_INTERVAL_MS);
  }

  private startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      this.checkNetworkHealth().catch((err) =>
        this.logger.error(`Health check error: ${err.message}`),
      );
    }, this.HEALTH_CHECK_INTERVAL_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
