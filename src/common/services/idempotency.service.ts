import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface IdempotencyConfig {
  windowMs: number;
  maxDuplicates: number;
  keyPrefix: string;
}

export interface IdempotencyResult {
  isDuplicate: boolean;
  duplicateCount: number;
  remainingWindow: number;
  key: string;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly defaultConfig: IdempotencyConfig = {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxDuplicates: 1,
    keyPrefix: 'idempotency',
  };

  constructor(private readonly redisService: RedisService) {}

  /**
   * Check if a request is a duplicate within the configured window
   */
  async checkDuplicate(
    key: string,
    config: Partial<IdempotencyConfig> = {},
    metadata?: Record<string, any>,
  ): Promise<IdempotencyResult> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const fullKey = `${finalConfig.keyPrefix}:${key}`;
    
    try {
      const currentCount = await this.redisService.get(fullKey);
      const count = currentCount ? parseInt(currentCount, 10) : 0;
      
      // Check if this would exceed the duplicate limit
      if (count >= finalConfig.maxDuplicates) {
        this.logger.warn(`Duplicate request detected: ${key}`, {
          currentCount: count,
          maxDuplicates: finalConfig.maxDuplicates,
          metadata,
        });
        
        const ttl = await this.redisService.ttl(fullKey);
        return {
          isDuplicate: true,
          duplicateCount: count,
          remainingWindow: ttl > 0 ? ttl * 1000 : 0,
          key: fullKey,
        };
      }

      // Increment the counter
      const newCount = await this.redisService.incr(fullKey);
      
      // Set expiration if this is the first request
      if (newCount === 1) {
        await this.redisService.expire(fullKey, Math.ceil(finalConfig.windowMs / 1000));
      }

      const ttl = await this.redisService.ttl(fullKey);
      
      this.logger.debug(`Idempotency check passed: ${key}`, {
        count: newCount,
        maxDuplicates: finalConfig.maxDuplicates,
        windowMs: finalConfig.windowMs,
        metadata,
      });

      return {
        isDuplicate: false,
        duplicateCount: newCount - 1,
        remainingWindow: ttl > 0 ? ttl * 1000 : finalConfig.windowMs,
        key: fullKey,
      };
    } catch (error) {
      this.logger.error(`Idempotency check failed for key: ${key}`, error);
      // Fail open - allow the request if idempotency check fails
      return {
        isDuplicate: false,
        duplicateCount: 0,
        remainingWindow: finalConfig.windowMs,
        key: fullKey,
      };
    }
  }

  /**
   * Generate a unique key for idempotency checking
   */
  generateKey(
    operation: string,
    identifier: string,
    additionalContext?: Record<string, any>,
  ): string {
    const contextHash = additionalContext 
      ? this.hashObject(additionalContext)
      : '';
    
    return `${operation}:${identifier}${contextHash ? `:${contextHash}` : ''}`;
  }

  /**
   * Clear idempotency record (useful for testing or manual cleanup)
   */
  async clearKey(key: string): Promise<boolean> {
    try {
      const fullKey = `${this.defaultConfig.keyPrefix}:${key}`;
      const result = await this.redisService.del(fullKey);
      this.logger.debug(`Cleared idempotency key: ${fullKey}`);
      return result > 0;
    } catch (error) {
      this.logger.error(`Failed to clear idempotency key: ${key}`, error);
      return false;
    }
  }

  /**
   * Get current count for a key
   */
  async getCount(key: string): Promise<number> {
    try {
      const fullKey = `${this.defaultConfig.keyPrefix}:${key}`;
      const count = await this.redisService.get(fullKey);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      this.logger.error(`Failed to get idempotency count for key: ${key}`, error);
      return 0;
    }
  }

  /**
   * Reset idempotency window for a key
   */
  async resetWindow(key: string, config: Partial<IdempotencyConfig> = {}): Promise<boolean> {
    try {
      const finalConfig = { ...this.defaultConfig, ...config };
      const fullKey = `${finalConfig.keyPrefix}:${key}`;
      
      await this.redisService.del(fullKey);
      await this.redisService.set(fullKey, '0', 'EX', Math.ceil(finalConfig.windowMs / 1000));
      
      this.logger.debug(`Reset idempotency window for key: ${fullKey}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to reset idempotency window for key: ${key}`, error);
      return false;
    }
  }

  /**
   * Batch check multiple keys for duplicates
   */
  async checkBatchDuplicates(
    checks: Array<{ key: string; config?: Partial<IdempotencyConfig>; metadata?: Record<string, any> }>,
  ): Promise<IdempotencyResult[]> {
    const results = await Promise.all(
      checks.map(({ key, config, metadata }) => this.checkDuplicate(key, config, metadata))
    );
    
    return results;
  }

  /**
   * Get idempotency statistics
   */
  async getStats(pattern?: string): Promise<{
    totalKeys: number;
    keysWithCounters: Array<{ key: string; count: number; ttl: number }>;
  }> {
    try {
      const searchPattern = pattern || `${this.defaultConfig.keyPrefix}:*`;
      const keys = await this.redisService.keys(searchPattern);
      
      const keysWithCounters = await Promise.all(
        keys.map(async (key) => {
          const count = await this.redisService.get(key);
          const ttl = await this.redisService.ttl(key);
          return {
            key,
            count: count ? parseInt(count, 10) : 0,
            ttl,
          };
        })
      );

      return {
        totalKeys: keys.length,
        keysWithCounters,
      };
    } catch (error) {
      this.logger.error('Failed to get idempotency stats', error);
      return {
        totalKeys: 0,
        keysWithCounters: [],
      };
    }
  }

  /**
   * Clean up expired keys (maintenance operation)
   */
  async cleanup(): Promise<number> {
    try {
      const keys = await this.redisService.keys(`${this.defaultConfig.keyPrefix}:*`);
      let cleanedCount = 0;

      for (const key of keys) {
        const ttl = await this.redisService.ttl(key);
        if (ttl === -1) { // Key without expiration
          await this.redisService.del(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`Cleaned up ${cleanedCount} expired idempotency keys`);
      }

      return cleanedCount;
    } catch (error) {
      this.logger.error('Failed to cleanup idempotency keys', error);
      return 0;
    }
  }

  /**
   * Simple hash function for creating deterministic keys from objects
   */
  private hashObject(obj: Record<string, any>): string {
    const sortedKeys = Object.keys(obj).sort();
    const str = sortedKeys.map(key => `${key}:${obj[key]}`).join('|');
    return Buffer.from(str).toString('base64').replace(/[+/=]/g, '').substring(0, 16);
  }
}
