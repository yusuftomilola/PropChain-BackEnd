import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { UserTierManagementService, UserTierConfig, TierUpgradeRequest } from '../services/user-tier-management.service';
import { UserTier } from '../services/rate-limiting.service';
import { AdvancedRateLimitGuard } from '../guards/advanced-rate-limit.guard';

@ApiTags('User Tier Management')
@Controller('admin/user-tiers')
@UseGuards(AdvancedRateLimitGuard)
export class UserTierManagementController {
  constructor(private readonly userTierManagementService: UserTierManagementService) {}

  @Post(':userId/tier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set user tier' })
  @ApiResponse({ status: 200, description: 'User tier set successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  async setUserTier(
    @Param('userId') userId: string,
    @Body() body: { tier: UserTier; reason?: string; expiresAt?: string },
  ): Promise<{ message: string }> {
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    await this.userTierManagementService.setUserTier(userId, body.tier, body.reason, expiresAt);
    return { message: `User tier set to ${body.tier} for user ${userId}` };
  }

  @Get(':userId/tier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user tier with metadata' })
  @ApiResponse({ status: 200, description: 'User tier retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  async getUserTier(@Param('userId') userId: string) {
    return this.userTierManagementService.getUserTierWithMetadata(userId);
  }

  @Put(':userId/upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upgrade user tier' })
  @ApiResponse({ status: 200, description: 'User tier upgraded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid upgrade request' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  async upgradeUserTier(
    @Param('userId') userId: string,
    @Body() body: { tier: UserTier; reason: string },
  ): Promise<{ message: string }> {
    await this.userTierManagementService.upgradeUserTier(userId, body.tier, body.reason);
    return { message: `User ${userId} upgraded to ${body.tier}` };
  }

  @Put(':userId/downgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Downgrade user tier' })
  @ApiResponse({ status: 200, description: 'User tier downgraded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid downgrade request' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  async downgradeUserTier(
    @Param('userId') userId: string,
    @Body() body: { tier: UserTier; reason: string },
  ): Promise<{ message: string }> {
    await this.userTierManagementService.downgradeUserTier(userId, body.tier, body.reason);
    return { message: `User ${userId} downgraded to ${body.tier}` };
  }

  @Get('by-tier/:tier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get users by tier' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  @ApiParam({ name: 'tier', description: 'User tier', enum: UserTier })
  async getUsersByTier(@Param('tier') tier: UserTier): Promise<{ users: string[] }> {
    const users = await this.userTierManagementService.getUsersByTier(tier);
    return { users };
  }

  @Get('distribution')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get tier distribution statistics' })
  @ApiResponse({ status: 200, description: 'Tier distribution retrieved successfully' })
  async getTierDistribution(): Promise<Record<UserTier, number>> {
    return this.userTierManagementService.getTierDistribution();
  }

  @Post('upgrade-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process tier upgrade request' })
  @ApiResponse({ status: 200, description: 'Upgrade request processed' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async processUpgradeRequest(@Body() request: TierUpgradeRequest) {
    return this.userTierManagementService.processTierUpgradeRequest(request);
  }

  @Post(':userId/check-expiry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check and reset expired user tier' })
  @ApiResponse({ status: 200, description: 'Tier expiry checked' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  async checkExpiredTier(@Param('userId') userId: string): Promise<{ message: string }> {
    await this.userTierManagementService.checkAndResetExpiredTiers(userId);
    return { message: `Tier expiry checked for user ${userId}` };
  }
}
