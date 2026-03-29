import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService } from '../services/idempotency.service';
import { RedisService } from '../services/redis.service';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let redisService: RedisService;

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    ttl: jest.fn(),
    keys: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkDuplicate', () => {
    it('should allow first request (not duplicate)', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRedisService.incr.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const result = await service.checkDuplicate('test-key');

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateCount).toBe(0);
      expect(result.key).toBe('idempotency:test-key');
      expect(mockRedisService.incr).toHaveBeenCalledWith('idempotency:test-key');
      expect(mockRedisService.expire).toHaveBeenCalledWith('idempotency:test-key', 300);
    });

    it('should block duplicate requests', async () => {
      mockRedisService.get.mockResolvedValue('1');
      mockRedisService.ttl.mockResolvedValue(150);

      const result = await service.checkDuplicate('test-key');

      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateCount).toBe(1);
      expect(result.remainingWindow).toBe(150000);
      expect(mockRedisService.incr).not.toHaveBeenCalled();
    });

    it('should allow requests within duplicate limit', async () => {
      mockRedisService.get.mockResolvedValue('0');
      mockRedisService.incr.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const result = await service.checkDuplicate('test-key', { maxDuplicates: 2 });

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateCount).toBe(0);
    });

    it('should use custom configuration', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRedisService.incr.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);

      const customConfig = {
        windowMs: 60000,
        maxDuplicates: 3,
        keyPrefix: 'custom',
      };

      await service.checkDuplicate('test-key', customConfig);

      expect(mockRedisService.incr).toHaveBeenCalledWith('custom:test-key');
      expect(mockRedisService.expire).toHaveBeenCalledWith('custom:test-key', 60);
    });

    it('should fail open on Redis errors', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.checkDuplicate('test-key');

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateCount).toBe(0);
    });
  });

  describe('generateKey', () => {
    it('should generate simple key', () => {
      const key = service.generateKey('operation', 'identifier');
      expect(key).toBe('operation:identifier');
    });

    it('should generate key with context', () => {
      const key = service.generateKey('operation', 'identifier', { param1: 'value1', param2: 'value2' });
      expect(key).toMatch(/^operation:identifier:[a-zA-Z0-9]{16}$/);
    });

    it('should generate consistent keys for same context', () => {
      const context = { param1: 'value1', param2: 'value2' };
      const key1 = service.generateKey('operation', 'identifier', context);
      const key2 = service.generateKey('operation', 'identifier', context);
      expect(key1).toBe(key2);
    });
  });

  describe('clearKey', () => {
    it('should clear key successfully', async () => {
      mockRedisService.del.mockResolvedValue(1);

      const result = await service.clearKey('test-key');

      expect(result).toBe(true);
      expect(mockRedisService.del).toHaveBeenCalledWith('idempotency:test-key');
    });

    it('should handle non-existent key', async () => {
      mockRedisService.del.mockResolvedValue(0);

      const result = await service.clearKey('test-key');

      expect(result).toBe(false);
    });

    it('should handle Redis errors', async () => {
      mockRedisService.del.mockRejectedValue(new Error('Redis error'));

      const result = await service.clearKey('test-key');

      expect(result).toBe(false);
    });
  });

  describe('getCount', () => {
    it('should return current count', async () => {
      mockRedisService.get.mockResolvedValue('5');

      const result = await service.getCount('test-key');

      expect(result).toBe(5);
      expect(mockRedisService.get).toHaveBeenCalledWith('idempotency:test-key');
    });

    it('should return 0 for non-existent key', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.getCount('test-key');

      expect(result).toBe(0);
    });

    it('should handle Redis errors', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.getCount('test-key');

      expect(result).toBe(0);
    });
  });

  describe('resetWindow', () => {
    it('should reset window successfully', async () => {
      mockRedisService.del.mockResolvedValue(1);
      mockRedisService.set.mockResolvedValue('OK');

      const result = await service.resetWindow('test-key');

      expect(result).toBe(true);
      expect(mockRedisService.del).toHaveBeenCalledWith('idempotency:test-key');
      expect(mockRedisService.set).toHaveBeenCalledWith('idempotency:test-key', '0', 'EX', 300);
    });

    it('should use custom window duration', async () => {
      mockRedisService.del.mockResolvedValue(1);
      mockRedisService.set.mockResolvedValue('OK');

      await service.resetWindow('test-key', { windowMs: 120000 });

      expect(mockRedisService.set).toHaveBeenCalledWith('idempotency:test-key', '0', 'EX', 120);
    });

    it('should handle Redis errors', async () => {
      mockRedisService.del.mockRejectedValue(new Error('Redis error'));

      const result = await service.resetWindow('test-key');

      expect(result).toBe(false);
    });
  });

  describe('checkBatchDuplicates', () => {
    it('should check multiple keys', async () => {
      mockRedisService.get
        .mockResolvedValueOnce('0')
        .mockResolvedValueOnce('1');
      mockRedisService.incr.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);
      mockRedisService.ttl.mockResolvedValue(150);

      const checks = [
        { key: 'key1' },
        { key: 'key2' },
      ];

      const results = await service.checkBatchDuplicates(checks);

      expect(results).toHaveLength(2);
      expect(results[0].isDuplicate).toBe(false);
      expect(results[1].isDuplicate).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      mockRedisService.keys.mockResolvedValue(['idempotency:key1', 'idempotency:key2']);
      mockRedisService.get
        .mockResolvedValueOnce('3')
        .mockResolvedValueOnce('5');
      mockRedisService.ttl
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(200);

      const result = await service.getStats();

      expect(result.totalKeys).toBe(2);
      expect(result.keysWithCounters).toHaveLength(2);
      expect(result.keysWithCounters[0]).toEqual({
        key: 'idempotency:key1',
        count: 3,
        ttl: 100,
      });
    });

    it('should handle pattern filter', async () => {
      mockRedisService.keys.mockResolvedValue(['custom:key1']);
      mockRedisService.get.mockResolvedValue('1');
      mockRedisService.ttl.mockResolvedValue(100);

      const result = await service.getStats('custom:*');

      expect(result.totalKeys).toBe(1);
      expect(mockRedisService.keys).toHaveBeenCalledWith('custom:*');
    });

    it('should handle Redis errors', async () => {
      mockRedisService.keys.mockRejectedValue(new Error('Redis error'));

      const result = await service.getStats();

      expect(result.totalKeys).toBe(0);
      expect(result.keysWithCounters).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('should clean expired keys', async () => {
      mockRedisService.keys.mockResolvedValue(['idempotency:key1', 'idempotency:key2']);
      mockRedisService.ttl
        .mockResolvedValueOnce(-1) // No expiration
        .mockResolvedValueOnce(100); // Has expiration
      mockRedisService.del.mockResolvedValue(1);

      const result = await service.cleanup();

      expect(result).toBe(1);
      expect(mockRedisService.del).toHaveBeenCalledWith('idempotency:key1');
    });

    it('should handle Redis errors', async () => {
      mockRedisService.keys.mockRejectedValue(new Error('Redis error'));

      const result = await service.cleanup();

      expect(result).toBe(0);
    });
  });
});
