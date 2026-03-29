import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReplicaManager, ReplicaStatus } from './ReplicaManager';
import { ConnectionPool, PoolStats } from './ConnectionPool';
import { QueryRouter, QueryStatistics } from './QueryRouter';

export interface DatabaseMetrics {
  timestamp: Date;
  primaryPool: PoolStats;
  replicas: ReplicaStatus[];
  connectionPools: Record<string, PoolStats>;
  queryStats: QueryStatistics;
  performanceScore: number;
}

export interface OptimizationRecommendation {
  type: 'connection_pool' | 'replica_health' | 'query_performance' | 'sharding';
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation: string;
  impact: string;
}

export interface PerformanceThresholds {
  maxConnectionUtilization: number;
  maxQueryExecutionTime: number;
  maxReplicaLag: number;
  minHealthyReplicas: number;
  maxWaitingClients: number;
}

@Injectable()
export class DatabaseOptimizationService {
  private readonly logger = new Logger(DatabaseOptimizationService.name);
  private readonly metrics: DatabaseMetrics[] = [];
  private readonly monitoringInterval: NodeJS.Timeout;
  private readonly thresholds: PerformanceThresholds;
  private readonly maxMetricsHistory = 1000; // Keep last 1000 data points

  constructor(
    private readonly configService: ConfigService,
    private readonly replicaManager: ReplicaManager,
    private readonly connectionPool: ConnectionPool,
    private readonly queryRouter: QueryRouter,
  ) {
    this.thresholds = this.loadThresholds();
    this.startMonitoring();
  }

  private loadThresholds(): PerformanceThresholds {
    return {
      maxConnectionUtilization: this.configService.get<number>('database.thresholds.maxConnectionUtilization', 0.8),
      maxQueryExecutionTime: this.configService.get<number>('database.thresholds.maxQueryExecutionTime', 1000),
      maxReplicaLag: this.configService.get<number>('database.thresholds.maxReplicaLag', 10),
      minHealthyReplicas: this.configService.get<number>('database.thresholds.minHealthyReplicas', 1),
      maxWaitingClients: this.configService.get<number>('database.thresholds.maxWaitingClients', 5),
    };
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(
      () => this.collectMetrics(),
      60000, // Collect metrics every minute
    );
  }

  private async collectMetrics(): Promise<void> {
    try {
      const primaryPool = await this.replicaManager.getPrimaryPoolStats();
      const replicas = this.replicaManager.getReplicaStatuses();
      const connectionPools = this.connectionPool.getPoolStats();
      const queryStats = this.queryRouter.getQueryStatistics();

      const metrics: DatabaseMetrics = {
        timestamp: new Date(),
        primaryPool,
        replicas,
        connectionPools,
        queryStats,
        performanceScore: this.calculatePerformanceScore({
          primaryPool,
          replicas,
          connectionPools,
          queryStats,
        }),
      };

      this.addMetrics(metrics);
      this.analyzePerformance(metrics);
    } catch (error) {
      this.logger.error('Failed to collect database metrics:', error);
    }
  }

  private addMetrics(metrics: DatabaseMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only the last maxMetricsHistory entries
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics.shift();
    }
  }

  private calculatePerformanceScore(data: Omit<DatabaseMetrics, 'timestamp' | 'performanceScore'>): number {
    let score = 100;
    const weights = {
      connectionUtilization: 0.3,
      replicaHealth: 0.25,
      queryPerformance: 0.25,
      waitingClients: 0.2,
    };

    // Connection utilization penalty
    const totalConnections = Object.values(data.connectionPools).reduce(
      (sum, pool) => sum + pool.activeConnections, 0
    );
    const totalMaxConnections = Object.values(data.connectionPools).reduce(
      (sum, pool) => sum + pool.maxConnections, 0
    );
    const connectionUtilization = totalMaxConnections > 0 ? totalConnections / totalMaxConnections : 0;
    
    if (connectionUtilization > this.thresholds.maxConnectionUtilization) {
      score -= (connectionUtilization - this.thresholds.maxConnectionUtilization) * 100 * weights.connectionUtilization;
    }

    // Replica health penalty
    const healthyReplicas = data.replicas.filter(r => r.isHealthy).length;
    const totalReplicas = data.replicas.length;
    const replicaHealthRatio = totalReplicas > 0 ? healthyReplicas / totalReplicas : 1;
    
    if (healthyReplicas < this.thresholds.minHealthyReplicas) {
      score -= (1 - replicaHealthRatio) * 100 * weights.replicaHealth;
    }

    // Query performance penalty
    if (data.queryStats.averageExecutionTime > this.thresholds.maxQueryExecutionTime) {
      const penalty = (data.queryStats.averageExecutionTime - this.thresholds.maxQueryExecutionTime) / 
                     this.thresholds.maxQueryExecutionTime;
      score -= Math.min(penalty * 100 * weights.queryPerformance, 50);
    }

    // Waiting clients penalty
    const totalWaitingClients = Object.values(data.connectionPools).reduce(
      (sum, pool) => sum + pool.waitingClients, 0
    );
    
    if (totalWaitingClients > this.thresholds.maxWaitingClients) {
      const penalty = (totalWaitingClients - this.thresholds.maxWaitingClients) / 
                     this.thresholds.maxWaitingClients;
      score -= Math.min(penalty * 100 * weights.waitingClients, 30);
    }

    return Math.max(0, Math.round(score));
  }

  private analyzePerformance(metrics: DatabaseMetrics): void {
    const recommendations = this.generateRecommendations(metrics);
    
    if (recommendations.length > 0) {
      this.logger.warn('Performance recommendations detected:', recommendations);
    }

    // Auto-apply some optimizations if configured
    if (this.configService.get<boolean>('database.autoOptimization', false)) {
      this.applyAutoOptimizations(recommendations);
    }
  }

  generateRecommendations(metrics?: DatabaseMetrics): OptimizationRecommendation[] {
    const currentMetrics = metrics || this.getCurrentMetrics();
    if (!currentMetrics) {
      return [];
    }

    const recommendations: OptimizationRecommendation[] = [];

    // Check connection pool utilization
    for (const [poolName, poolStats] of Object.entries(currentMetrics.connectionPools)) {
      const utilization = poolStats.activeConnections / poolStats.maxConnections;
      
      if (utilization > this.thresholds.maxConnectionUtilization) {
        recommendations.push({
          type: 'connection_pool',
          priority: utilization > 0.95 ? 'critical' : 'high',
          description: `High connection utilization in pool ${poolName}: ${Math.round(utilization * 100)}%`,
          recommendation: `Increase max connections for pool ${poolName} or optimize query performance`,
          impact: 'Reduces connection waiting time and improves throughput',
        });
      }

      if (poolStats.waitingClients > this.thresholds.maxWaitingClients) {
        recommendations.push({
          type: 'connection_pool',
          priority: poolStats.waitingClients > 10 ? 'critical' : 'medium',
          description: `High number of waiting clients in pool ${poolName}: ${poolStats.waitingClients}`,
          recommendation: `Increase pool size or implement connection pooling optimizations`,
          impact: 'Reduces application response time',
        });
      }
    }

    // Check replica health
    const unhealthyReplicas = currentMetrics.replicas.filter(r => !r.isHealthy);
    if (unhealthyReplicas.length > 0) {
      recommendations.push({
        type: 'replica_health',
        priority: unhealthyReplicas.length === currentMetrics.replicas.length ? 'critical' : 'high',
        description: `${unhealthyReplicas.length} unhealthy replicas detected`,
        recommendation: 'Check replica connectivity and replication lag',
        impact: 'Ensures read query distribution and failover capability',
      });
    }

    // Check replica lag
    const highLagReplicas = currentMetrics.replicas.filter(r => r.lagTime && r.lagTime > this.thresholds.maxReplicaLag);
    if (highLagReplicas.length > 0) {
      recommendations.push({
        type: 'replica_health',
        priority: 'medium',
        description: `High replication lag detected on ${highLagReplicas.length} replicas`,
        recommendation: 'Optimize network configuration or reduce write load',
        impact: 'Improves read query data freshness',
      });
    }

    // Check query performance
    if (currentMetrics.queryStats.averageExecutionTime > this.thresholds.maxQueryExecutionTime) {
      recommendations.push({
        type: 'query_performance',
        priority: 'medium',
        description: `Average query execution time is high: ${currentMetrics.queryStats.averageExecutionTime}ms`,
        recommendation: 'Review slow queries and add appropriate indexes',
        impact: 'Improves overall application responsiveness',
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private applyAutoOptimizations(recommendations: OptimizationRecommendation[]): void {
    for (const recommendation of recommendations) {
      switch (recommendation.type) {
        case 'connection_pool':
          // Auto-warm up connection pools if utilization is high
          if (recommendation.priority === 'critical') {
            this.connectionPool.warmUpPools();
            this.logger.log('Auto-optimized: Warmed up connection pools');
          }
          break;
        case 'replica_health':
          // Replica health issues require manual intervention
          this.logger.warn('Replica health issues detected - manual intervention required');
          break;
        case 'query_performance':
          // Query performance requires manual optimization
          this.logger.warn('Query performance issues detected - manual optimization required');
          break;
      }
    }
  }

  getCurrentMetrics(): DatabaseMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  getMetricsHistory(minutes?: number): DatabaseMetrics[] {
    if (!minutes) {
      return [...this.metrics];
    }

    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);
    return this.metrics.filter(m => m.timestamp >= cutoffTime);
  }

  getPerformanceTrend(minutes: number = 60): {
    trend: 'improving' | 'degrading' | 'stable';
    change: number;
    dataPoints: DatabaseMetrics[];
  } {
    const recentMetrics = this.getMetricsHistory(minutes);
    
    if (recentMetrics.length < 2) {
      return { trend: 'stable', change: 0, dataPoints: recentMetrics };
    }

    const oldest = recentMetrics[0].performanceScore;
    const newest = recentMetrics[recentMetrics.length - 1].performanceScore;
    const change = newest - oldest;

    let trend: 'improving' | 'degrading' | 'stable';
    if (Math.abs(change) < 5) {
      trend = 'stable';
    } else if (change > 0) {
      trend = 'improving';
    } else {
      trend = 'degrading';
    }

    return { trend, change, dataPoints: recentMetrics };
  }

  async optimizeConnectionPools(): Promise<void> {
    this.logger.log('Starting connection pool optimization...');
    
    try {
      await this.connectionPool.warmUpPools();
      
      // Get current stats and log them
      const stats = this.connectionPool.getPoolStats();
      this.logger.log('Connection pool stats after optimization:', stats);
      
    } catch (error) {
      this.logger.error('Failed to optimize connection pools:', error);
      throw error;
    }
  }

  async checkReplicaHealth(): Promise<{
    healthy: number;
    unhealthy: number;
    details: ReplicaStatus[];
  }> {
    const statuses = this.replicaManager.getReplicaStatuses();
    const healthy = statuses.filter(r => r.isHealthy).length;
    const unhealthy = statuses.length - healthy;

    return {
      healthy,
      unhealthy,
      details: statuses,
    };
  }

  getDetailedReport(): {
    currentMetrics: DatabaseMetrics | null;
    recommendations: OptimizationRecommendation[];
    performanceTrend: ReturnType<typeof this.getPerformanceTrend>;
    healthStatus: {
      connectionPools: 'healthy' | 'warning' | 'critical';
      replicas: 'healthy' | 'warning' | 'critical';
      queries: 'healthy' | 'warning' | 'critical';
    };
  } {
    const currentMetrics = this.getCurrentMetrics();
    const recommendations = this.generateRecommendations();
    const performanceTrend = this.getPerformanceTrend();

    const healthStatus = {
      connectionPools: this.calculateHealthStatus(
        recommendations.filter(r => r.type === 'connection_pool')
      ),
      replicas: this.calculateHealthStatus(
        recommendations.filter(r => r.type === 'replica_health')
      ),
      queries: this.calculateHealthStatus(
        recommendations.filter(r => r.type === 'query_performance')
      ),
    };

    return {
      currentMetrics,
      recommendations,
      performanceTrend,
      healthStatus,
    };
  }

  private calculateHealthStatus(recommendations: OptimizationRecommendation[]): 'healthy' | 'warning' | 'critical' {
    if (recommendations.some(r => r.priority === 'critical')) {
      return 'critical';
    }
    if (recommendations.some(r => r.priority === 'high')) {
      return 'warning';
    }
    return 'healthy';
  }

  async onModuleDestroy(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
}
