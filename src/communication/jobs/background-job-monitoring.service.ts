import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Job } from 'bull';
import { RedisService } from '../../common/services/redis.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { EmailQueueService } from '../email/email.queue';

export type JobQueueName = 'default' | 'priority' | 'batch';
export type JobEventStatus = 'active' | 'completed' | 'failed' | 'stalled' | 'scheduled_success' | 'scheduled_failure';

export interface BackgroundJobEvent {
  id: string;
  queueName: JobQueueName | 'scheduler';
  jobId: string;
  jobName: string;
  status: JobEventStatus;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: string;
  durationMs?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface BackgroundJobAlert {
  id: string;
  queueName: JobQueueName | 'scheduler';
  type: 'job_failed' | 'job_stalled' | 'queue_backlog' | 'queue_failure_threshold' | 'scheduled_failure';
  severity: 'warning' | 'critical';
  message: string;
  createdAt: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolved: boolean;
  resolvedAt?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class BackgroundJobMonitoringService {
  private readonly logger = new Logger(BackgroundJobMonitoringService.name);
  private readonly eventsKey = 'background-jobs:events';
  private readonly alertsKey = 'background-jobs:alerts';
  private readonly schedulerKey = 'background-jobs:schedulers';
  private readonly retentionSeconds: number;
  private readonly maxEventHistory: number;
  private readonly maxAlertHistory: number;
  private readonly backlogThreshold: number;
  private readonly failedThreshold: number;
  private readonly alertDedupWindowMs: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly emailQueueService: EmailQueueService,
    private readonly idempotencyService: IdempotencyService,
  ) {
    this.retentionSeconds = this.configService.get<number>('JOB_MONITORING_RETENTION_SECONDS', 7 * 24 * 60 * 60);
    this.maxEventHistory = this.configService.get<number>('JOB_MONITORING_MAX_EVENTS', 200);
    this.maxAlertHistory = this.configService.get<number>('JOB_MONITORING_MAX_ALERTS', 100);
    this.backlogThreshold = this.configService.get<number>('JOB_MONITORING_BACKLOG_THRESHOLD', 100);
    this.failedThreshold = this.configService.get<number>('JOB_MONITORING_FAILED_THRESHOLD', 10);
    this.alertDedupWindowMs = this.configService.get<number>('JOB_MONITORING_ALERT_DEDUP_MS', 15 * 60 * 1000);
  }

  async recordQueueEvent(
    queueName: JobQueueName,
    status: JobEventStatus,
    job: Pick<Job, 'id' | 'name' | 'attemptsMade' | 'opts' | 'timestamp' | 'processedOn' | 'finishedOn' | 'data'>,
    details?: {
      message?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const event: BackgroundJobEvent = {
      id: this.generateId('event'),
      queueName,
      jobId: job.id?.toString() || 'unknown',
      jobName: job.name || this.resolveJobName(job.data),
      status,
      attemptsMade: job.attemptsMade ?? 0,
      maxAttempts: Number(job.opts?.attempts ?? 1),
      timestamp: new Date().toISOString(),
      durationMs: this.calculateDuration(job),
      message: details?.message,
      metadata: details?.metadata,
    };

    await this.appendEvent(event);

    if (status === 'failed') {
      await this.createAlert({
        queueName,
        type: 'job_failed',
        severity: event.attemptsMade + 1 >= event.maxAttempts ? 'critical' : 'warning',
        message: `Job ${event.jobName} (${event.jobId}) failed in ${queueName} queue`,
        metadata: {
          attemptsMade: event.attemptsMade,
          maxAttempts: event.maxAttempts,
          reason: details?.message,
        },
      });
    }

    if (status === 'stalled') {
      await this.createAlert({
        queueName,
        type: 'job_stalled',
        severity: 'critical',
        message: `Job ${event.jobName} (${event.jobId}) stalled in ${queueName} queue`,
        metadata: {
          attemptsMade: event.attemptsMade,
        },
      });
    }
  }

  async recordScheduledExecution(
    jobName: string,
    status: 'success' | 'failed',
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const schedulerState = await this.getSchedulerState();
    schedulerState[jobName] = {
      jobName,
      status,
      timestamp: new Date().toISOString(),
      metadata,
    };

    await this.saveJson(this.schedulerKey, schedulerState);

    await this.appendEvent({
      id: this.generateId('event'),
      queueName: 'scheduler',
      jobId: jobName,
      jobName,
      status: status === 'success' ? 'scheduled_success' : 'scheduled_failure',
      attemptsMade: 1,
      maxAttempts: 1,
      timestamp: new Date().toISOString(),
      metadata,
      message: metadata?.message as string | undefined,
    });

    if (status === 'failed') {
      await this.createAlert({
        queueName: 'scheduler',
        type: 'scheduled_failure',
        severity: 'critical',
        message: `Scheduled job ${jobName} failed`,
        metadata,
      });
    }
  }

  async getDashboard() {
    const queueStats = await this.emailQueueService.getAllQueueStats();
    const alerts = await this.getAlerts(false);
    const events = await this.getRecentEvents();
    const schedulerState = await this.getSchedulerState();

    return {
      queues: queueStats,
      alerts: {
        unresolved: alerts.length,
        critical: alerts.filter(alert => alert.severity === 'critical').length,
        warning: alerts.filter(alert => alert.severity === 'warning').length,
      },
      recentEvents: events.slice(0, 20),
      scheduledJobs: Object.values(schedulerState),
      generatedAt: new Date().toISOString(),
    };
  }

  async getAlerts(resolved?: boolean): Promise<BackgroundJobAlert[]> {
    const alerts = await this.getAlertState();
    if (resolved === undefined) {
      return alerts;
    }

    return alerts.filter(alert => alert.resolved === resolved);
  }

  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
    const alerts = await this.getAlertState();
    const alert = alerts.find(item => item.id === alertId);

    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date().toISOString();
    await this.saveAlerts(alerts);
  }

  async resolveAlert(alertId: string): Promise<void> {
    const alerts = await this.getAlertState();
    const alert = alerts.find(item => item.id === alertId);

    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.resolved = true;
    alert.resolvedAt = new Date().toISOString();
    await this.saveAlerts(alerts);
  }

  async retryFailedJobs(queueName: JobQueueName | 'all' = 'all'): Promise<{ retried: number; skipped: number }> {
    // Generate idempotency key for this retry operation
    const idempotencyKey = this.idempotencyService.generateKey(
      'retry-failed-jobs',
      queueName,
      {
        timestamp: Date.now(),
        operation: 'bulk-retry',
      }
    );

    // Check if this retry operation was recently executed
    const idempotencyResult = await this.idempotencyService.checkDuplicate(
      idempotencyKey,
      {
        windowMs: 30 * 1000, // 30 seconds
        maxDuplicates: 1,
      },
      {
        queueName,
        operation: 'retry-failed-jobs',
      }
    );

    if (idempotencyResult.isDuplicate) {
      this.logger.warn(`Duplicate retry operation blocked for queue: ${queueName}`, {
        duplicateCount: idempotencyResult.duplicateCount,
        remainingWindow: idempotencyResult.remainingWindow,
      });

      return {
        retried: 0,
        skipped: 0,
      };
    }

    let totalRetried = 0;
    let totalSkipped = 0;

    if (queueName === 'all') {
      const [defaultJobs, priorityJobs, batchJobs] = await Promise.all([
        this.retryQueueWithDuplicateCheck('default'),
        this.retryQueueWithDuplicateCheck('priority'),
        this.retryQueueWithDuplicateCheck('batch'),
      ]);

      totalRetried = defaultJobs.retried + priorityJobs.retried + batchJobs.retried;
      totalSkipped = defaultJobs.skipped + priorityJobs.skipped + batchJobs.skipped;
    } else {
      const result = await this.retryQueueWithDuplicateCheck(queueName);
      totalRetried = result.retried;
      totalSkipped = result.skipped;
    }

    this.logger.log(`Retry operation completed for queue: ${queueName}`, {
      retried: totalRetried,
      skipped: totalSkipped,
      idempotencyKey,
    });

    return {
      retried: totalRetried,
      skipped: totalSkipped,
    };
  }

  private async retryQueueWithDuplicateCheck(queueName: JobQueueName): Promise<{ retried: number; skipped: number }> {
    const failedJobs = await this.emailQueueService.getFailedJobs(queueName, 100);
    let retried = 0;
    let skipped = 0;

    for (const job of failedJobs) {
      // Generate job-specific idempotency key
      const jobKey = this.idempotencyService.generateKey(
        'retry-single-job',
        job.id,
        {
          queueName,
          jobId: job.id,
          failedReason: job.failedReason,
        }
      );

      const jobResult = await this.idempotencyService.checkDuplicate(
        jobKey,
        {
          windowMs: 5 * 60 * 1000, // 5 minutes
          maxDuplicates: 1,
        },
        {
          queueName,
          jobId: job.id,
        }
      );

      if (jobResult.isDuplicate) {
        skipped++;
        this.logger.debug(`Skipping duplicate retry for job: ${job.id} in queue: ${queueName}`);
        continue;
      }

      try {
        await this.emailQueueService.retryFailedJobs(queueName);
        retried++;
        this.logger.debug(`Retried job: ${job.id} in queue: ${queueName}`);
      } catch (error) {
        this.logger.error(`Failed to retry job: ${job.id} in queue: ${queueName}`, error);
        skipped++;
      }
    }

    return { retried, skipped };
  }

  async getFailedJobs(queueName: JobQueueName, limit = 20) {
    return this.emailQueueService.getFailedJobs(queueName, limit);
  }

  async getRecentEvents(limit = 50): Promise<BackgroundJobEvent[]> {
    const events = await this.getEventState();
    return events.slice(0, limit);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async monitorQueueHealth(): Promise<void> {
    const stats = await this.emailQueueService.getAllQueueStats();
    const queueSummaries = [stats.default, stats.priority, stats.batch];

    for (const queue of queueSummaries) {
      if (queue.waiting >= this.backlogThreshold) {
        await this.createAlert({
          queueName: queue.queueName as JobQueueName,
          type: 'queue_backlog',
          severity: 'warning',
          message: `${queue.queueName} queue backlog is ${queue.waiting}`,
          metadata: {
            waiting: queue.waiting,
            active: queue.active,
          },
        });
      }

      if (queue.failed >= this.failedThreshold) {
        await this.createAlert({
          queueName: queue.queueName as JobQueueName,
          type: 'queue_failure_threshold',
          severity: 'critical',
          message: `${queue.queueName} queue has ${queue.failed} failed jobs`,
          metadata: {
            failed: queue.failed,
          },
        });
      }
    }
  }

  private async appendEvent(event: BackgroundJobEvent): Promise<void> {
    const events = await this.getEventState();
    events.unshift(event);
    await this.saveJson(this.eventsKey, events.slice(0, this.maxEventHistory));
  }

  private async createAlert(alertData: Omit<BackgroundJobAlert, 'id' | 'createdAt' | 'acknowledged' | 'resolved'>) {
    const alerts = await this.getAlertState();
    const now = Date.now();
    const existing = alerts.find(
      alert =>
        alert.queueName === alertData.queueName &&
        alert.type === alertData.type &&
        !alert.resolved &&
        new Date(alert.createdAt).getTime() >= now - this.alertDedupWindowMs,
    );

    if (existing) {
      return existing;
    }

    const alert: BackgroundJobAlert = {
      ...alertData,
      id: this.generateId('alert'),
      createdAt: new Date().toISOString(),
      acknowledged: false,
      resolved: false,
    };

    alerts.unshift(alert);
    await this.saveAlerts(alerts.slice(0, this.maxAlertHistory));
    this.logger.warn(`[${alert.severity}] ${alert.message}`);
    return alert;
  }

  private async getEventState(): Promise<BackgroundJobEvent[]> {
    return this.getJson<BackgroundJobEvent[]>(this.eventsKey, []);
  }

  private async getAlertState(): Promise<BackgroundJobAlert[]> {
    return this.getJson<BackgroundJobAlert[]>(this.alertsKey, []);
  }

  private async getSchedulerState(): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>(this.schedulerKey, {});
  }

  private async saveAlerts(alerts: BackgroundJobAlert[]): Promise<void> {
    await this.saveJson(this.alertsKey, alerts);
  }

  private async getJson<T>(key: string, fallback: T): Promise<T> {
    try {
      const value = await this.redisService.get(key);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch (error) {
      this.logger.warn(`Failed to read monitoring state for ${key}: ${(error as Error).message}`);
      return fallback;
    }
  }

  private async saveJson<T>(key: string, value: T): Promise<void> {
    try {
      await this.redisService.setex(key, this.retentionSeconds, JSON.stringify(value));
    } catch (error) {
      this.logger.warn(`Failed to save monitoring state for ${key}: ${(error as Error).message}`);
    }
  }

  private calculateDuration(job: Pick<Job, 'timestamp' | 'processedOn' | 'finishedOn'>): number | undefined {
    if (job.processedOn && job.finishedOn) {
      return job.finishedOn - job.processedOn;
    }

    if (job.processedOn) {
      return Date.now() - job.processedOn;
    }

    if (job.timestamp) {
      return Date.now() - job.timestamp;
    }

    return undefined;
  }

  private resolveJobName(data: unknown): string {
    if (data && typeof data === 'object' && 'type' in data && typeof (data as { type?: unknown }).type === 'string') {
      return (data as { type: string }).type;
    }

    return 'unnamed-job';
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
