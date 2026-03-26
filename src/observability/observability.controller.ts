import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PerformanceMonitorService } from './performance-monitor.service';
import { TracingService } from './tracing.service';
import { MetricsInterceptor } from './metrics.interceptor';

declare const process: {
  env: Record<string, string | undefined>;
  npm_package_version?: string;
  NODE_ENV?: string;
};

// Simple admin guard for demonstration
const UseGuards = () => (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
  // In production, implement proper authentication
  return descriptor;
};

@ApiTags('Observability')
@Controller('observability')
export class ObservabilityController {
  constructor(
    private readonly performanceMonitorService: PerformanceMonitorService,
    private readonly tracingService: TracingService,
    private readonly metricsInterceptor: MetricsInterceptor,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Get detailed health status with performance metrics' })
  @ApiResponse({ status: 200, description: 'Health status retrieved successfully' })
  async getHealthStatus() {
    return this.performanceMonitorService.getHealthStatus();
  }

  @Get('metrics/current')
  @ApiOperation({ summary: 'Get current performance metrics' })
  @ApiResponse({ status: 200, description: 'Current metrics retrieved successfully' })
  async getCurrentMetrics() {
    return this.performanceMonitorService.getCurrentMetrics();
  }

  @Get('metrics/history')
  @ApiOperation({ summary: 'Get historical performance metrics' })
  @ApiResponse({ status: 200, description: 'Historical metrics retrieved successfully' })
  async getMetricsHistory(
    @Query('minutes') minutes?: number,
  ) {
    const historyMinutes = minutes ? parseInt(minutes.toString()) : 60;
    return this.performanceMonitorService.getMetricsHistory(historyMinutes);
  }

  @Get('metrics/average')
  @ApiOperation({ summary: 'Get average performance metrics over time period' })
  @ApiResponse({ status: 200, description: 'Average metrics retrieved successfully' })
  async getAverageMetrics(
    @Query('minutes') minutes?: number,
  ) {
    const historyMinutes = minutes ? parseInt(minutes.toString()) : 60;
    return this.performanceMonitorService.getAverageMetrics(historyMinutes);
  }

  @Get('tracing/status')
  @UseGuards()
  @ApiOperation({ summary: 'Get tracing service status' })
  @ApiResponse({ status: 200, description: 'Tracing status retrieved successfully' })
  async getTracingStatus() {
    return {
      status: 'active',
      service: 'propchain-backend',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      exporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'console',
    };
  }

  @Get('prometheus')
  @ApiOperation({ summary: 'Redirect to Prometheus metrics endpoint' })
  @ApiResponse({ status: 302, description: 'Redirect to metrics endpoint' })
  async getPrometheusMetrics() {
    // This will be handled by the PrometheusModule
    return { message: 'Metrics available at /metrics' };
  }
}
