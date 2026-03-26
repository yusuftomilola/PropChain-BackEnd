import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitingService, UserTier, RateLimitConfig } from '../../security/services/rate-limiting.service';

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyPrefix?: string;
  skipIf?: (context: ExecutionContext) => boolean | Promise<boolean>;
  useUserTier?: boolean; // Enable tiered rate limiting based on user tier
}

@Injectable()
export class AdvancedRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AdvancedRateLimitGuard.name);

  constructor(
    private readonly rateLimitingService: RateLimitingService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest();

      // Get rate limit options from decorator or use defaults
      const options = this.reflector.get<RateLimitOptions>('rateLimitOptions', context.getHandler()) || {};

      // Check if we should skip rate limiting
      if (options.skipIf && (await options.skipIf(context))) {
        return true;
      }

      // Generate rate limit key and get user tier if enabled
      const { key, userTier } = await this.generateKeyAndTier(request, options);

      // Get configuration
      const config: RateLimitConfig = {
        windowMs: options.windowMs || 60000, // 1 minute default
        maxRequests: options.maxRequests || 100, // 100 requests default
        keyPrefix: options.keyPrefix || 'api',
        ...(options.useUserTier && userTier && { tier: userTier }),
      };

      // Check rate limit
      const { allowed, info } = await this.rateLimitingService.checkRateLimit(key, config);

      // Set rate limit headers
      this.setRateLimitHeaders(request.res, info);

      if (!allowed) {
        this.logger.warn(`Rate limit exceeded for key: ${key}, tier: ${userTier}`);
        // You can throw an exception here or return false
        // For now, we'll return false to block the request
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Rate limit check failed:', error);
      // Fail open - allow request if rate limiting service fails
      return true;
    }
  }

  private async generateKeyAndTier(request: any, options: RateLimitOptions): Promise<{ key: string; userTier: UserTier }> {
    let userTier = UserTier.FREE;
    
    // Try to get user ID first
    if (request.user?.id) {
      if (options.useUserTier) {
        userTier = await this.rateLimitingService.getUserTier(request.user.id);
      }
      return { key: `user:${request.user.id}`, userTier };
    }

    // Try to get API key
    const apiKey = request.headers['x-api-key'] || request.query.apiKey;
    if (apiKey) {
      if (options.useUserTier) {
        // For API keys, we might have a different tier lookup mechanism
        userTier = await this.rateLimitingService.getUserTier(`api:${apiKey}`);
      }
      return { key: `api:${apiKey}`, userTier };
    }

    // Fall back to IP address
    const ip = this.getClientIp(request);
    if (options.useUserTier) {
      userTier = await this.rateLimitingService.getUserTier(`ip:${ip}`);
    }
    return { key: `ip:${ip}`, userTier };
  }

  private getClientIp(request: any): string {
    // Handle reverse proxy headers
    return (
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      (request.connection?.socket ? request.connection.socket.remoteAddress : null) ||
      'unknown'
    );
  }

  private setRateLimitHeaders(response: any, info: any): void {
    if (response && response.setHeader) {
      response.setHeader('X-RateLimit-Limit', info.limit);
      response.setHeader('X-RateLimit-Remaining', info.remaining);
      response.setHeader('X-RateLimit-Reset', Math.floor(info.resetTime / 1000));
      response.setHeader('X-RateLimit-Window', info.window);
      
      // Add tier information if available
      if (info.tier) {
        response.setHeader('X-RateLimit-Tier', info.tier);
      }
    }
  }
}
