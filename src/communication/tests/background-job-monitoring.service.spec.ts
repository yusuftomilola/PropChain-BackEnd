import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackgroundJobMonitoringService, JobQueueName } from '../jobs/background-job-monitoring.service';
import { RedisService } from '../../common/services/redis.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { EmailQueueService } from '../email/email.queue';

describe('BackgroundJobMonitoringService', () => {
  let service: BackgroundJobMonitoringService;
  let redisService: RedisService;
  let idempotencyService: IdempotencyService;
  let emailQueueService: EmailQueueService;
  let configService: ConfigService;

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    lpush: jest.fn(),
    rpush: jest.fn(),
    lrange: jest.fn(),
    ltrim: jest.fn(),
    expire: jest.fn(),
  };

  const mockIdempotencyService = {
    generateKey: jest.fn(),
    checkDuplicate: jest.fn(),
    clearKey: jest.fn(),
    getCount: jest.fn(),
  };

  const mockEmailQueueService = {
    retryFailedJobs: jest.fn(),
    getFailedJobs: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackgroundJobMonitoringService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: IdempotencyService,
          useValue: mockIdempotencyService,
        },
        {
          provide: EmailQueueService,
          useValue: mockEmailQueueService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<BackgroundJobMonitoringService>(BackgroundJobMonitoringService);
    redisService = module.get<RedisService>(RedisService);
    idempotencyService = module.get<IdempotencyService>(IdempotencyService);
    emailQueueService = module.get<EmailQueueService>(EmailQueueService);
    configService = module.get<ConfigService>(ConfigService);

    // Mock default config values
    mockConfigService.mockImplementation((key: string, defaultValue?: any) => {
      const config = {
        'JOB_MONITORING_RETENTION_SECONDS': 604800,
        'JOB_MONITORING_MAX_EVENTS': 200,
        'JOB_MONITORING_MAX_ALERTS': 100,
        'JOB_MONITORING_BACKLOG_THRESHOLD': 100,
        'JOB_MONITORING_FAILED_THRESHOLD': 10,
        'JOB_MONITORING_ALERT_DEDUP_MS': 900000,
      };
      return config[key] || defaultValue;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('retryFailedJobs', () => {
    it('should block duplicate retry operations for all queues', async () => {
      mockIdempotencyService.generateKey.mockReturnValue('retry-failed-jobs:all:abc123');
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: true,
        duplicateCount: 1,
        remainingWindow: 15000,
        key: 'idempotency:retry-failed-jobs:all:abc123',
      });

      const result = await service.retryFailedJobs('all');

      expect(result).toEqual({ retried: 0, skipped: 0 });
      expect(mockIdempotencyService.checkDuplicate).toHaveBeenCalledWith(
        'retry-failed-jobs:all:abc123',
        { windowMs: 30000, maxDuplicates: 1 },
        { queueName: 'all', operation: 'retry-failed-jobs' }
      );
      expect(mockEmailQueueService.retryFailedJobs).not.toHaveBeenCalled();
    });

    it('should allow first retry operation for all queues', async () => {
      mockIdempotencyService.generateKey.mockReturnValue('retry-failed-jobs:all:abc123');
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: 30000,
        key: 'idempotency:retry-failed-jobs:all:abc123',
      });

      mockEmailQueueService.retryFailedJobs.mockResolvedValue(5);
      mockEmailQueueService.getFailedJobs.mockResolvedValue([]);

      const result = await service.retryFailedJobs('all');

      expect(result.retried).toBeGreaterThan(0);
      expect(mockEmailQueueService.retryFailedJobs).toHaveBeenCalledTimes(3);
    });

    it('should block duplicate retry operations for specific queue', async () => {
      mockIdempotencyService.generateKey.mockReturnValue('retry-failed-jobs:default:abc123');
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: true,
        duplicateCount: 1,
        remainingWindow: 15000,
        key: 'idempotency:retry-failed-jobs:default:abc123',
      });

      const result = await service.retryFailedJobs('default');

      expect(result).toEqual({ retried: 0, skipped: 0 });
      expect(mockEmailQueueService.retryFailedJobs).not.toHaveBeenCalled();
    });

    it('should allow first retry operation for specific queue', async () => {
      mockIdempotencyService.generateKey.mockReturnValue('retry-failed-jobs:default:abc123');
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: 30000,
        key: 'idempotency:retry-failed-jobs:default:abc123',
      });

      mockEmailQueueService.getFailedJobs.mockResolvedValue([
        { id: 'job1', failedReason: 'timeout' },
        { id: 'job2', failedReason: 'network' },
      ]);
      mockIdempotencyService.generateKey.mockImplementation((operation, identifier, context) => {
        if (operation === 'retry-single-job') {
          return `retry-single-job:${identifier}:${JSON.stringify(context)}`;
        }
        return 'retry-failed-jobs:default:abc123';
      });
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: 300000,
        key: 'idempotency:retry-single-job:job1',
      });
      mockEmailQueueService.retryFailedJobs.mockResolvedValue(2);

      const result = await service.retryFailedJobs('default');

      expect(result.retried).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should skip duplicate job retries within a queue', async () => {
      mockIdempotencyService.generateKey.mockReturnValue('retry-failed-jobs:default:abc123');
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: 30000,
        key: 'idempotency:retry-failed-jobs:default:abc123',
      });

      mockEmailQueueService.getFailedJobs.mockResolvedValue([
        { id: 'job1', failedReason: 'timeout' },
        { id: 'job2', failedReason: 'network' },
      ]);

      // Mock job-specific idempotency checks
      mockIdempotencyService.generateKey.mockImplementation((operation, identifier, context) => {
        if (operation === 'retry-single-job') {
          return `retry-single-job:${identifier}:${JSON.stringify(context)}`;
        }
        return 'retry-failed-jobs:default:abc123';
      });

      mockIdempotencyService.checkDuplicate.mockImplementation((key) => {
        if (key.includes('job1')) {
          return Promise.resolve({
            isDuplicate: true,
            duplicateCount: 1,
            remainingWindow: 15000,
            key: 'idempotency:retry-single-job:job1',
          });
        }
        return Promise.resolve({
          isDuplicate: false,
          duplicateCount: 0,
          remainingWindow: 300000,
          key: 'idempotency:retry-single-job:job2',
        });
      });

      mockEmailQueueService.retryFailedJobs.mockResolvedValue(1);

      const result = await service.retryFailedJobs('default');

      expect(result.retried).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should handle retry failures gracefully', async () => {
      mockIdempotencyService.generateKey.mockReturnValue('retry-failed-jobs:default:abc123');
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: 30000,
        key: 'idempotency:retry-failed-jobs:default:abc123',
      });

      mockEmailQueueService.getFailedJobs.mockResolvedValue([
        { id: 'job1', failedReason: 'timeout' },
      ]);

      mockIdempotencyService.generateKey.mockImplementation((operation, identifier, context) => {
        if (operation === 'retry-single-job') {
          return `retry-single-job:${identifier}:${JSON.stringify(context)}`;
        }
        return 'retry-failed-jobs:default:abc123';
      });

      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: 300000,
        key: 'idempotency:retry-single-job:job1',
      });

      mockEmailQueueService.retryFailedJobs.mockRejectedValue(new Error('Service unavailable'));

      const result = await service.retryFailedJobs('default');

      expect(result.retried).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('retryQueueWithDuplicateCheck', () => {
    it('should generate unique keys for each job', async () => {
      const failedJobs = [
        { id: 'job1', failedReason: 'timeout' },
        { id: 'job2', failedReason: 'network' },
      ];

      mockEmailQueueService.getFailedJobs.mockResolvedValue(failedJobs);
      mockIdempotencyService.checkDuplicate.mockResolvedValue({
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: 300000,
        key: 'idempotency:retry-single-job:job',
      });
      mockEmailQueueService.retryFailedJobs.mockResolvedValue(1);

      // Access private method for testing
      const retryMethod = (service as any).retryQueueWithDuplicateCheck.bind(service);
      const result = await retryMethod('default');

      expect(mockIdempotencyService.generateKey).toHaveBeenCalledTimes(3); // Once for operation, twice for jobs
      expect(result.retried).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should use appropriate window for different check types', async () => {
      mockEmailQueueService.getFailedJobs.mockResolvedValue([{ id: 'job1', failedReason: 'timeout' }]);

      // Mock the generateKey to return different patterns
      mockIdempotencyService.generateKey.mockImplementation((operation, identifier, context) => {
        if (operation === 'retry-single-job') {
          return `retry-single-job:${identifier}:${JSON.stringify(context)}`;
        }
        return 'retry-failed-jobs:default:abc123';
      });

      // Check that job-specific checks use 5-minute window
      mockIdempotencyService.checkDuplicate.mockImplementation((key, config) => {
        if (key.includes('retry-single-job')) {
          expect(config.windowMs).toBe(300000); // 5 minutes
        }
        return Promise.resolve({
          isDuplicate: false,
          duplicateCount: 0,
          remainingWindow: 300000,
          key,
        });
      });

      mockEmailQueueService.retryFailedJobs.mockResolvedValue(1);

      const retryMethod = (service as any).retryQueueWithDuplicateCheck.bind(service);
      await retryMethod('default');

      expect(mockIdempotencyService.checkDuplicate).toHaveBeenCalledWith(
        expect.stringContaining('retry-single-job'),
        { windowMs: 300000, maxDuplicates: 1 },
        expect.any(Object)
      );
    });
  });
});
