import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { RedisService } from '../../common/services/redis.service';
import { StructuredLoggerService } from '../../common/logging/logger.service';
import { UserService } from '../../users/user.service';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';

export interface SocialProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  apiBaseUrl: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
}

export interface SocialUserInfo {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatar?: string;
  bio?: string;
  location?: string;
  website?: string;
  followersCount?: number;
  followingCount?: number;
  verified?: boolean;
  provider: string;
  rawProfile?: any;
}

export interface SocialAuthState {
  state: string;
  provider: string;
  redirectUri?: string;
  createdAt: number;
}

@Injectable()
export class SocialAuth {
  private readonly providers: Map<string, SocialProviderConfig> = new Map();
  private readonly stateExpiry = 600; // 10 minutes
  private readonly tokenExpiry = 3600; // 1 hour

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
    private readonly logger: StructuredLoggerService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {
    this.logger.setContext('SocialAuth');
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Twitter/X OAuth2
    this.providers.set('twitter', {
      clientId: this.configService.get<string>('TWITTER_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('TWITTER_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('TWITTER_REDIRECT_URI')!,
      scopes: ['tweet.read', 'users.read', 'offline.access'],
      apiBaseUrl: 'https://api.twitter.com',
      tokenEndpoint: 'https://api.twitter.com/2/oauth2/token',
      userInfoEndpoint: 'https://api.twitter.com/2/users/me',
    });

    // Facebook Login
    this.providers.set('facebook', {
      clientId: this.configService.get<string>('FACEBOOK_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('FACEBOOK_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('FACEBOOK_REDIRECT_URI')!,
      scopes: ['email', 'public_profile'],
      apiBaseUrl: 'https://graph.facebook.com',
      tokenEndpoint: 'https://graph.facebook.com/v18.0/oauth/access_token',
      userInfoEndpoint: 'https://graph.facebook.com/me',
    });

    // Instagram Basic Display
    this.providers.set('instagram', {
      clientId: this.configService.get<string>('INSTAGRAM_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('INSTAGRAM_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('INSTAGRAM_REDIRECT_URI')!,
      scopes: ['user_profile'],
      apiBaseUrl: 'https://graph.instagram.com',
      tokenEndpoint: 'https://api.instagram.com/oauth/access_token',
      userInfoEndpoint: 'https://graph.instagram.com/me',
    });

    // Discord OAuth2
    this.providers.set('discord', {
      clientId: this.configService.get<string>('DISCORD_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('DISCORD_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('DISCORD_REDIRECT_URI')!,
      scopes: ['identify', 'email'],
      apiBaseUrl: 'https://discord.com/api',
      tokenEndpoint: 'https://discord.com/api/oauth2/token',
      userInfoEndpoint: 'https://discord.com/api/users/@me',
    });

    // Apple Sign In
    this.providers.set('apple', {
      clientId: this.configService.get<string>('APPLE_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('APPLE_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('APPLE_REDIRECT_URI')!,
      scopes: ['name', 'email'],
      apiBaseUrl: 'https://appleid.apple.com',
      tokenEndpoint: 'https://appleid.apple.com/auth/token',
      userInfoEndpoint: '', // Apple provides user info in the initial auth response
    });

    // TikTok OAuth2
    this.providers.set('tiktok', {
      clientId: this.configService.get<string>('TIKTOK_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('TIKTOK_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('TIKTOK_REDIRECT_URI')!,
      scopes: ['user.info.basic'],
      apiBaseUrl: 'https://open.tiktokapis.com',
      tokenEndpoint: 'https://open.tiktokapis.com/v2/oauth/token/',
      userInfoEndpoint: 'https://open.tiktokapis.com/v2/user/info/',
    });
  }

  /**
   * Get social authentication URL
   */
  async getAuthUrl(provider: string, redirectUri?: string): Promise<{ url: string; state: string }> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported social provider: ${provider}`);
    }

    const state = uuidv4();
    const stateData: SocialAuthState = {
      state,
      provider,
      redirectUri,
      createdAt: Date.now(),
    };

    // Store state in Redis with expiry
    await this.redisService.setex(
      `social_state:${state}`,
      this.stateExpiry,
      JSON.stringify(stateData)
    );

    let authUrl: string;
    
    switch (provider) {
      case 'twitter':
        authUrl = this.buildTwitterAuthUrl(providerConfig, state);
        break;
      case 'facebook':
        authUrl = this.buildFacebookAuthUrl(providerConfig, state);
        break;
      case 'instagram':
        authUrl = this.buildInstagramAuthUrl(providerConfig, state);
        break;
      case 'discord':
        authUrl = this.buildDiscordAuthUrl(providerConfig, state);
        break;
      case 'apple':
        authUrl = this.buildAppleAuthUrl(providerConfig, state);
        break;
      case 'tiktok':
        authUrl = this.buildTikTokAuthUrl(providerConfig, state);
        break;
      default:
        throw new BadRequestException(`Auth URL generation not implemented for: ${provider}`);
    }

    this.logger.info('Social auth URL generated', {
      provider,
      state,
      redirectUri: providerConfig.redirectUri,
    });

    return { url: authUrl, state };
  }

  /**
   * Exchange authorization code for user information
   */
  async exchangeCodeForUser(
    provider: string,
    code: string,
    state: string,
    additionalParams?: Record<string, any>,
  ): Promise<{ user: SocialUserInfo; tokens: any }> {
    // Verify state
    const stateData = await this.verifyState(state, provider);
    
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported social provider: ${provider}`);
    }

    try {
      // Exchange code for access token
      const tokens = await this.exchangeCode(providerConfig, code);
      
      // Get user info
      const userInfo = await this.getUserInfo(provider, tokens, additionalParams);
      
      // Store tokens in Redis
      const tokenKey = `social_tokens:${userInfo.id}:${provider}`;
      await this.redisService.setex(
        tokenKey,
        this.tokenExpiry,
        JSON.stringify(tokens)
      );

      this.logger.info('Social auth code exchange successful', {
        provider,
        userId: userInfo.id,
        email: userInfo.email,
      });

      return { user: userInfo, tokens };
    } catch (error) {
      this.logger.error('Social auth code exchange failed', {
        provider,
        error: error.message,
        code,
        state,
      });
      throw new UnauthorizedException('Failed to exchange authorization code');
    }
  }

  /**
   * Authenticate or create user from social provider
   */
  async authenticateUser(userInfo: SocialUserInfo): Promise<{ user: any; jwtToken: string }> {
    // Check if user exists with this social provider
    let user = await this.userService.findBySocialProvider(userInfo.provider, userInfo.id);

    if (!user) {
      // Check if user exists with the same email
      const existingUser = await this.userService.findByEmail(userInfo.email);
      
      if (existingUser) {
        // Link social account to existing user
        user = await this.userService.linkSocialAccount(
          existingUser.id,
          userInfo.provider,
          userInfo.id,
          userInfo
        );
      } else {
        // Create new user
        user = await this.userService.createFromSocial(userInfo);
      }
    } else {
      // Update user info
      user = await this.userService.updateSocialUserInfo(user.id, userInfo);
    }

    // Generate JWT token
    const payload = {
      sub: user.id,
      email: user.email,
      authMethod: 'social',
      provider: userInfo.provider,
      verified: userInfo.verified,
    };

    const jwtToken = this.jwtService.sign(payload);

    this.logger.info('Social user authentication successful', {
      provider: userInfo.provider,
      userId: user.id,
      email: user.email,
    });

    return { user, jwtToken };
  }

  /**
   * Refresh social access token
   */
  async refreshToken(provider: string, refreshToken: string): Promise<any> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported social provider: ${provider}`);
    }

    try {
      const response = await lastValueFrom(
        this.httpService.post(
          providerConfig.tokenEndpoint,
          {
            client_id: providerConfig.clientId,
            client_secret: providerConfig.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          },
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        )
      );

      return response.data;
    } catch (error) {
      this.logger.error('Social token refresh failed', {
        provider,
        error: error.message,
      });
      throw new UnauthorizedException('Failed to refresh access token');
    }
  }

  /**
   * Revoke social access token
   */
  async revokeToken(provider: string, accessToken: string): Promise<void> {
    try {
      switch (provider) {
        case 'facebook':
          await lastValueFrom(
            this.httpService.get(
              `https://graph.facebook.com/me/permissions?access_token=${accessToken}`
            )
          );
          break;
        case 'discord':
          await lastValueFrom(
            this.httpService.post(
              'https://discord.com/api/oauth2/token/revoke',
              `token=${accessToken}`,
              {
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              }
            )
          );
          break;
        // Note: Not all providers support token revocation
      }

      this.logger.info('Social token revoked', { provider });
    } catch (error) {
      this.logger.error('Social token revocation failed', {
        provider,
        error: error.message,
      });
      // Don't throw error as revocation is optional
    }
  }

  private async verifyState(state: string, provider: string): Promise<SocialAuthState> {
    const stateDataStr = await this.redisService.get(`social_state:${state}`);
    
    if (!stateDataStr) {
      throw new BadRequestException('Invalid or expired state');
    }

    const stateData: SocialAuthState = JSON.parse(stateDataStr);
    
    if (stateData.provider !== provider) {
      throw new BadRequestException('State provider mismatch');
    }

    if (Date.now() - stateData.createdAt > this.stateExpiry * 1000) {
      throw new BadRequestException('State expired');
    }

    // Clean up state
    await this.redisService.del(`social_state:${state}`);
    
    return stateData;
  }

  private async exchangeCode(providerConfig: SocialProviderConfig, code: string): Promise<any> {
    const response = await lastValueFrom(
      this.httpService.post(
        providerConfig.tokenEndpoint,
        {
          client_id: providerConfig.clientId,
          client_secret: providerConfig.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: providerConfig.redirectUri,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      )
    );

    return response.data;
  }

  private async getUserInfo(
    provider: string,
    tokens: any,
    additionalParams?: Record<string, any>,
  ): Promise<SocialUserInfo> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported social provider: ${provider}`);
    }

    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
    };

    try {
      let userInfo: SocialUserInfo;

      switch (provider) {
        case 'twitter':
          userInfo = await this.getTwitterUserInfo(headers, additionalParams);
          break;
        case 'facebook':
          userInfo = await this.getFacebookUserInfo(headers);
          break;
        case 'instagram':
          userInfo = await this.getInstagramUserInfo(headers);
          break;
        case 'discord':
          userInfo = await this.getDiscordUserInfo(headers);
          break;
        case 'apple':
          userInfo = await this.getAppleUserInfo(tokens, additionalParams);
          break;
        case 'tiktok':
          userInfo = await this.getTikTokUserInfo(headers);
          break;
        default:
          throw new BadRequestException(`User info extraction not implemented for: ${provider}`);
      }

      userInfo.provider = provider;
      return userInfo;
    } catch (error) {
      this.logger.error('Failed to get user info', {
        provider,
        error: error.message,
      });
      throw error;
    }
  }

  private async getTwitterUserInfo(headers: any, additionalParams?: any): Promise<SocialUserInfo> {
    const response = await lastValueFrom(
      this.httpService.get('https://api.twitter.com/2/users/me', {
        headers,
        params: {
          'user.fields': 'created_at,description,location,pinned_tweet_id,profile_image_url,protected,public_metrics,url,username,verified',
        },
      })
    );

    const data = response.data.data;
    return {
      id: data.id,
      username: data.username,
      name: data.name,
      bio: data.description,
      location: data.location,
      avatar: data.profile_image_url,
      verified: data.verified,
      followersCount: data.public_metrics?.followers_count,
      followingCount: data.public_metrics?.following_count,
      email: additionalParams?.email || '', // Email requires special scope
    };
  }

  private async getFacebookUserInfo(headers: any): Promise<SocialUserInfo> {
    const response = await lastValueFrom(
      this.httpService.get('https://graph.facebook.com/me', {
        headers,
        params: {
          fields: 'id,name,email,first_name,last_name,picture',
        },
      })
    );

    const data = response.data;
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      firstName: data.first_name,
      lastName: data.last_name,
      avatar: data.picture?.data?.url,
    };
  }

  private async getInstagramUserInfo(headers: any): Promise<SocialUserInfo> {
    const response = await lastValueFrom(
      this.httpService.get('https://graph.instagram.com/me', {
        headers,
        params: {
          fields: 'id,username,account_type,media_count',
        },
      })
    );

    const data = response.data;
    return {
      id: data.id,
      username: data.username,
    };
  }

  private async getDiscordUserInfo(headers: any): Promise<SocialUserInfo> {
    const response = await lastValueFrom(
      this.httpService.get('https://discord.com/api/users/@me', { headers })
    );

    const data = response.data;
    return {
      id: data.id,
      email: data.email,
      username: data.username,
      name: data.global_name || data.username,
      avatar: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : undefined,
      verified: data.verified,
    };
  }

  private async getAppleUserInfo(tokens: any, additionalParams?: any): Promise<SocialUserInfo> {
    // Apple provides user info in the initial auth response
    const user = additionalParams?.user;
    const email = additionalParams?.email || tokens.email;

    return {
      id: tokens.sub,
      email: email || '',
      firstName: user?.name?.firstName,
      lastName: user?.name?.lastName,
      name: user ? `${user.name?.firstName || ''} ${user.name?.lastName || ''}`.trim() : undefined,
    };
  }

  private async getTikTokUserInfo(headers: any): Promise<SocialUserInfo> {
    const response = await lastValueFrom(
      this.httpService.get('https://open.tiktokapis.com/v2/user/info/', {
        headers,
      })
    );

    const data = response.data.data.user;
    return {
      id: data.open_id,
      username: data.display_name,
      avatar: data.avatar_url,
      verified: data.is_verified,
    };
  }

  private buildTwitterAuthUrl(config: SocialProviderConfig, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state,
      code_challenge: this.generateCodeChallenge(),
      code_challenge_method: 'S256',
    });

    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  private buildFacebookAuthUrl(config: SocialProviderConfig, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  private buildInstagramAuthUrl(config: SocialProviderConfig, state: string): string {
    const params = new URLSearchParams({
      app_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
    });

    return `https://api.instagram.com/oauth/authorize?${params.toString()}`;
  }

  private buildDiscordAuthUrl(config: SocialProviderConfig, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
    });

    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  }

  private buildAppleAuthUrl(config: SocialProviderConfig, state: string): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
      response_mode: 'form_post',
    });

    return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
  }

  private buildTikTokAuthUrl(config: SocialProviderConfig, state: string): string {
    const params = new URLSearchParams({
      client_key: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
    });

    return `https://www.tiktok.com/v2/auth/authorize?${params.toString()}`;
  }

  private generateCodeChallenge(): string {
    const verifier = uuidv4() + uuidv4();
    const hash = crypto.createHash('sha256').update(verifier).digest('base64url');
    return hash;
  }

  /**
   * Get list of supported social providers
   */
  getSupportedProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if provider is configured
   */
  isProviderConfigured(provider: string): boolean {
    const config = this.providers.get(provider);
    return !!(config?.clientId && config?.clientSecret);
  }
}
