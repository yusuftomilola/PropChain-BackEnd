# Enhanced Rate Limiting Implementation

This document describes the enhanced rate limiting features implemented in the PropChain-BackEnd project.

## Overview

The enhanced rate limiting system provides:
- **Tiered Rate Limiting**: Different rate limits based on user subscription tiers
- **User-Based Rate Limits**: Personalized rate limiting per user
- **Rate Limit Analytics**: Comprehensive monitoring and analytics
- **Dynamic Tier Management**: Runtime tier assignment and management

## Features

### 1. Tiered Rate Limiting

Four user tiers with different rate limits:

| Tier | Requests/Minute | Use Case |
|------|-----------------|----------|
| FREE | 10 | Basic users, trial accounts |
| BASIC | 50 | Standard users |
| PREMIUM | 200 | Paid subscribers |
| ENTERPRISE | 1000 | Enterprise clients |

### 2. User-Based Rate Limiting

- Rate limits are applied per user ID, API key, or IP address
- User tiers are stored in Redis for fast lookup
- Automatic tier-based limit adjustment

### 3. Rate Limit Analytics

- Total request monitoring
- Blocked request tracking
- Top user identification
- Tier distribution analytics
- Time-windowed analytics

### 4. Dynamic Tier Management

- Runtime tier assignment
- Tier upgrade/downgrade capabilities
- Expiration-based tier reset
- Metadata tracking for audit

## Implementation

### Core Services

#### RateLimitingService
- Handles rate limit checking and enforcement
- Supports tiered rate limiting
- Provides analytics tracking
- Manages Redis-based rate limit storage

#### UserTierManagementService
- Manages user tier assignments
- Handles tier upgrades/downgrades
- Provides tier distribution statistics
- Manages tier expiration

### Guards and Decorators

#### AdvancedRateLimitGuard
- Enhanced guard supporting tiered rate limiting
- Automatic user tier detection
- Configurable rate limit options
- Comprehensive rate limit headers

#### TieredRateLimit Decorator
- Easy-to-use decorator for endpoint protection
- Predefined decorators for common use cases
- Customizable rate limit options

### Controllers

#### RateLimitAnalyticsController
- `/admin/rate-limiting/analytics` - Get rate limiting analytics
- `/admin/rate-limiting/tiered-limits` - Get tiered limit configuration
- `/admin/rate-limiting/configurations` - Get default configurations

#### UserTierManagementController
- `/admin/user-tiers/{userId}/tier` - Set user tier
- `/admin/user-tiers/{userId}/upgrade` - Upgrade user tier
- `/admin/user-tiers/{userId}/downgrade` - Downgrade user tier
- `/admin/user-tiers/distribution` - Get tier distribution

## Usage Examples

### Basic Tiered Rate Limiting

```typescript
import { TieredRateLimit } from '../security/decorators/tiered-rate-limit.decorator';

@Get('api/data')
@TieredRateLimit({
  windowMs: 60000, // 1 minute
  maxRequests: 100, // Base limit
  useUserTier: true, // Enable tiered limits
})
async getData() {
  return { message: 'Data with tiered rate limiting' };
}
```

### Predefined Decorators

```typescript
import { 
  AuthRateLimit, 
  ExpensiveOperationRateLimit,
  FreeTierRateLimit,
  PremiumTierRateLimit 
} from '../security/decorators/tiered-rate-limit.decorator';

@Post('auth/login')
@AuthRateLimit() // Strict limits for auth
async login() { }

@Get('expensive')
@ExpensiveOperationRateLimit() // Tiered limits for expensive ops
async expensiveOperation() { }

@Get('free-content')
@FreeTierRateLimit() // Fixed limits for free tier
async freeContent() { }
```

### Manual Tier Management

```typescript
// Set user tier
await this.userTierManagementService.setUserTier('user123', UserTier.PREMIUM, 'Payment upgrade');

// Upgrade user tier
await this.userTierManagementService.upgradeUserTier('user123', UserTier.ENTERPRISE, 'Enterprise subscription');

// Get user tier with metadata
const { tier, metadata } = await this.userTierManagementService.getUserTierWithMetadata('user123');
```

### Analytics

```typescript
// Get rate limiting analytics
const analytics = await this.rateLimitingService.getRateLimitAnalytics(3600000); // 1 hour window

console.log(`Total requests: ${analytics.totalRequests}`);
console.log(`Blocked requests: ${analytics.blockedRequests}`);
console.log(`Top users:`, analytics.topUsers);
console.log(`Tier distribution:`, analytics.tierDistribution);
```

## Configuration

Environment variables for rate limiting:

```bash
# Tier-specific rate limits (requests per minute)
RATE_LIMIT_FREE_PER_MINUTE=10
RATE_LIMIT_BASIC_PER_MINUTE=50
RATE_LIMIT_PREMIUM_PER_MINUTE=200
RATE_LIMIT_ENTERPRISE_PER_MINUTE=1000

# Default rate limits
RATE_LIMIT_API_PER_MINUTE=100
RATE_LIMIT_AUTH_PER_MINUTE=5
RATE_LIMIT_EXPENSIVE_PER_MINUTE=10
RATE_LIMIT_USER_PER_HOUR=1000
```

## Rate Limit Headers

The system adds comprehensive rate limit headers:

- `X-RateLimit-Limit` - Current limit for the user/tier
- `X-RateLimit-Remaining` - Remaining requests in window
- `X-RateLimit-Reset` - Unix timestamp when limit resets
- `X-RateLimit-Window` - Window size in milliseconds
- `X-RateLimit-Tier` - User tier (if applicable)

## API Endpoints

### Rate Limiting Analytics

```bash
GET /admin/rate-limiting/analytics?windowMs=3600000
GET /admin/rate-limiting/tiered-limits
GET /admin/rate-limiting/configurations
```

### User Tier Management

```bash
POST /admin/user-tiers/{userId}/tier
PUT /admin/user-tiers/{userId}/upgrade
PUT /admin/user-tiers/{userId}/downgrade
GET /admin/user-tiers/{userId}/tier
GET /admin/user-tiers/by-tier/{tier}
GET /admin/user-tiers/distribution
POST /admin/user-tiers/upgrade-request
POST /admin/user-tiers/{userId}/check-expiry
```

## Testing

Run the comprehensive test suite:

```bash
npm run test rate-limiting-enhancement.spec.ts
```

## Monitoring

The enhanced rate limiting system provides:

1. **Real-time Analytics**: Monitor current usage patterns
2. **Tier Distribution**: Track user tier adoption
3. **Block Rate Monitoring**: Identify abuse patterns
4. **Top User Tracking**: Identify heavy users

## Best Practices

1. **Use Tiered Rate Limiting**: Enable `useUserTier: true` for most endpoints
2. **Set Appropriate Limits**: Configure limits based on your infrastructure capacity
3. **Monitor Analytics**: Regularly check rate limiting analytics
4. **Audit Tier Changes**: Use metadata to track tier management decisions
5. **Handle Failures Gracefully**: The system fails open if Redis is unavailable

## Migration from Basic Rate Limiting

To migrate existing rate limiting:

1. Replace `@Throttle()` decorators with `@TieredRateLimit()`
2. Update rate limit configurations in environment variables
3. Set up user tiers using the management API
4. Monitor analytics to ensure appropriate limits

## Security Considerations

1. **Rate Limit Bypass**: The system uses multiple identification methods (user ID, API key, IP)
2. **Redis Security**: Ensure Redis is properly secured and not exposed
3. **Tier Escalation**: Implement proper authorization for tier management endpoints
4. **Audit Trail**: Use metadata to track all tier changes

## Performance

- **Redis Storage**: Fast O(1) operations for rate limit checking
- **Minimal Overhead**: Efficient key generation and lookup
- **Batch Analytics**: Optimized analytics queries
- **Cleanup**: Automatic expiration of old rate limit data

## Future Enhancements

1. **Dynamic Limits**: AI-driven limit adjustment based on usage patterns
2. **Geographic Rate Limiting**: Region-specific rate limits
3. **Burst Handling**: Short-term burst capacity
4. **Advanced Analytics**: Machine learning for abuse detection
5. **Multi-tenant Support**: Organization-based rate limiting
