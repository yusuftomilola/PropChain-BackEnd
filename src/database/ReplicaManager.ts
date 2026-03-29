import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

export interface ReplicaConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  isPrimary: boolean;
  weight?: number;
  maxConnections?: number;
}

export interface ReplicaStatus {
  host: string;
  port: number;
  isHealthy: boolean;
  lagTime?: number;
  connectionCount: number;
  lastChecked: Date;
}

@Injectable()
export class ReplicaManager {
  private readonly logger = new Logger(ReplicaManager.name);
  private readonly replicas: Map<string, Pool> = new Map();
  private readonly primaryPool: Pool;
  private readonly healthCheckInterval: NodeJS.Timeout;
  private readonly replicaStatuses: Map<string, ReplicaStatus> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.primaryPool = this.createPrimaryPool();
    this.initializeReplicas();
    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      30000, // 30 seconds
    );
  }

  private createPrimaryPool(): Pool {
    const primaryConfig = this.configService.get<ReplicaConfig>('database.primary');
    if (!primaryConfig) {
      throw new Error('Primary database configuration not found');
    }

    return new Pool({
      host: primaryConfig.host,
      port: primaryConfig.port,
      database: primaryConfig.database,
      user: primaryConfig.username,
      password: primaryConfig.password,
      max: primaryConfig.maxConnections || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  private initializeReplicas(): void {
    const replicaConfigs = this.configService.get<ReplicaConfig[]>('database.replicas') || [];
    
    for (const config of replicaConfigs) {
      if (config.isPrimary) continue;
      
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.username,
        password: config.password,
        max: config.maxConnections || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      this.replicas.set(`${config.host}:${config.port}`, pool);
      
      this.replicaStatuses.set(`${config.host}:${config.port}`, {
        host: config.host,
        port: config.port,
        isHealthy: true,
        lagTime: 0,
        connectionCount: 0,
        lastChecked: new Date(),
      });
    }
  }

  async getPrimaryConnection(): Promise<PoolClient> {
    return this.primaryPool.connect();
  }

  async getReadConnection(): Promise<PoolClient> {
    const healthyReplicas = Array.from(this.replicaStatuses.entries())
      .filter(([_, status]) => status.isHealthy)
      .map(([key, _]) => key);

    if (healthyReplicas.length === 0) {
      this.logger.warn('No healthy replicas available, falling back to primary');
      return this.primaryPool.connect();
    }

    const selectedReplicaKey = this.selectReplicaByWeight(healthyReplicas);
    const pool = this.replicas.get(selectedReplicaKey);
    
    if (!pool) {
      this.logger.error(`Pool not found for replica: ${selectedReplicaKey}`);
      return this.primaryPool.connect();
    }

    try {
      return await pool.connect();
    } catch (error) {
      this.logger.error(`Failed to connect to replica ${selectedReplicaKey}:`, error);
      this.markReplicaUnhealthy(selectedReplicaKey);
      return this.primaryPool.connect();
    }
  }

  private selectReplicaByWeight(replicaKeys: string[]): string {
    const weights = replicaKeys.map(key => {
      const config = this.configService.get<ReplicaConfig[]>(`database.replicas`)
        ?.find(r => `${r.host}:${r.port}` === key);
      return config?.weight || 1;
    });

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < replicaKeys.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return replicaKeys[i];
      }
    }
    
    return replicaKeys[0];
  }

  private async performHealthChecks(): Promise<void> {
    for (const [replicaKey, pool] of this.replicas) {
      try {
        const client = await pool.connect();
        const result = await client.query(`
          SELECT 
            pg_last_wal_receive_lsn() AS receive_lsn,
            pg_last_wal_replay_lsn() AS replay_lsn,
            EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) AS lag_time
        `);
        
        await client.release();

        const lagTime = result.rows[0]?.lag_time || 0;
        const isHealthy = lagTime < 10; // Consider healthy if lag is less than 10 seconds

        this.replicaStatuses.set(replicaKey, {
          ...this.replicaStatuses.get(replicaKey)!,
          isHealthy,
          lagTime,
          connectionCount: pool.totalCount - pool.idleCount,
          lastChecked: new Date(),
        });

      } catch (error) {
        this.logger.error(`Health check failed for replica ${replicaKey}:`, error);
        this.markReplicaUnhealthy(replicaKey);
      }
    }
  }

  private markReplicaUnhealthy(replicaKey: string): void {
    const status = this.replicaStatuses.get(replicaKey);
    if (status) {
      status.isHealthy = false;
      status.lastChecked = new Date();
      this.replicaStatuses.set(replicaKey, status);
    }
  }

  getReplicaStatuses(): ReplicaStatus[] {
    return Array.from(this.replicaStatuses.values());
  }

  async getPrimaryPoolStats(): Promise<any> {
    return {
      totalCount: this.primaryPool.totalCount,
      idleCount: this.primaryPool.idleCount,
      waitingCount: this.primaryPool.waitingCount,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    await this.primaryPool.end();
    
    for (const pool of this.replicas.values()) {
      await pool.end();
    }
  }
}
