import { Injectable, Logger } from '@nestjs/common';
import { ReplicaManager } from './ReplicaManager';
import { ConnectionPool } from './ConnectionPool';
import { PoolClient } from 'pg';

export enum QueryType {
  READ = 'read',
  WRITE = 'write',
  TRANSACTION = 'transaction',
}

export interface QueryContext {
  queryType: QueryType;
  query: string;
  params?: any[];
  preferredReplica?: string;
  useSharding?: boolean;
  shardKey?: string;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  executionTime: number;
  usedReplica?: string;
  queryType: QueryType;
}

export interface ShardingConfig {
  enabled: boolean;
  shardCount: number;
  shardKeyColumn: string;
  shardMapping: Record<string, string>;
}

@Injectable()
export class QueryRouter {
  private readonly logger = new Logger(QueryRouter.name);
  private readonly shardingConfig: ShardingConfig;

  constructor(
    private readonly replicaManager: ReplicaManager,
    private readonly connectionPool: ConnectionPool,
  ) {
    this.shardingConfig = {
      enabled: false,
      shardCount: 1,
      shardKeyColumn: 'id',
      shardMapping: {},
    };
  }

  async executeQuery<T = any>(context: QueryContext): Promise<QueryResult<T>> {
    const startTime = Date.now();
    
    try {
      let result: QueryResult<T>;
      
      switch (context.queryType) {
        case QueryType.READ:
          result = await this.executeReadQuery<T>(context);
          break;
        case QueryType.WRITE:
          result = await this.executeWriteQuery<T>(context);
          break;
        case QueryType.TRANSACTION:
          result = await this.executeTransaction<T>(context);
          break;
        default:
          throw new Error(`Unsupported query type: ${context.queryType}`);
      }

      result.executionTime = Date.now() - startTime;
      
      this.logQueryExecution(context, result);
      
      return result;
    } catch (error) {
      this.logger.error(`Query execution failed:`, error);
      throw error;
    }
  }

  private async executeReadQuery<T>(context: QueryContext): Promise<QueryResult<T>> {
    let client: PoolClient;
    let usedReplica: string | undefined;

    try {
      if (context.useSharding && context.shardKey) {
        const poolName = this.getShardPool(context.shardKey);
        client = await this.connectionPool.getConnection(poolName);
        usedReplica = poolName;
      } else {
        client = await this.replicaManager.getReadConnection();
        usedReplica = 'read-replica';
      }

      const result = await client.query(context.query, context.params);
      
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
        executionTime: 0, // Will be set by caller
        usedReplica,
        queryType: QueryType.READ,
      };
    } finally {
      if (client) {
        await this.connectionPool.releaseConnection(client);
      }
    }
  }

  private async executeWriteQuery<T>(context: QueryContext): Promise<QueryResult<T>> {
    let client: PoolClient;
    let usedReplica: string | undefined;

    try {
      if (context.useSharding && context.shardKey) {
        const poolName = this.getShardPool(context.shardKey);
        client = await this.connectionPool.getConnection(poolName);
        usedReplica = poolName;
      } else {
        client = await this.replicaManager.getPrimaryConnection();
        usedReplica = 'primary';
      }

      const result = await client.query(context.query, context.params);
      
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
        executionTime: 0, // Will be set by caller
        usedReplica,
        queryType: QueryType.WRITE,
      };
    } finally {
      if (client) {
        await this.connectionPool.releaseConnection(client);
      }
    }
  }

  private async executeTransaction<T>(context: QueryContext): Promise<QueryResult<T>> {
    let client: PoolClient;
    let usedReplica: string | undefined;

    try {
      if (context.useSharding && context.shardKey) {
        const poolName = this.getShardPool(context.shardKey);
        client = await this.connectionPool.getConnection(poolName);
        usedReplica = poolName;
      } else {
        client = await this.replicaManager.getPrimaryConnection();
        usedReplica = 'primary';
      }

      await client.query('BEGIN');
      
      const result = await client.query(context.query, context.params);
      
      await client.query('COMMIT');
      
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
        executionTime: 0, // Will be set by caller
        usedReplica,
        queryType: QueryType.TRANSACTION,
      };
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (client) {
        await this.connectionPool.releaseConnection(client);
      }
    }
  }

  async executeBatch<T = any>(contexts: QueryContext[]): Promise<QueryResult<T>[]> {
    const results: QueryResult<T>[] = [];
    
    // Group queries by type and replica for optimization
    const readQueries = contexts.filter(ctx => ctx.queryType === QueryType.READ);
    const writeQueries = contexts.filter(ctx => ctx.queryType === QueryType.WRITE);
    const transactionQueries = contexts.filter(ctx => ctx.queryType === QueryType.TRANSACTION);

    // Execute read queries in parallel
    if (readQueries.length > 0) {
      const readPromises = readQueries.map(ctx => this.executeQuery<T>(ctx));
      const readResults = await Promise.all(readPromises);
      results.push(...readResults);
    }

    // Execute write queries sequentially to maintain order
    for (const ctx of writeQueries) {
      const result = await this.executeQuery<T>(ctx);
      results.push(result);
    }

    // Execute transaction queries sequentially
    for (const ctx of transactionQueries) {
      const result = await this.executeQuery<T>(ctx);
      results.push(result);
    }

    return results;
  }

  private getShardPool(shardKey: string): string {
    if (!this.shardingConfig.enabled) {
      return 'default';
    }

    const hash = this.simpleHash(shardKey);
    const shardIndex = hash % this.shardingConfig.shardCount;
    return `shard-${shardIndex}`;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  detectQueryType(query: string): QueryType {
    const trimmedQuery = query.trim().toLowerCase();
    
    if (trimmedQuery.startsWith('select') || 
        trimmedQuery.startsWith('show') || 
        trimmedQuery.startsWith('describe') ||
        trimmedQuery.startsWith('explain')) {
      return QueryType.READ;
    }
    
    if (trimmedQuery.startsWith('insert') || 
        trimmedQuery.startsWith('update') || 
        trimmedQuery.startsWith('delete') ||
        trimmedQuery.startsWith('create') ||
        trimmedQuery.startsWith('drop') ||
        trimmedQuery.startsWith('alter')) {
      return QueryType.WRITE;
    }
    
    if (trimmedQuery.startsWith('begin') || 
        trimmedQuery.startsWith('commit') || 
        trimmedQuery.startsWith('rollback')) {
      return QueryType.TRANSACTION;
    }
    
    // Default to write for safety
    return QueryType.WRITE;
  }

  extractShardKey(query: string, params?: any[]): string | undefined {
    if (!this.shardingConfig.enabled) {
      return undefined;
    }

    // Simple extraction logic - can be enhanced based on specific requirements
    const shardKeyPattern = new RegExp(`${this.shardingConfig.shardKeyColumn}\\s*=\\s*\\$?(\\d+)`, 'i');
    const match = query.match(shardKeyPattern);
    
    if (match) {
      const paramIndex = parseInt(match[1]) - 1;
      return params && params[paramIndex] ? params[paramIndex].toString() : undefined;
    }

    return undefined;
  }

  private logQueryExecution(context: QueryContext, result: QueryResult): void {
    const logData = {
      queryType: context.queryType,
      executionTime: result.executionTime,
      rowCount: result.rowCount,
      usedReplica: result.usedReplica,
      query: context.query.substring(0, 100) + (context.query.length > 100 ? '...' : ''),
    };

    if (result.executionTime > 1000) {
      this.logger.warn('Slow query detected:', logData);
    } else {
      this.logger.debug('Query executed:', logData);
    }
  }

  getQueryStatistics(): {
    totalQueries: number;
    averageExecutionTime: number;
    replicaDistribution: Record<string, number>;
    queryTypeDistribution: Record<string, number>;
  } {
    // This would typically be stored in a metrics system
    // For now, return placeholder data
    return {
      totalQueries: 0,
      averageExecutionTime: 0,
      replicaDistribution: {},
      queryTypeDistribution: {},
    };
  }

  enableSharding(config: Partial<ShardingConfig>): void {
    this.shardingConfig.enabled = true;
    Object.assign(this.shardingConfig, config);
    this.logger.log('Sharding enabled with config:', this.shardingConfig);
  }

  disableSharding(): void {
    this.shardingConfig.enabled = false;
    this.logger.log('Sharding disabled');
  }
}
