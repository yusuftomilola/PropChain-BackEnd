/**
 * @fileoverview Service to monitor blockchain indexer drift and failures.
 * @issue #208
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge, Counter } from 'prom-client';
import { PrismaService } from '../database/prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service'; // Assuming a blockchain service exists

export interface IndexerAlert {
  id: string;
  type: 'HIGH_DRIFT' | 'STALLED_INDEXER' | 'BLOCKCHAIN_UNAVAILABLE' | 'DATABASE_ERROR';
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  currentHeight?: number;
  targetHeight?: number;
  drift?: number;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface IndexerMetrics {
  currentHeight: number;
  targetHeight: number;
  drift: number;
  lastCheckTime: Date;
  isHealthy: boolean;
  alertsCount: number;
}

@Injectable()
export class IndexerMonitorService {
  private readonly logger = new Logger(IndexerMonitorService.name);
  private alerts: Map<string, IndexerAlert> = new Map();
  private consecutiveFailures = 0;
  private lastSuccessfulCheck?: Date;
  private readonly maxConsecutiveFailures = 5;
  private readonly criticalDriftThreshold = 50;
  private readonly warningDriftThreshold = 10;
  private readonly stalledThreshold = 5; // minutes

  constructor(
    @InjectMetric('propchain_indexer_current_height')
    private readonly currentHeightGauge: Gauge<string>,
    @InjectMetric('propchain_indexer_target_height')
    private readonly targetHeightGauge: Gauge<string>,
    @InjectMetric('propchain_indexer_height_drift')
    private readonly driftGauge: Gauge<string>,
    @InjectMetric('propchain_indexer_alerts_total')
    private readonly alertsCounter: Counter<string>,
    @InjectMetric('propchain_indexer_health_status')
    private readonly healthStatusGauge: Gauge<string>,
    @InjectMetric('propchain_indexer_consecutive_failures')
    private readonly consecutiveFailuresGauge: Gauge<string>,
    @InjectMetric('propchain_indexer_last_check_timestamp')
    private readonly lastCheckGauge: Gauge<string>,
    private readonly prisma: PrismaService,
    private readonly blockchainService: BlockchainService,
  ) { }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkIndexerDrift() {
    this.logger.debug('Checking for indexer drift...');
    const checkStartTime = Date.now();

    try {
      const targetHeight = await this.blockchainService.getLatestBlockHeight();
      const lastIndexedBlock = await this.prisma.block.findFirst({
        orderBy: { height: 'desc' },
      });

      const currentHeight = lastIndexedBlock?.height ?? 0;
      const drift = targetHeight - currentHeight;
      const now = new Date();

      // Update Prometheus metrics
      this.currentHeightGauge.set(currentHeight);
      this.targetHeightGauge.set(targetHeight);
      this.driftGauge.set(drift);
      this.lastCheckGauge.set(now.getTime() / 1000);

      // Determine health status
      const isHealthy = this.determineHealthStatus(drift, currentHeight);
      this.healthStatusGauge.set(isHealthy ? 1 : 0);

      // Reset consecutive failures on success
      this.consecutiveFailures = 0;
      this.lastSuccessfulCheck = now;
      this.consecutiveFailuresGauge.set(0);

      // Check for various failure scenarios
      await this.checkForAlerts(currentHeight, targetHeight, drift, now);

      // Log appropriate level based on severity
      if (drift > this.criticalDriftThreshold) {
        this.logger.error(
          `CRITICAL: High indexer drift detected! Drift is ${drift} blocks. (Current: ${currentHeight}, Target: ${targetHeight})`,
        );
      } else if (drift > this.warningDriftThreshold) {
        this.logger.warn(
          `WARNING: Indexer drift detected! Drift is ${drift} blocks. (Current: ${currentHeight}, Target: ${targetHeight})`,
        );
      } else {
        this.logger.log(
          `Indexer is healthy. Drift is ${drift} blocks. (Current: ${currentHeight}, Target: ${targetHeight})`,
        );
      }

      // Check for stalled indexer
      await this.checkForStalledIndexer(lastIndexedBlock?.createdAt, now);

    } catch (error) {
      this.consecutiveFailures++;
      this.consecutiveFailuresGauge.set(this.consecutiveFailures);

      this.logger.error(`Failed to check indexer drift (attempt ${this.consecutiveFailures}/${this.maxConsecutiveFailures})`, error.stack);
      this.driftGauge.set(-1); // Use -1 to indicate a check failure
      this.healthStatusGauge.set(0);

      // Create alert for consecutive failures
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        await this.createAlert({
          type: 'BLOCKCHAIN_UNAVAILABLE',
          severity: 'CRITICAL',
          message: `Indexer monitor has failed ${this.consecutiveFailures} consecutive times. Last error: ${error.message}`,
          timestamp: new Date(),
        });
      }

      // Create alert for database errors specifically
      if (error.message?.includes('database') || error.message?.includes('prisma')) {
        await this.createAlert({
          type: 'DATABASE_ERROR',
          severity: 'CRITICAL',
          message: `Database error during indexer check: ${error.message}`,
          timestamp: new Date(),
        });
      }
    }

    // Clean up old resolved alerts
    await this.cleanupOldAlerts();
  }

  private determineHealthStatus(drift: number, currentHeight: number): boolean {
    if (drift > this.criticalDriftThreshold || currentHeight === 0) {
      return false;
    }

    if (this.consecutiveFailures > 0) {
      return false;
    }

    if (!this.lastSuccessfulCheck) {
      return false;
    }

    // Check if last successful check was too long ago
    const timeSinceLastSuccess = Date.now() - this.lastSuccessfulCheck.getTime();
    const maxTimeWithoutSuccess = 10 * 60 * 1000; // 10 minutes
    if (timeSinceLastSuccess > maxTimeWithoutSuccess) {
      return false;
    }

    return drift <= this.warningDriftThreshold;
  }

  private async checkForAlerts(currentHeight: number, targetHeight: number, drift: number, timestamp: Date) {
    // Check for high drift alert
    if (drift > this.criticalDriftThreshold) {
      await this.createAlert({
        type: 'HIGH_DRIFT',
        severity: 'CRITICAL',
        message: `Critical indexer drift: ${drift} blocks behind target`,
        currentHeight,
        targetHeight,
        drift,
        timestamp,
      });
    } else if (drift > this.warningDriftThreshold) {
      await this.createAlert({
        type: 'HIGH_DRIFT',
        severity: 'WARNING',
        message: `Warning: Indexer drift of ${drift} blocks detected`,
        currentHeight,
        targetHeight,
        drift,
        timestamp,
      });
    }

    // Check for stalled indexer (no new blocks for a long time)
    if (currentHeight > 0 && drift === 0) {
      // If drift is 0 but we haven't seen new blocks, check if indexer is stalled
      const lastIndexedBlock = await this.prisma.block.findFirst({
        orderBy: { height: 'desc' },
      });

      if (lastIndexedBlock?.createdAt) {
        await this.checkForStalledIndexer(lastIndexedBlock.createdAt, timestamp);
      }
    }
  }

  private async checkForStalledIndexer(lastBlockTime?: Date, currentTime = new Date()) {
    if (!lastBlockTime) {
      return;
    }

    const timeSinceLastBlock = currentTime.getTime() - lastBlockTime.getTime();
    const stalledThresholdMs = this.stalledThreshold * 60 * 1000;

    if (timeSinceLastBlock > stalledThresholdMs) {
      const stalledMinutes = Math.floor(timeSinceLastBlock / (60 * 1000));
      await this.createAlert({
        type: 'STALLED_INDEXER',
        severity: 'WARNING',
        message: `Indexer appears stalled - no new blocks for ${stalledMinutes} minutes`,
        timestamp: currentTime,
      });
    }
  }

  private async createAlert(alert: Omit<IndexerAlert, 'id' | 'resolved'>) {
    const alertId = `${alert.type}_${Date.now()}`;
    const fullAlert: IndexerAlert = {
      ...alert,
      id: alertId,
      resolved: false,
    };

    // Check if similar alert already exists and is unresolved
    const existingAlert = Array.from(this.alerts.values()).find(
      a => a.type === alert.type && !a.resolved
    );

    if (existingAlert) {
      // Update existing alert instead of creating duplicate
      existingAlert.message = alert.message;
      existingAlert.timestamp = alert.timestamp;
      existingAlert.currentHeight = alert.currentHeight;
      existingAlert.targetHeight = alert.targetHeight;
      existingAlert.drift = alert.drift;
      return;
    }

    this.alerts.set(alertId, fullAlert);
    this.alertsCounter.inc({ type: alert.type, severity: alert.severity });

    this.logger.warn(`Indexer alert created: ${alert.type} - ${alert.message}`, {
      alertId,
      type: alert.type,
      severity: alert.severity,
      currentHeight: alert.currentHeight,
      targetHeight: alert.targetHeight,
      drift: alert.drift,
    });
  }

  private async cleanupOldAlerts() {
    const now = new Date();
    const cleanupThreshold = 24 * 60 * 60 * 1000; // 24 hours

    for (const [alertId, alert] of this.alerts.entries()) {
      if (alert.resolved && (now.getTime() - alert.resolvedAt!.getTime() > cleanupThreshold)) {
        this.alerts.delete(alertId);
      }
    }
  }

  // Public methods for external access
  async getMetrics(): Promise<IndexerMetrics> {
    const lastIndexedBlock = await this.prisma.block.findFirst({
      orderBy: { height: 'desc' },
    });

    const currentHeight = lastIndexedBlock?.height ?? 0;
    const targetHeight = await this.blockchainService.getLatestBlockHeight().catch(() => 0);
    const drift = targetHeight - currentHeight;
    const isHealthy = this.determineHealthStatus(drift, currentHeight);

    return {
      currentHeight,
      targetHeight,
      drift,
      lastCheckTime: this.lastSuccessfulCheck || new Date(),
      isHealthy,
      alertsCount: Array.from(this.alerts.values()).filter(a => !a.resolved).length,
    };
  }

  async getActiveAlerts(): Promise<IndexerAlert[]> {
    return Array.from(this.alerts.values()).filter(alert => !alert.resolved);
  }

  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      this.logger.log(`Indexer alert resolved: ${alertId}`);
      return true;
    }
    return false;
  }

  async getHealthStatus(): Promise<{ healthy: boolean; details: IndexerMetrics; alerts: IndexerAlert[] }> {
    const metrics = await this.getMetrics();
    const alerts = await this.getActiveAlerts();

    return {
      healthy: metrics.isHealthy && alerts.length === 0,
      details: metrics,
      alerts,
    };
  }
}