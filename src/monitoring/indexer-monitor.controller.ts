import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IndexerMonitorService, IndexerAlert, IndexerMetrics } from '../../indexer-monitor.service';

@ApiTags('indexer-monitor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('indexer-monitor')
export class IndexerMonitorController {
  constructor(private readonly indexerMonitorService: IndexerMonitorService) { }

  @Get('health')
  @ApiOperation({ summary: 'Get indexer health status' })
  @ApiResponse({ status: 200, description: 'Indexer health status retrieved successfully.' })
  @ApiResponse({ status: 503, description: 'Indexer is unhealthy.' })
  async getHealth() {
    return this.indexerMonitorService.getHealthStatus();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get indexer metrics' })
  @ApiResponse({ status: 200, description: 'Indexer metrics retrieved successfully.' })
  async getMetrics(): Promise<IndexerMetrics> {
    return this.indexerMonitorService.getMetrics();
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Get active indexer alerts' })
  @ApiResponse({ status: 200, description: 'Active alerts retrieved successfully.' })
  async getAlerts(): Promise<IndexerAlert[]> {
    return this.indexerMonitorService.getActiveAlerts();
  }

  @Post('alerts/:alertId/resolve')
  @ApiOperation({ summary: 'Resolve an indexer alert' })
  @ApiParam({ name: 'alertId', description: 'ID of the alert to resolve' })
  @ApiResponse({ status: 200, description: 'Alert resolved successfully.' })
  @ApiResponse({ status: 404, description: 'Alert not found.' })
  async resolveAlert(@Param('alertId') alertId: string) {
    const resolved = await this.indexerMonitorService.resolveAlert(alertId);
    return { resolved, alertId };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get simple status for health checks' })
  @ApiResponse({ status: 200, description: 'Status retrieved successfully.' })
  async getStatus() {
    const health = await this.indexerMonitorService.getHealthStatus();
    return {
      status: health.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      metrics: health.details,
      alertsCount: health.alerts.length,
    };
  }
}
