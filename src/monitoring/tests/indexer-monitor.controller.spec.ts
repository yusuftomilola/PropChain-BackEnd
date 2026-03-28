import { Test, TestingModule } from '@nestjs/testing';
import { IndexerMonitorController } from '../indexer-monitor.controller';
import { IndexerMonitorService } from '../../indexer-monitor.service';
import { IndexerAlert, IndexerMetrics } from '../../indexer-monitor.service';

describe('IndexerMonitorController', () => {
  let controller: IndexerMonitorController;
  let service: IndexerMonitorService;

  const mockIndexerMonitorService = {
    getHealthStatus: jest.fn(),
    getMetrics: jest.fn(),
    getActiveAlerts: jest.fn(),
    resolveAlert: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IndexerMonitorController],
      providers: [
        {
          provide: IndexerMonitorService,
          useValue: mockIndexerMonitorService,
        },
      ],
    }).compile();

    controller = module.get<IndexerMonitorController>(IndexerMonitorController);
    service = module.get<IndexerMonitorService>(IndexerMonitorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return health status', async () => {
      const healthStatus = {
        healthy: true,
        details: {
          currentHeight: 1000,
          targetHeight: 1000,
          drift: 0,
          lastCheckTime: new Date(),
          isHealthy: true,
          alertsCount: 0,
        },
        alerts: [],
      };

      mockIndexerMonitorService.getHealthStatus.mockResolvedValue(healthStatus);

      const result = await controller.getHealth();

      expect(service.getHealthStatus).toHaveBeenCalled();
      expect(result).toEqual(healthStatus);
    });

    it('should return unhealthy status', async () => {
      const healthStatus = {
        healthy: false,
        details: {
          currentHeight: 900,
          targetHeight: 1000,
          drift: 100,
          lastCheckTime: new Date(),
          isHealthy: false,
          alertsCount: 2,
        },
        alerts: [
          {
            id: 'alert1',
            type: 'HIGH_DRIFT',
            severity: 'CRITICAL',
            message: 'Critical indexer drift: 100 blocks behind target',
            currentHeight: 900,
            targetHeight: 1000,
            drift: 100,
            timestamp: new Date(),
            resolved: false,
          },
        ],
      };

      mockIndexerMonitorService.getHealthStatus.mockResolvedValue(healthStatus);

      const result = await controller.getHealth();

      expect(service.getHealthStatus).toHaveBeenCalled();
      expect(result).toEqual(healthStatus);
      expect(result.healthy).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('should return indexer metrics', async () => {
      const metrics: IndexerMetrics = {
        currentHeight: 995,
        targetHeight: 1000,
        drift: 5,
        lastCheckTime: new Date(),
        isHealthy: true,
        alertsCount: 0,
      };

      mockIndexerMonitorService.getMetrics.mockResolvedValue(metrics);

      const result = await controller.getMetrics();

      expect(service.getMetrics).toHaveBeenCalled();
      expect(result).toEqual(metrics);
    });
  });

  describe('getAlerts', () => {
    it('should return active alerts', async () => {
      const alerts: IndexerAlert[] = [
        {
          id: 'alert1',
          type: 'HIGH_DRIFT',
          severity: 'WARNING',
          message: 'Warning: Indexer drift of 15 blocks detected',
          currentHeight: 985,
          targetHeight: 1000,
          drift: 15,
          timestamp: new Date(),
          resolved: false,
        },
        {
          id: 'alert2',
          type: 'STALLED_INDEXER',
          severity: 'WARNING',
          message: 'Indexer appears stalled - no new blocks for 6 minutes',
          timestamp: new Date(),
          resolved: false,
        },
      ];

      mockIndexerMonitorService.getActiveAlerts.mockResolvedValue(alerts);

      const result = await controller.getAlerts();

      expect(service.getActiveAlerts).toHaveBeenCalled();
      expect(result).toEqual(alerts);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no active alerts', async () => {
      mockIndexerMonitorService.getActiveAlerts.mockResolvedValue([]);

      const result = await controller.getAlerts();

      expect(service.getActiveAlerts).toHaveBeenCalled();
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('resolveAlert', () => {
    it('should resolve an alert successfully', async () => {
      mockIndexerMonitorService.resolveAlert.mockResolvedValue(true);

      const result = await controller.resolveAlert('alert1');

      expect(service.resolveAlert).toHaveBeenCalledWith('alert1');
      expect(result).toEqual({ resolved: true, alertId: 'alert1' });
    });

    it('should return false when alert not found', async () => {
      mockIndexerMonitorService.resolveAlert.mockResolvedValue(false);

      const result = await controller.resolveAlert('non-existent-alert');

      expect(service.resolveAlert).toHaveBeenCalledWith('non-existent-alert');
      expect(result).toEqual({ resolved: false, alertId: 'non-existent-alert' });
    });
  });

  describe('getStatus', () => {
    it('should return simple status for healthy indexer', async () => {
      const healthStatus = {
        healthy: true,
        details: {
          currentHeight: 1000,
          targetHeight: 1000,
          drift: 0,
          lastCheckTime: new Date('2023-01-01T12:00:00Z'),
          isHealthy: true,
          alertsCount: 0,
        },
        alerts: [],
      };

      mockIndexerMonitorService.getHealthStatus.mockResolvedValue(healthStatus);

      const result = await controller.getStatus();

      expect(service.getHealthStatus).toHaveBeenCalled();
      expect(result.status).toBe('healthy');
      expect(result.alertsCount).toBe(0);
      expect(result.metrics).toEqual(healthStatus.details);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return simple status for unhealthy indexer', async () => {
      const healthStatus = {
        healthy: false,
        details: {
          currentHeight: 900,
          targetHeight: 1000,
          drift: 100,
          lastCheckTime: new Date('2023-01-01T12:00:00Z'),
          isHealthy: false,
          alertsCount: 3,
        },
        alerts: [
          {
            id: 'alert1',
            type: 'HIGH_DRIFT',
            severity: 'CRITICAL',
            message: 'Critical indexer drift: 100 blocks behind target',
            timestamp: new Date(),
            resolved: false,
          },
        ],
      };

      mockIndexerMonitorService.getHealthStatus.mockResolvedValue(healthStatus);

      const result = await controller.getStatus();

      expect(service.getHealthStatus).toHaveBeenCalled();
      expect(result.status).toBe('unhealthy');
      expect(result.alertsCount).toBe(3);
      expect(result.metrics).toEqual(healthStatus.details);
    });

    it('should include timestamp in status response', async () => {
      const healthStatus = {
        healthy: true,
        details: {
          currentHeight: 1000,
          targetHeight: 1000,
          drift: 0,
          lastCheckTime: new Date(),
          isHealthy: true,
          alertsCount: 0,
        },
        alerts: [],
      };

      mockIndexerMonitorService.getHealthStatus.mockResolvedValue(healthStatus);

      const result = await controller.getStatus();

      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });
  });
});
