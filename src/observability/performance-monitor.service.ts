import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TracingService } from './tracing.service';
import { MetricsInterceptor } from './metrics.interceptor';

interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

declare const process: {
  env: Record<string, string | undefined>;
  uptime: () => number;
  memoryUsage: () => MemoryUsage;
  pid: number;
  cwd: () => string;
};

declare const require: {
  (id: string): any;
};

declare const os: {
  cpus: () => any[];
  loadavg: () => number[];
  totalmem: () => number;
  freemem: () => number;
};

declare const fs: {
  statSync: (path: string) => any;
};

declare const path: {
  join: (...paths: string[]) => string;
};

declare const setInterval: (callback: () => void, ms: number) => any;
declare const clearInterval: (id: any) => void;

export interface PerformanceMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    free: number;
    total: number;
    usage: number;
  };
  disk: {
    used: number;
    free: number;
    total: number;
    usage: number;
  };
  network: {
    connections: number;
    requestsPerSecond: number;
  };
  application: {
    uptime: number;
    activeRequests: number;
    errorRate: number;
    responseTime: number;
  };
}

@Injectable()
export class PerformanceMonitorService implements OnModuleInit, OnModuleDestroy {
  private metrics: PerformanceMetrics[] = [];
  private readonly maxMetricsHistory = 1000;
  private requestCounts: Map<string, number> = new Map();
  private lastCleanup = Date.now();
  private monitoringInterval: any;
  private requestCountsByMinute: Map<string, number> = new Map();

  constructor(
    private readonly tracingService: TracingService,
    private readonly metricsInterceptor: MetricsInterceptor,
  ) {}

  async onModuleInit() {
    // Start collecting metrics every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, 30000);

    // Initial metrics collection
    await this.collectMetrics();
  }

  async onModuleDestroy() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async collectMetrics(): Promise<PerformanceMetrics> {
    const span = this.tracingService.createSpan('performance-metrics-collection');
    
    try {
      const metrics: PerformanceMetrics = {
        timestamp: new Date(),
        cpu: this.getCpuMetrics(),
        memory: this.getMemoryMetrics(),
        disk: this.getDiskMetrics(),
        network: this.getNetworkMetrics(),
        application: this.getApplicationMetrics(),
      };

      this.metrics.push(metrics);
      
      // Keep only the latest metrics
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics = this.metrics.slice(-this.maxMetricsHistory);
      }

      // Record custom metrics
      this.recordCustomMetrics(metrics);

      span.setStatus({ code: 1 }); // OK
      span.end();

      return metrics;
    } catch (error) {
      span.setStatus({ 
        code: 2, // ERROR
        message: (error as Error).message,
      });
      span.end();
      throw error;
    }
  }

  private getCpuMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate CPU usage (simplified)
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - (100 * idle / total);

    return {
      usage: Math.round(usage * 100) / 100,
      loadAverage: loadAvg,
    };
  }

  private getMemoryMetrics() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usage = (used / total) * 100;

    return {
      used: Math.round(used / 1024 / 1024), // MB
      free: Math.round(free / 1024 / 1024), // MB
      total: Math.round(total / 1024 / 1024), // MB
      usage: Math.round(usage * 100) / 100,
    };
  }

  private getDiskMetrics() {
    try {
      const stats = fs.statSync(process.cwd());
      // This is a simplified disk usage calculation
      // In production, you might want to use a more sophisticated approach
      return {
        used: 0, // Would need actual disk usage calculation
        free: 0, // Would need actual free space calculation
        total: 0, // Would need actual total disk space
        usage: 0,
      };
    } catch {
      return {
        used: 0,
        free: 0,
        total: 0,
        usage: 0,
      };
    }
  }

  private getNetworkMetrics() {
    const currentMinute = new Date().getMinutes().toString();
    const requests = this.requestCountsByMinute.get(currentMinute) || 0;
    
    return {
      connections: 0, // Would need actual connection tracking
      requestsPerSecond: requests / 60,
    };
  }

  private getApplicationMetrics() {
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    
    return {
      uptime: Math.round(uptime),
      activeRequests: 0, // Would need actual request tracking
      errorRate: this.calculateErrorRate(),
      responseTime: this.calculateAverageResponseTime(),
    };
  }

  private calculateErrorRate(): number {
    // Simplified error rate calculation
    // In production, you would track actual errors
    return 0;
  }

  private calculateAverageResponseTime(): number {
    // Simplified response time calculation
    // In production, you would track actual response times
    return 0;
  }

  private recordCustomMetrics(metrics: PerformanceMetrics) {
    // Record CPU usage
    this.metricsInterceptor.recordCustomMetric(
      'system_cpu_usage_percent',
      metrics.cpu.usage,
      { type: 'system' }
    );

    // Record memory usage
    this.metricsInterceptor.recordCustomMetric(
      'system_memory_usage_percent',
      metrics.memory.usage,
      { type: 'system' }
    );

    // Record application uptime
    this.metricsInterceptor.recordCustomMetric(
      'application_uptime_seconds',
      metrics.application.uptime,
      { type: 'application' }
    );

    // Record request rate
    this.metricsInterceptor.recordCustomMetric(
      'application_requests_per_second',
      metrics.network.requestsPerSecond,
      { type: 'application' }
    );
  }

  // Public API methods
  getCurrentMetrics(): PerformanceMetrics | null {
    return this.metrics[this.metrics.length - 1] || null;
  }

  getMetricsHistory(minutes: number = 60): PerformanceMetrics[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return this.metrics.filter(m => m.timestamp >= cutoff);
  }

  getAverageMetrics(minutes: number = 60): Partial<PerformanceMetrics> {
    const recentMetrics = this.getMetricsHistory(minutes);
    
    if (recentMetrics.length === 0) {
      return {};
    }

    const avg: Partial<PerformanceMetrics> = {
      cpu: {
        usage: this.average(recentMetrics.map(m => m.cpu.usage)),
        loadAverage: this.averageVector(recentMetrics.map(m => m.cpu.loadAverage)),
      },
      memory: {
        used: this.average(recentMetrics.map(m => m.memory.used)),
        free: this.average(recentMetrics.map(m => m.memory.free)),
        total: this.average(recentMetrics.map(m => m.memory.total)),
        usage: this.average(recentMetrics.map(m => m.memory.usage)),
      },
      application: {
        uptime: this.average(recentMetrics.map(m => m.application.uptime)),
        activeRequests: this.average(recentMetrics.map(m => m.application.activeRequests)),
        responseTime: this.average(recentMetrics.map(m => m.application.responseTime)),
        errorRate: this.average(recentMetrics.map(m => m.application.errorRate)),
      },
    };

    return avg;
  }

  private average(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private averageVector(vectors: number[][]): number[] {
    if (vectors.length === 0) return [];
    
    const result = [];
    for (let i = 0; i < vectors[0].length; i++) {
      const values = vectors.map(v => v[i]);
      result.push(this.average(values));
    }
    return result;
  }

  // Methods to be called by other services
  recordRequest(endpoint: string) {
    const currentMinute = new Date().getMinutes().toString();
    const current = this.requestCountsByMinute.get(currentMinute) || 0;
    this.requestCountsByMinute.set(currentMinute, current + 1);
    
    // Clean up old entries (older than 5 minutes)
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    for (const [minute] of this.requestCountsByMinute) {
      const minuteTime = new Date();
      minuteTime.setMinutes(parseInt(minute));
      if (minuteTime < cutoff) {
        this.requestCountsByMinute.delete(minute);
      }
    }
  }

  recordError(endpoint: string, error: Error) {
    const span = this.tracingService.createSpan('error-recording', {
      endpoint,
      error: error.message,
      stack: error.stack,
    });
    
    span.setStatus({ 
      code: 2, // ERROR
      message: error.message,
    });
    span.end();
  }

  recordSlowQuery(query: string, duration: number) {
    const span = this.tracingService.createSpan('slow-query-recording', {
      query,
      duration: duration.toString(),
    });
    
    this.metricsInterceptor.recordCustomMetric(
      'database_slow_query_duration_seconds',
      duration,
      { query_type: 'slow' }
    );
    
    span.end();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOldMetrics() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    this.metrics = this.metrics.filter(m => m.timestamp.getTime() > cutoff);
    this.lastCleanup = Date.now();
  }

  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    metrics: PerformanceMetrics;
  } {
    const current = this.getCurrentMetrics();
    if (!current) {
      return {
        status: 'critical',
        issues: ['No metrics available'],
        metrics: null as any,
      };
    }

    const issues: string[] = [];
    
    // Check CPU usage
    if (current.cpu.usage > 90) {
      issues.push(`High CPU usage: ${current.cpu.usage}%`);
    }
    
    // Check memory usage
    if (current.memory.usage > 90) {
      issues.push(`High memory usage: ${current.memory.usage}%`);
    }
    
    // Check error rate
    if (current.application.errorRate > 5) {
      issues.push(`High error rate: ${current.application.errorRate}%`);
    }
    
    // Check response time
    if (current.application.responseTime > 5000) {
      issues.push(`High response time: ${current.application.responseTime}ms`);
    }

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (issues.length > 0) {
      status = issues.length > 2 ? 'critical' : 'warning';
    }

    return {
      status,
      issues,
      metrics: current,
    };
  }
}
