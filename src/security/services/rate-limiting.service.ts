import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/services/redis.service';

export enum UserTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests allowed in window
  keyPrefix?: string; // Redis key prefix
  tier?: UserTier; // User tier for tiered rate limiting
}

export interface RateLimitInfo {
  remaining: number;
  resetTime: number;
  limit: number;
  window: number;
  tier?: UserTier;
}

export interface RateLimitAnalytics {
  totalRequests: number;
  blockedRequests: number;
  topUsers: Array<{ userId: string; requests: number }>;
  tierDistribution: Record<UserTier, number>;
  windowStart: number;
  windowEnd: number;
}

export interface TieredRateLimits {
  [UserTier.FREE]: { windowMs: number; maxRequests: number };
  [UserTier.BASIC]: { windowMs: number; maxRequests: number };
  [UserTier.PREMIUM]: { windowMs: number; maxRequests: number };
  [UserTier.ENTERPRISE]: { windowMs: number; maxRequests: number };
}

@Injectable()
export class RateLimitingService {
  private readonly logger = new Logger(RateLimitingService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Check if a request is within rate limits
   * @param key Unique identifier (IP, user ID, API key)
   * @param config Rate limit configuration
   * @returns Rate limit info and whether request is allowed
   */
  async checkRateLimit(key: string, config: RateLimitConfig): Promise<{ allowed: boolean; info: RateLimitInfo }> {
    try {
      const finalConfig = this.applyTieredLimits(config);
      const redisKey = `${finalConfig.keyPrefix || 'rate_limit'}:${key}`;
      const currentTime = Date.now();
      const windowStart = currentTime - finalConfig.windowMs;

      // Remove expired entries
      await this.redisService.getRedisInstance().zremrangebyscore(redisKey, 0, windowStart);

      // Get current count
      const currentCount = await this.redisService.getRedisInstance().zcard(redisKey);

      // Check if limit exceeded
      const allowed = currentCount < finalConfig.maxRequests;

      // Add current request timestamp if allowed
      if (allowed) {
        await this.redisService.getRedisInstance().zadd(redisKey, currentTime, currentTime.toString());
        // Set expiration to clean up old data
        await this.redisService.expire(redisKey, Math.ceil(finalConfig.windowMs / 1000) + 60);
        
        // Track analytics
        await this.trackAnalytics(key, finalConfig, false);
      } else {
        // Track blocked request
        await this.trackAnalytics(key, finalConfig, true);
      }

      const info: RateLimitInfo = {
        remaining: Math.max(0, finalConfig.maxRequests - currentCount - (allowed ? 1 : 0)),
        resetTime: currentTime + finalConfig.windowMs,
        limit: finalConfig.maxRequests,
        window: finalConfig.windowMs,
        tier: finalConfig.tier,
      };

      return { allowed, info };
    } catch (error) {
      this.logger.error(`Rate limit check failed for key ${key}:`, error);
      // Fail open - allow request if Redis is unavailable
      return {
        allowed: true,
        info: {
          remaining: config.maxRequests,
          resetTime: Date.now() + config.windowMs,
          limit: config.maxRequests,
          window: config.windowMs,
          tier: config.tier,
        },
      };
    }
  }

  /**
   * Apply tiered rate limits based on user tier
   */
  private applyTieredLimits(config: RateLimitConfig): RateLimitConfig {
    if (!config.tier) {
      return config;
    }

    const tieredLimits = this.getTieredLimits();
    const tierConfig = tieredLimits[config.tier];
    
    return {
      ...config,
      windowMs: tierConfig.windowMs,
      maxRequests: tierConfig.maxRequests,
    };
  }

  /**
   * Track rate limit analytics
   */
  private async trackAnalytics(key: string, config: RateLimitConfig, blocked: boolean): Promise<void> {
    try {
      const analyticsKey = `rate_limit_analytics:${Date.now()}`;
      const analyticsData = {
        key,
        tier: config.tier || UserTier.FREE,
        blocked,
        timestamp: Date.now(),
        window: config.windowMs,
        limit: config.maxRequests,
      };
      
      await this.redisService.getRedisInstance().hset(analyticsKey, analyticsData);
      await this.redisService.expire(analyticsKey, 3600); // Keep for 1 hour
    } catch (error) {
      this.logger.error('Failed to track analytics:', error);
    }
  }

  /**
   * Get rate limit information without consuming a request
   */
  async getRateLimitInfo(key: string, config: RateLimitConfig): Promise<RateLimitInfo> {
    try {
      const finalConfig = this.applyTieredLimits(config);
      const redisKey = `${finalConfig.keyPrefix || 'rate_limit'}:${key}`;
      const currentTime = Date.now();
      const windowStart = currentTime - finalConfig.windowMs;

      // Remove expired entries
      await this.redisService.getRedisInstance().zremrangebyscore(redisKey, 0, windowStart);

      // Get current count
      const currentCount = await this.redisService.getRedisInstance().zcard(redisKey);

      return {
        remaining: Math.max(0, finalConfig.maxRequests - currentCount),
        resetTime: currentTime + finalConfig.windowMs,
        limit: finalConfig.maxRequests,
        window: finalConfig.windowMs,
        tier: finalConfig.tier,
      };
    } catch (error) {
      this.logger.error(`Failed to get rate limit info for key ${key}:`, error);
      return {
        remaining: config.maxRequests,
        resetTime: Date.now() + config.windowMs,
        limit: config.maxRequests,
        window: config.windowMs,
        tier: config.tier,
      };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async resetRateLimit(key: string, prefix?: string): Promise<void> {
    try {
      const redisKey = `${prefix || 'rate_limit'}:${key}`;
      await this.redisService.del(redisKey);
      this.logger.log(`Rate limit reset for key: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to reset rate limit for key ${key}:`, error);
    }
  }

  /**
   * Get default configurations for different use cases
   */
  getDefaultConfigurations() {
    return {
      // Standard API rate limiting
      api: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_API_PER_MINUTE', 100),
        keyPrefix: 'api_rate_limit',
      },
      // Auth endpoints (stricter)
      auth: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_AUTH_PER_MINUTE', 5),
        keyPrefix: 'auth_rate_limit',
      },
      // Expensive operations (very strict)
      expensive: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_EXPENSIVE_PER_MINUTE', 10),
        keyPrefix: 'expensive_rate_limit',
      },
      // User-based rate limiting
      user: {
        windowMs: 3600000, // 1 hour
        maxRequests: this.configService.get<number>('RATE_LIMIT_USER_PER_HOUR', 1000),
        keyPrefix: 'user_rate_limit',
      },
    };
  }

  /**
   * Get tiered rate limits for different user tiers
   */
  getTieredLimits(): TieredRateLimits {
    return {
      [UserTier.FREE]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_FREE_PER_MINUTE', 10),
      },
      [UserTier.BASIC]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_BASIC_PER_MINUTE', 50),
      },
      [UserTier.PREMIUM]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_PREMIUM_PER_MINUTE', 200),
      },
      [UserTier.ENTERPRISE]: {
        windowMs: 60000, // 1 minute
        maxRequests: this.configService.get<number>('RATE_LIMIT_ENTERPRISE_PER_MINUTE', 1000),
      },
    };
  }

  /**
   * Get rate limit analytics for a time window
   */
  async getRateLimitAnalytics(windowMs: number = 3600000): Promise<RateLimitAnalytics> {
    try {
      const currentTime = Date.now();
      const windowStart = currentTime - windowMs;
      
      // Get all analytics keys in the window
      const keys = await this.redisService.getRedisInstance().keys('rate_limit_analytics:*');
      
      let totalRequests = 0;
      let blockedRequests = 0;
      const userRequests = new Map<string, number>();
      const tierCounts: Record<UserTier, number> = {
        [UserTier.FREE]: 0,
        [UserTier.BASIC]: 0,
        [UserTier.PREMIUM]: 0,
        [UserTier.ENTERPRISE]: 0,
      };

      for (const key of keys) {
        const data = await this.redisService.getRedisInstance().hgetall(key);
        if (data.timestamp && parseInt(data.timestamp) >= windowStart) {
          totalRequests++;
          if (data.blocked === 'true') {
            blockedRequests++;
          }
          
          // Track user requests
          const userKey = data.key;
          userRequests.set(userKey, (userRequests.get(userKey) || 0) + 1);
          
          // Track tier distribution
          const tier = data.tier as UserTier;
          if (tierCounts[tier] !== undefined) {
            tierCounts[tier]++;
          }
        }
      }

      // Get top users
      const topUsers = Array.from(userRequests.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([userId, requests]) => ({ userId, requests }));

      return {
        totalRequests,
        blockedRequests,
        topUsers,
        tierDistribution: tierCounts,
        windowStart,
        windowEnd: currentTime,
      };
    } catch (error) {
      this.logger.error('Failed to get rate limit analytics:', error);
      return {
        totalRequests: 0,
        blockedRequests: 0,
        topUsers: [],
        tierDistribution: {
          [UserTier.FREE]: 0,
          [UserTier.BASIC]: 0,
          [UserTier.PREMIUM]: 0,
          [UserTier.ENTERPRISE]: 0,
        },
        windowStart: Date.now() - windowMs,
        windowEnd: Date.now(),
      };
    }
  }

  /**
   * Get user tier from user ID (this would typically integrate with a user service)
   */
  async getUserTier(userId: string): Promise<UserTier> {
    try {
      // In a real implementation, this would query the database or user service
      // For now, we'll use Redis to store user tiers
      const tier = await this.redisService.getRedisInstance().get(`user_tier:${userId}`);
      return tier as UserTier || UserTier.FREE;
    } catch (error) {
      this.logger.error(`Failed to get user tier for ${userId}:`, error);
      return UserTier.FREE;
    }
  }

  /**
   * Set user tier
   */
  async setUserTier(userId: string, tier: UserTier): Promise<void> {
    try {
      await this.redisService.getRedisInstance().set(`user_tier:${userId}`, tier);
      this.logger.log(`Set user tier for ${userId} to ${tier}`);
    } catch (error) {
      this.logger.error(`Failed to set user tier for ${userId}:`, error);
    }
  }
}
