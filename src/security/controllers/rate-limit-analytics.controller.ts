import { Controller, Get, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { RateLimitingService, RateLimitAnalytics, UserTier } from '../services/rate-limiting.service';
import { AdvancedRateLimitGuard } from '../guards/advanced-rate-limit.guard';
import { RateLimitOptions } from '../guards/advanced-rate-limit.guard';

@ApiTags('Rate Limiting')
@Controller('admin/rate-limiting')
@UseGuards(AdvancedRateLimitGuard)
export class RateLimitAnalyticsController {
  constructor(private readonly rateLimitingService: RateLimitingService) {}

  @Get('analytics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get rate limiting analytics' })
  @ApiResponse({ status: 200, description: 'Rate limiting analytics retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @ApiQuery({ name: 'windowMs', required: false, description: 'Time window in milliseconds (default: 1 hour)' })
  async getAnalytics(@Query('windowMs') windowMs?: string): Promise<RateLimitAnalytics> {
    const window = windowMs ? parseInt(windowMs) : 3600000; // Default to 1 hour
    return this.rateLimitingService.getRateLimitAnalytics(window);
  }

  @Get('tiered-limits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get configured tiered rate limits' })
  @ApiResponse({ status: 200, description: 'Tiered rate limits retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTieredLimits() {
    return this.rateLimitingService.getTieredLimits();
  }

  @Get('user-tier/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user tier' })
  @ApiResponse({ status: 200, description: 'User tier retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserTier(userId: string): Promise<{ userId: string; tier: UserTier }> {
    const tier = await this.rateLimitingService.getUserTier(userId);
    return { userId, tier };
  }

  @Get('configurations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get default rate limit configurations' })
  @ApiResponse({ status: 200, description: 'Default configurations retrieved successfully' })
  async getDefaultConfigurations() {
    return this.rateLimitingService.getDefaultConfigurations();
  }
}
