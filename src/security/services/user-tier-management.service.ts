import { Injectable, Logger } from '@nestjs/common';
import { RateLimitingService, UserTier } from './rate-limiting.service';

export interface UserTierConfig {
  userId: string;
  tier: UserTier;
  reason?: string;
  expiresAt?: Date;
}

export interface TierUpgradeRequest {
  userId: string;
  requestedTier: UserTier;
  reason: string;
}

@Injectable()
export class UserTierManagementService {
  private readonly logger = new Logger(UserTierManagementService.name);

  constructor(
    private readonly rateLimitingService: RateLimitingService,
  ) {}

  /**
   * Set user tier with optional expiration
   */
  async setUserTier(userId: string, tier: UserTier, reason?: string, expiresAt?: Date): Promise<void> {
    try {
      await this.rateLimitingService.setUserTier(userId, tier);
      
      // Store tier metadata for audit and management
      const metadataKey = `user_tier_metadata:${userId}`;
      const metadata = {
        tier,
        reason: reason || 'Manual assignment',
        assignedAt: new Date().toISOString(),
        expiresAt: expiresAt?.toISOString(),
        assignedBy: 'system', // In a real app, this would be the admin user ID
      };
      
      await this.rateLimitingService['redisService']
        .getRedisInstance()
        .hset(metadataKey, metadata);
      
      if (expiresAt) {
        const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
        if (ttl > 0) {
          await this.rateLimitingService['redisService']
            .getRedisInstance()
            .expire(metadataKey, ttl);
        }
      }
      
      this.logger.log(`User tier set for ${userId} to ${tier}${expiresAt ? ' (expires: ' + expiresAt.toISOString() + ')' : ''}`);
    } catch (error) {
      this.logger.error(`Failed to set user tier for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get user tier with metadata
   */
  async getUserTierWithMetadata(userId: string): Promise<{ tier: UserTier; metadata?: any }> {
    try {
      const tier = await this.rateLimitingService.getUserTier(userId);
      
      // Get metadata if available
      const metadataKey = `user_tier_metadata:${userId}`;
      const metadata = await this.rateLimitingService['redisService']
        .getRedisInstance()
        .hgetall(metadataKey);
      
      return {
        tier,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to get user tier metadata for ${userId}:`, error);
      return { tier: UserTier.FREE };
    }
  }

  /**
   * Upgrade user tier based on usage or subscription
   */
  async upgradeUserTier(userId: string, newTier: UserTier, reason: string): Promise<void> {
    const currentTier = await this.rateLimitingService.getUserTier(userId);
    
    if (this.getTierPriority(newTier) <= this.getTierPriority(currentTier)) {
      throw new Error(`Cannot downgrade user from ${currentTier} to ${newTier}`);
    }
    
    await this.setUserTier(userId, newTier, reason);
    this.logger.log(`User ${userId} upgraded from ${currentTier} to ${newTier}: ${reason}`);
  }

  /**
   * Downgrade user tier (admin only)
   */
  async downgradeUserTier(userId: string, newTier: UserTier, reason: string): Promise<void> {
    const currentTier = await this.rateLimitingService.getUserTier(userId);
    
    if (this.getTierPriority(newTier) >= this.getTierPriority(currentTier)) {
      throw new Error(`Cannot upgrade user from ${currentTier} to ${newTier} using downgrade method`);
    }
    
    await this.setUserTier(userId, newTier, reason);
    this.logger.log(`User ${userId} downgraded from ${currentTier} to ${newTier}: ${reason}`);
  }

  /**
   * Get users by tier
   */
  async getUsersByTier(tier: UserTier): Promise<string[]> {
    try {
      // This is a simplified implementation
      // In a real app, you would query the database or use a more efficient Redis pattern
      const pattern = `user_tier:*`;
      const keys = await this.rateLimitingService['redisService']
        .getRedisInstance()
        .keys(pattern);
      
      const users: string[] = [];
      
      for (const key of keys) {
        const userId = key.replace('user_tier:', '');
        const userTier = await this.rateLimitingService.getUserTier(userId);
        if (userTier === tier) {
          users.push(userId);
        }
      }
      
      return users;
    } catch (error) {
      this.logger.error(`Failed to get users by tier ${tier}:`, error);
      return [];
    }
  }

  /**
   * Get tier distribution statistics
   */
  async getTierDistribution(): Promise<Record<UserTier, number>> {
    try {
      const distribution: Record<UserTier, number> = {
        [UserTier.FREE]: 0,
        [UserTier.BASIC]: 0,
        [UserTier.PREMIUM]: 0,
        [UserTier.ENTERPRISE]: 0,
      };
      
      // Get all user tier keys
      const pattern = `user_tier:*`;
      const keys = await this.rateLimitingService['redisService']
        .getRedisInstance()
        .keys(pattern);
      
      // Count users by tier
      for (const key of keys) {
        const userId = key.replace('user_tier:', '');
        const tier = await this.rateLimitingService.getUserTier(userId);
        if (distribution[tier] !== undefined) {
          distribution[tier]++;
        }
      }
      
      return distribution;
    } catch (error) {
      this.logger.error('Failed to get tier distribution:', error);
      return {
        [UserTier.FREE]: 0,
        [UserTier.BASIC]: 0,
        [UserTier.PREMIUM]: 0,
        [UserTier.ENTERPRISE]: 0,
      };
    }
  }

  /**
   * Process tier upgrade requests (for manual review)
   */
  async processTierUpgradeRequest(request: TierUpgradeRequest): Promise<{ approved: boolean; message: string }> {
    // In a real implementation, this would involve:
    // 1. Validating the request
    // 2. Checking payment/subscription status
    // 3. Applying business rules
    // 4. Notifying the user
    
    const currentTier = await this.rateLimitingService.getUserTier(request.userId);
    
    // Simple business logic for demo
    if (request.requestedTier === UserTier.BASIC && currentTier === UserTier.FREE) {
      await this.upgradeUserTier(request.userId, UserTier.BASIC, request.reason);
      return { approved: true, message: 'Upgraded to Basic tier' };
    }
    
    if (request.requestedTier === UserTier.PREMIUM && currentTier <= UserTier.BASIC) {
      await this.upgradeUserTier(request.userId, UserTier.PREMIUM, request.reason);
      return { approved: true, message: 'Upgraded to Premium tier' };
    }
    
    return { approved: false, message: 'Upgrade request requires manual review' };
  }

  /**
   * Get numeric priority for tier comparison
   */
  private getTierPriority(tier: UserTier): number {
    switch (tier) {
      case UserTier.FREE:
        return 1;
      case UserTier.BASIC:
        return 2;
      case UserTier.PREMIUM:
        return 3;
      case UserTier.ENTERPRISE:
        return 4;
      default:
        return 0;
    }
  }

  /**
   * Check if user's tier has expired and reset to FREE if needed
   */
  async checkAndResetExpiredTiers(userId: string): Promise<void> {
    try {
      const metadataKey = `user_tier_metadata:${userId}`;
      const metadata = await this.rateLimitingService['redisService']
        .getRedisInstance()
        .hgetall(metadataKey);
      
      if (metadata.expiresAt) {
        const expiryDate = new Date(metadata.expiresAt);
        if (expiryDate < new Date()) {
          // Tier has expired, reset to FREE
          await this.setUserTier(userId, UserTier.FREE, 'Tier expired');
          this.logger.log(`User ${userId} tier expired, reset to FREE`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to check expired tier for ${userId}:`, error);
    }
  }
}
