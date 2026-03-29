import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

export interface PoolConfig {
  min: number;
  max: number;
  acquireTimeoutMillis: number;
  createTimeoutMillis: number;
  destroyTimeoutMillis: number;
  idleTimeoutMillis: number;
  reapIntervalMillis: number;
  createRetryIntervalMillis: number;
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
  maxConnections: number;
}

@Injectable()
export class ConnectionPool implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionPool.name);
  private readonly pools: Map<string, Pool> = new Map();
  private readonly poolConfigs: Map<string, PoolConfig> = new Map();
  private readonly monitoringInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    this.initializePools();
    this.monitoringInterval = setInterval(
      () => this.monitorPools(),
      60000, // 1 minute
    );
  }

  private initializePools(): void {
    const poolConfigs = this.configService.get<Record<string, PoolConfig>>('database.pools') || {};
    
    for (const [poolName, config] of Object.entries(poolConfigs)) {
      this.createPool(poolName, config);
    }
  }

  private createPool(poolName: string, config: PoolConfig): void {
    const dbConfig = this.configService.get(`database.${poolName}`);
    
    if (!dbConfig) {
      this.logger.error(`Database configuration not found for pool: ${poolName}`);
      return;
    }

    const pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.username,
      password: dbConfig.password,
      min: config.min,
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.acquireTimeoutMillis,
    });

    pool.on('connect', (client) => {
      this.logger.debug(`New client connected to pool: ${poolName}`);
    });

    pool.on('error', (err, client) => {
      this.logger.error(`Pool ${poolName} error:`, err);
    });

    this.pools.set(poolName, pool);
    this.poolConfigs.set(poolName, config);
  }

  async getConnection(poolName: string = 'default'): Promise<PoolClient> {
    const pool = this.pools.get(poolName);
    
    if (!pool) {
      throw new Error(`Pool not found: ${poolName}`);
    }

    try {
      const startTime = Date.now();
      const client = await pool.connect();
      const acquireTime = Date.now() - startTime;
      
      this.logger.debug(`Connection acquired from pool ${poolName} in ${acquireTime}ms`);
      
      // Add connection metadata
      (client as any).poolName = poolName;
      (client as any).acquireTime = acquireTime;
      
      return client;
    } catch (error) {
      this.logger.error(`Failed to acquire connection from pool ${poolName}:`, error);
      throw error;
    }
  }

  async releaseConnection(client: PoolClient): Promise<void> {
    try {
      const poolName = (client as any).poolName;
      const acquireTime = (client as any).acquireTime;
      const usageTime = Date.now() - (acquireTime || 0);
      
      await client.release();
      
      this.logger.debug(`Connection released to pool ${poolName}, used for ${usageTime}ms`);
    } catch (error) {
      this.logger.error('Error releasing connection:', error);
    }
  }

  async executeQuery<T = any>(
    query: string,
    params: any[] = [],
    poolName: string = 'default',
  ): Promise<T[]> {
    const client = await this.getConnection(poolName);
    
    try {
      const startTime = Date.now();
      const result = await client.query(query, params);
      const executionTime = Date.now() - startTime;
      
      this.logger.debug(`Query executed in ${executionTime}ms on pool ${poolName}`);
      
      return result.rows;
    } catch (error) {
      this.logger.error(`Query execution failed on pool ${poolName}:`, error);
      throw error;
    } finally {
      await this.releaseConnection(client);
    }
  }

  async executeTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
    poolName: string = 'default',
  ): Promise<T> {
    const client = await this.getConnection(poolName);
    
    try {
      await client.query('BEGIN');
      
      const result = await callback(client);
      
      await client.query('COMMIT');
      
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(`Transaction failed on pool ${poolName}:`, error);
      throw error;
    } finally {
      await this.releaseConnection(client);
    }
  }

  getPoolStats(poolName?: string): Record<string, PoolStats> {
    const stats: Record<string, PoolStats> = {};
    
    const poolsToCheck = poolName ? [poolName] : Array.from(this.pools.keys());
    
    for (const name of poolsToCheck) {
      const pool = this.pools.get(name);
      if (pool) {
        stats[name] = {
          totalConnections: pool.totalCount,
          activeConnections: pool.totalCount - pool.idleCount,
          idleConnections: pool.idleCount,
          waitingClients: pool.waitingCount,
          maxConnections: pool.options.max || 20,
        };
      }
    }
    
    return stats;
  }

  private monitorPools(): void {
    for (const [poolName, pool] of this.pools) {
      const stats = this.getPoolStats(poolName)[poolName];
      const config = this.poolConfigs.get(poolName);
      
      // Log warnings for potential issues
      if (stats.activeConnections / stats.maxConnections > 0.8) {
        this.logger.warn(`Pool ${poolName} is at high capacity: ${stats.activeConnections}/${stats.maxConnections}`);
      }
      
      if (stats.waitingClients > 0) {
        this.logger.warn(`Pool ${poolName} has ${stats.waitingClients} waiting clients`);
      }
      
      if (stats.idleConnections < config.min) {
        this.logger.warn(`Pool ${poolName} has fewer idle connections than minimum: ${stats.idleConnections}/${config.min}`);
      }
      
      this.logger.debug(`Pool ${poolName} stats:`, stats);
    }
  }

  async warmUpPools(): Promise<void> {
    for (const [poolName, config] of this.poolConfigs) {
      const pool = this.pools.get(poolName);
      if (!pool) continue;
      
      const connectionsToCreate = config.min;
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < connectionsToCreate; i++) {
        promises.push(this.createWarmupConnection(pool, poolName));
      }
      
      await Promise.all(promises);
      
      this.logger.log(`Pool ${poolName} warmed up with ${connectionsToCreate} connections`);
    }
  }

  private async createWarmupConnection(pool: Pool, poolName: string): Promise<void> {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      await client.release();
    } catch (error) {
      this.logger.error(`Failed to warm up connection for pool ${poolName}:`, error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    const closePromises: Promise<void>[] = [];
    
    for (const [poolName, pool] of this.pools) {
      closePromises.push(
        pool.end().then(() => {
          this.logger.log(`Pool ${poolName} closed successfully`);
        }).catch((error) => {
          this.logger.error(`Error closing pool ${poolName}:`, error);
        })
      );
    }
    
    await Promise.all(closePromises);
  }
}
