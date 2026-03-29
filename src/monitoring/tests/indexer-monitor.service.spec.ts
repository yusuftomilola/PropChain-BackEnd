import { Test, TestingModule } from '@nestjs/testing';
import { IndexerMonitorService, IndexerAlert } from '../indexer-monitor.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { BlockchainService } from '../../blockchain/blockchain.service';
import { Gauge, Counter } from 'prom-client';

describe('IndexerMonitorService', () => {
  let service: IndexerMonitorService;
  let prisma: PrismaService;
  let blockchainService: BlockchainService;
  let currentHeightGauge: Gauge<string>;
  let targetHeightGauge: Gauge<string>;
  let driftGauge: Gauge<string>;
  let alertsCounter: Counter<string>;
  let healthStatusGauge: Gauge<string>;
  let consecutiveFailuresGauge: Gauge<string>;
  let lastCheckGauge: Gauge<string>;

  const mockPrisma = {
    block: {
      findFirst: jest.fn(),
    },
  };

  const mockBlockchainService = {
    getLatestBlockHeight: jest.fn(),
  };

  const mockGauge = () => ({
    set: jest.fn(),
  });

  const mockCounter = () => ({
    inc: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerMonitorService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: BlockchainService,
          useValue: mockBlockchainService,
        },
        {
          provide: 'propchain_indexer_current_height',
          useValue: mockGauge(),
        },
        {
          provide: 'propchain_indexer_target_height',
          useValue: mockGauge(),
        },
        {
          provide: 'propchain_indexer_height_drift',
          useValue: mockGauge(),
        },
        {
          provide: 'propchain_indexer_alerts_total',
          useValue: mockCounter(),
        },
        {
          provide: 'propchain_indexer_health_status',
          useValue: mockGauge(),
        },
        {
          provide: 'propchain_indexer_consecutive_failures',
          useValue: mockGauge(),
        },
        {
          provide: 'propchain_indexer_last_check_timestamp',
          useValue: mockGauge(),
        },
      ],
    }).compile();

    service = module.get<IndexerMonitorService>(IndexerMonitorService);
    prisma = module.get<PrismaService>(PrismaService);
    blockchainService = module.get<BlockchainService>(BlockchainService);
    currentHeightGauge = module.get('propchain_indexer_current_height');
    targetHeightGauge = module.get('propchain_indexer_target_height');
    driftGauge = module.get('propchain_indexer_height_drift');
    alertsCounter = module.get('propchain_indexer_alerts_total');
    healthStatusGauge = module.get('propchain_indexer_health_status');
    consecutiveFailuresGauge = module.get('propchain_indexer_consecutive_failures');
    lastCheckGauge = module.get('propchain_indexer_last_check_timestamp');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkIndexerDrift', () => {
    it('should update metrics and log healthy status', async () => {
      mockBlockchainService.getLatestBlockHeight.mockResolvedValue(1000);
      mockPrisma.block.findFirst.mockResolvedValue({ height: 995, createdAt: new Date() });

      await service.checkIndexerDrift();

      expect(currentHeightGauge.set).toHaveBeenCalledWith(995);
      expect(targetHeightGauge.set).toHaveBeenCalledWith(1000);
      expect(driftGauge.set).toHaveBeenCalledWith(5);
      expect(healthStatusGauge.set).toHaveBeenCalledWith(1);
      expect(consecutiveFailuresGauge.set).toHaveBeenCalledWith(0);
    });

    it('should create warning alert for high drift', async () => {
      mockBlockchainService.getLatestBlockHeight.mockResolvedValue(1000);
      mockPrisma.block.findFirst.mockResolvedValue({ height: 985, createdAt: new Date() });

      await service.checkIndexerDrift();

      const alerts = await service.getActiveAlerts();
      const highDriftAlerts = alerts.filter(alert => alert.type === 'HIGH_DRIFT' && alert.severity === 'WARNING');
      expect(highDriftAlerts).toHaveLength(1);
      expect(highDriftAlerts[0].drift).toBe(15);
    });

    it('should create critical alert for very high drift', async () => {
      mockBlockchainService.getLatestBlockHeight.mockResolvedValue(1000);
      mockPrisma.block.findFirst.mockResolvedValue({ height: 900, createdAt: new Date() });

      await service.checkIndexerDrift();

      const alerts = await service.getActiveAlerts();
      const criticalAlerts = alerts.filter(alert => alert.type === 'HIGH_DRIFT' && alert.severity === 'CRITICAL');
      expect(criticalAlerts).toHaveLength(1);
      expect(criticalAlerts[0].drift).toBe(100);
    });

    it('should handle blockchain service failures', async () => {
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Blockchain unavailable'));

      await service.checkIndexerDrift();

      expect(driftGauge.set).toHaveBeenCalledWith(-1);
      expect(healthStatusGauge.set).toHaveBeenCalledWith(0);
      expect(consecutiveFailuresGauge.set).toHaveBeenCalledWith(1);
    });

    it('should create alert after consecutive failures', async () => {
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Persistent failure'));

      // Simulate 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        await service.checkIndexerDrift();
      }

      const alerts = await service.getActiveAlerts();
      const blockchainAlerts = alerts.filter(alert => alert.type === 'BLOCKCHAIN_UNAVAILABLE');
      expect(blockchainAlerts).toHaveLength(1);
      expect(blockchainAlerts[0].severity).toBe('CRITICAL');
    });

    it('should detect stalled indexer', async () => {
      const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      mockBlockchainService.getLatestBlockHeight.mockResolvedValue(1000);
      mockPrisma.block.findFirst.mockResolvedValue({ height: 1000, createdAt: oldDate });

      await service.checkIndexerDrift();

      const alerts = await service.getActiveAlerts();
      const stalledAlerts = alerts.filter(alert => alert.type === 'STALLED_INDEXER');
      expect(stalledAlerts).toHaveLength(1);
      expect(stalledAlerts[0].message).toContain('no new blocks for');
    });

    it('should create database error alert for database failures', async () => {
      mockPrisma.block.findFirst.mockRejectedValue(new Error('Database connection failed'));

      await service.checkIndexerDrift();

      const alerts = await service.getActiveAlerts();
      const dbAlerts = alerts.filter(alert => alert.type === 'DATABASE_ERROR');
      expect(dbAlerts).toHaveLength(1);
      expect(dbAlerts[0].severity).toBe('CRITICAL');
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', async () => {
      mockPrisma.block.findFirst.mockResolvedValue({ height: 995 });
      mockBlockchainService.getLatestBlockHeight.mockResolvedValue(1000);

      const metrics = await service.getMetrics();

      expect(metrics.currentHeight).toBe(995);
      expect(metrics.targetHeight).toBe(1000);
      expect(metrics.drift).toBe(5);
      expect(metrics.isHealthy).toBe(true);
      expect(metrics.alertsCount).toBe(0);
    });

    it('should handle blockchain service failure in metrics', async () => {
      mockPrisma.block.findFirst.mockResolvedValue({ height: 995 });
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Failed'));

      const metrics = await service.getMetrics();

      expect(metrics.currentHeight).toBe(995);
      expect(metrics.targetHeight).toBe(0);
      expect(metrics.drift).toBe(-995);
      expect(metrics.isHealthy).toBe(false);
    });
  });

  describe('getActiveAlerts', () => {
    it('should return only active alerts', async () => {
      // Create an alert
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Test error'));
      for (let i = 0; i < 5; i++) {
        await service.checkIndexerDrift();
      }

      const alerts = await service.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.every(alert => !alert.resolved)).toBe(true);
    });
  });

  describe('resolveAlert', () => {
    it('should resolve an existing alert', async () => {
      // Create an alert first
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Test error'));
      for (let i = 0; i < 5; i++) {
        await service.checkIndexerDrift();
      }

      const alerts = await service.getActiveAlerts();
      const alertId = alerts[0].id;

      const resolved = await service.resolveAlert(alertId);
      expect(resolved).toBe(true);

      const activeAlerts = await service.getActiveAlerts();
      expect(activeAlerts.find(alert => alert.id === alertId)).toBeUndefined();
    });

    it('should return false for non-existent alert', async () => {
      const resolved = await service.resolveAlert('non-existent-id');
      expect(resolved).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when no issues', async () => {
      mockPrisma.block.findFirst.mockResolvedValue({ height: 995, createdAt: new Date() });
      mockBlockchainService.getLatestBlockHeight.mockResolvedValue(1000);

      const health = await service.getHealthStatus();

      expect(health.healthy).toBe(true);
      expect(health.details.isHealthy).toBe(true);
      expect(health.alerts).toHaveLength(0);
    });

    it('should return unhealthy status when alerts exist', async () => {
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Test error'));
      for (let i = 0; i < 5; i++) {
        await service.checkIndexerDrift();
      }

      const health = await service.getHealthStatus();

      expect(health.healthy).toBe(false);
      expect(health.alerts.length).toBeGreaterThan(0);
    });

    it('should return unhealthy status when metrics indicate unhealthy', async () => {
      mockPrisma.block.findFirst.mockResolvedValue({ height: 900, createdAt: new Date() });
      mockBlockchainService.getLatestBlockHeight.mockResolvedValue(1000);

      const health = await service.getHealthStatus();

      expect(health.healthy).toBe(false);
      expect(health.details.isHealthy).toBe(false);
    });
  });

  describe('alert deduplication', () => {
    it('should not create duplicate alerts of same type', async () => {
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Persistent failure'));

      // Trigger multiple checks
      for (let i = 0; i < 3; i++) {
        await service.checkIndexerDrift();
      }

      const alerts = await service.getActiveAlerts();
      const blockchainAlerts = alerts.filter(alert => alert.type === 'BLOCKCHAIN_UNAVAILABLE');
      expect(blockchainAlerts).toHaveLength(1);
    });

    it('should update existing alert instead of creating duplicate', async () => {
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('First error'));

      // First check creates alert
      await service.checkIndexerDrift();
      const firstAlerts = await service.getActiveAlerts();
      const firstAlert = firstAlerts[0];

      // Second check updates alert
      mockBlockchainService.getLatestBlockHeight.mockRejectedValue(new Error('Second error'));
      await service.checkIndexerDrift();

      const secondAlerts = await service.getActiveAlerts();
      const secondAlert = secondAlerts[0];

      expect(secondAlerts).toHaveLength(1);
      expect(secondAlert.id).toBe(firstAlert.id);
      expect(secondAlert.message).toContain('Second error');
    });
  });
});
