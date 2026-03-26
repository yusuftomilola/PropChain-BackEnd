import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RateLimitingService, UserTier } from '../src/security/services/rate-limiting.service';
import { UserTierManagementService } from '../src/security/services/user-tier-management.service';
import { RedisService } from '../src/common/services/redis.service';

describe('Rate Limiting Enhancement Tests', () => {
  let rateLimitingService: RateLimitingService;
  let userTierManagementService: UserTierManagementService;
  let mockRedisService: any;

  beforeEach(async () => {
    mockRedisService = {
      getRedisInstance: jest.fn(() => ({
        zremrangebyscore: jest.fn().mockResolvedValue(0),
        zcard: jest.fn().mockResolvedValue(0),
        zadd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        del: jest.fn().mockResolvedValue(1),
        keys: jest.fn().mockResolvedValue([]),
        hgetall: jest.fn().mockResolvedValue({}),
        hset: jest.fn().mockResolvedValue(1),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
      })),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => defaultValue || 100),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitingService,
        UserTierManagementService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    rateLimitingService = module.get<RateLimitingService>(RateLimitingService);
    userTierManagementService = module.get<UserTierManagementService>(UserTierManagementService);
  });

  describe('RateLimitingService', () => {
    it('should be defined', () => {
      expect(rateLimitingService).toBeDefined();
    });

    it('should check rate limit with tiered limits', async () => {
      const config = {
        windowMs: 60000,
        maxRequests: 100,
        keyPrefix: 'test',
        tier: UserTier.PREMIUM,
      };

      const result = await rateLimitingService.checkRateLimit('user123', config);
      
      expect(result.allowed).toBe(true);
      expect(result.info.limit).toBe(200); // Premium tier default
      expect(result.info.tier).toBe(UserTier.PREMIUM);
    });

    it('should get tiered limits', () => {
      const limits = rateLimitingService.getTieredLimits();
      
      expect(limits[UserTier.FREE].maxRequests).toBe(10);
      expect(limits[UserTier.BASIC].maxRequests).toBe(50);
      expect(limits[UserTier.PREMIUM].maxRequests).toBe(200);
      expect(limits[UserTier.ENTERPRISE].maxRequests).toBe(1000);
    });

    it('should handle user tier management', async () => {
      await rateLimitingService.setUserTier('user123', UserTier.BASIC);
      const tier = await rateLimitingService.getUserTier('user123');
      
      expect(tier).toBe(UserTier.BASIC);
    });

    it('should provide analytics', async () => {
      const analytics = await rateLimitingService.getRateLimitAnalytics();
      
      expect(analytics.totalRequests).toBe(0);
      expect(analytics.blockedRequests).toBe(0);
      expect(analytics.topUsers).toEqual([]);
      expect(analytics.tierDistribution).toBeDefined();
    });
  });

  describe('UserTierManagementService', () => {
    it('should be defined', () => {
      expect(userTierManagementService).toBeDefined();
    });

    it('should set user tier with metadata', async () => {
      await userTierManagementService.setUserTier('user123', UserTier.PREMIUM, 'Test upgrade');
      
      const result = await userTierManagementService.getUserTierWithMetadata('user123');
      expect(result.tier).toBe(UserTier.PREMIUM);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.reason).toBe('Test upgrade');
    });

    it('should upgrade user tier', async () => {
      await rateLimitingService.setUserTier('user123', UserTier.FREE);
      
      await userTierManagementService.upgradeUserTier('user123', UserTier.BASIC, 'Upgrade test');
      
      const tier = await rateLimitingService.getUserTier('user123');
      expect(tier).toBe(UserTier.BASIC);
    });

    it('should reject invalid upgrade', async () => {
      await rateLimitingService.setUserTier('user123', UserTier.PREMIUM);
      
      await expect(
        userTierManagementService.upgradeUserTier('user123', UserTier.BASIC, 'Invalid upgrade')
      ).rejects.toThrow();
    });

    it('should downgrade user tier', async () => {
      await rateLimitingService.setUserTier('user123', UserTier.PREMIUM);
      
      await userTierManagementService.downgradeUserTier('user123', UserTier.BASIC, 'Downgrade test');
      
      const tier = await rateLimitingService.getUserTier('user123');
      expect(tier).toBe(UserTier.BASIC);
    });

    it('should get tier distribution', async () => {
      const distribution = await userTierManagementService.getTierDistribution();
      
      expect(distribution).toHaveProperty(UserTier.FREE);
      expect(distribution).toHaveProperty(UserTier.BASIC);
      expect(distribution).toHaveProperty(UserTier.PREMIUM);
      expect(distribution).toHaveProperty(UserTier.ENTERPRISE);
    });

    it('should process upgrade request', async () => {
      await rateLimitingService.setUserTier('user123', UserTier.FREE);
      
      const request = {
        userId: 'user123',
        requestedTier: UserTier.BASIC,
        reason: 'User requested upgrade',
      };
      
      const result = await userTierManagementService.processTierUpgradeRequest(request);
      
      expect(result.approved).toBe(true);
      expect(result.message).toContain('upgraded');
    });
  });

  describe('Tier Configuration', () => {
    it('should have correct tier priorities', () => {
      const limits = rateLimitingService.getTieredLimits();
      
      // Verify that higher tiers have higher limits
      expect(limits[UserTier.ENTERPRISE].maxRequests).toBeGreaterThan(limits[UserTier.PREMIUM].maxRequests);
      expect(limits[UserTier.PREMIUM].maxRequests).toBeGreaterThan(limits[UserTier.BASIC].maxRequests);
      expect(limits[UserTier.BASIC].maxRequests).toBeGreaterThan(limits[UserTier.FREE].maxRequests);
    });

    it('should have consistent time windows', () => {
      const limits = rateLimitingService.getTieredLimits();
      
      // All tiers should use the same time window (1 minute)
      const windowMs = limits[UserTier.FREE].windowMs;
      expect(limits[UserTier.BASIC].windowMs).toBe(windowMs);
      expect(limits[UserTier.PREMIUM].windowMs).toBe(windowMs);
      expect(limits[UserTier.ENTERPRISE].windowMs).toBe(windowMs);
    });
  });
});
