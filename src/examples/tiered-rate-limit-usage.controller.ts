import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TieredRateLimit, AuthRateLimit, ExpensiveOperationRateLimit } from '../security/decorators/tiered-rate-limit.decorator';

@ApiTags('Example Usage')
@Controller('api/v1/examples')
export class ExampleController {
  
  @Get('public')
  @ApiOperation({ summary: 'Public endpoint with tiered rate limiting' })
  @TieredRateLimit({
    windowMs: 60000, // 1 minute
    maxRequests: 100, // Base limit, will be adjusted by user tier
    keyPrefix: 'public_api',
    useUserTier: true, // Enable tiered rate limiting
  })
  async publicEndpoint() {
    return { message: 'This endpoint uses tiered rate limiting based on user tier' };
  }

  @Get('premium-content')
  @ApiOperation({ summary: 'Premium content endpoint' })
  @TieredRateLimit({
    windowMs: 60000,
    maxRequests: 50,
    keyPrefix: 'premium_content',
    useUserTier: true,
  })
  async premiumContent() {
    return { message: 'This content is available with tiered rate limiting' };
  }

  @Post('auth/login')
  @ApiOperation({ summary: 'Authentication endpoint' })
  @AuthRateLimit()
  async login() {
    return { message: 'Login endpoint with strict rate limiting' };
  }

  @Post('auth/register')
  @ApiOperation({ summary: 'Registration endpoint' })
  @AuthRateLimit()
  async register() {
    return { message: 'Registration endpoint with strict rate limiting' };
  }

  @Get('expensive-operation')
  @ApiOperation({ summary: 'Expensive operation endpoint' })
  @ExpensiveOperationRateLimit()
  async expensiveOperation() {
    return { message: 'Expensive operation with tiered rate limiting' };
  }

  @Get('free-tier-only')
  @ApiOperation({ summary: 'Free tier specific endpoint' })
  @TieredRateLimit({
    windowMs: 60000,
    maxRequests: 10,
    keyPrefix: 'free_only',
    useUserTier: false, // Fixed limits for all users
  })
  async freeTierOnly() {
    return { message: 'Free tier endpoint with fixed rate limits' };
  }

  @Get('enterprise-feature')
  @ApiOperation({ summary: 'Enterprise feature endpoint' })
  @TieredRateLimit({
    windowMs: 60000,
    maxRequests: 1000,
    keyPrefix: 'enterprise',
    useUserTier: true,
  })
  async enterpriseFeature() {
    return { message: 'Enterprise feature with high rate limits' };
  }
}
