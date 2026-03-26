import { SetMetadata } from '@nestjs/common';
import { RateLimitOptions, UserTier } from '../guards/advanced-rate-limit.guard';

export const RATE_LIMIT_OPTIONS_KEY = 'rateLimitOptions';

/**
 * Decorator for applying tiered rate limiting to endpoints
 * @param options Rate limiting configuration options
 */
export const TieredRateLimit = (options: RateLimitOptions) => {
  const defaultOptions: RateLimitOptions = {
    windowMs: 60000, // 1 minute
    maxRequests: 100, // 100 requests per minute
    keyPrefix: 'api',
    useUserTier: true, // Enable tiered rate limiting by default
    ...options,
  };
  
  return SetMetadata(RATE_LIMIT_OPTIONS_KEY, defaultOptions);
};

/**
 * Predefined rate limit decorators for different tiers
 */
export const FreeTierRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 10,
    keyPrefix: 'free_tier',
    useUserTier: false, // Fixed limits for free tier
  });

export const BasicTierRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 50,
    keyPrefix: 'basic_tier',
    useUserTier: false, // Fixed limits for basic tier
  });

export const PremiumTierRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 200,
    keyPrefix: 'premium_tier',
    useUserTier: false, // Fixed limits for premium tier
  });

export const EnterpriseTierRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 1000,
    keyPrefix: 'enterprise_tier',
    useUserTier: false, // Fixed limits for enterprise tier
  });

/**
 * Specialized rate limit decorators for different endpoint types
 */
export const AuthRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 5,
    keyPrefix: 'auth',
    useUserTier: false, // Strict limits for auth endpoints
  });

export const ExpensiveOperationRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 10,
    keyPrefix: 'expensive',
    useUserTier: true, // Apply tiered limits to expensive operations
  });

export const FileUploadRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 20,
    keyPrefix: 'file_upload',
    useUserTier: true, // Apply tiered limits to file uploads
  });

export const ApiKeyRateLimit = () => 
  TieredRateLimit({
    windowMs: 60000,
    maxRequests: 1000,
    keyPrefix: 'api_key',
    useUserTier: true, // Apply tiered limits for API keys
  });
