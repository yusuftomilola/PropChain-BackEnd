import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { BackgroundJobMonitoringService, JobQueueName } from './background-job-monitoring.service';
import { IdempotencyGuard } from '../../common/guards/idempotency.guard';
import { Idempotent } from '../decorators/idempotent.decorator';

@ApiTags('background-jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('background-jobs')
export class BackgroundJobsController {
  constructor(private readonly jobMonitoringService: BackgroundJobMonitoringService) { }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get background job dashboard data' })
  @ApiResponse({ status: 200, description: 'Background job dashboard data returned successfully.' })
  getDashboard() {
    return this.jobMonitoringService.getDashboard();
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Get background job alerts' })
  @ApiResponse({ status: 200, description: 'Background job alerts returned successfully.' })
  getAlerts(@Query('resolved') resolved?: string) {
    return this.jobMonitoringService.getAlerts(resolved === undefined ? undefined : resolved === 'true');
  }

  @Post('alerts/:alertId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge a background job alert' })
  @ApiResponse({ status: 200, description: 'Alert acknowledged successfully.' })
  acknowledgeAlert(@Param('alertId') alertId: string, @Body() body: { acknowledgedBy: string }) {
    return this.jobMonitoringService.acknowledgeAlert(alertId, body.acknowledgedBy);
  }

  @Post('alerts/:alertId/resolve')
  @ApiOperation({ summary: 'Resolve a background job alert' })
  @ApiResponse({ status: 200, description: 'Alert resolved successfully.' })
  resolveAlert(@Param('alertId') alertId: string) {
    return this.jobMonitoringService.resolveAlert(alertId);
  }

  @Get('queues/:queueName/failed')
  @ApiOperation({ summary: 'Get failed jobs for a queue' })
  @ApiResponse({ status: 200, description: 'Failed jobs returned successfully.' })
  getFailedJobs(@Param('queueName') queueName: JobQueueName, @Query('limit') limit?: string) {
    return this.jobMonitoringService.getFailedJobs(queueName, limit ? Number(limit) : 20);
  }

  @Post('queues/:queueName/retry-failed')
  @UseGuards(IdempotencyGuard)
  @Idempotent({
    windowMs: 30 * 1000, // 30 seconds
    maxDuplicates: 1,
    includeQuery: true,
  })
  @ApiOperation({ summary: 'Retry failed jobs for a queue' })
  @ApiResponse({ status: 200, description: 'Failed jobs retried successfully.' })
  @ApiResponse({ status: 400, description: 'Duplicate retry request detected.' })
  retryFailedJobs(@Param('queueName') queueName: JobQueueName | 'all') {
    return this.jobMonitoringService.retryFailedJobs(queueName);
  }
}
