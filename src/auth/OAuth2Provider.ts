import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '../../common/services/redis.service';
import { StructuredLoggerService } from '../../common/logging/logger.service';
import { UserService } from '../../users/user.service';
import { JwtService } from '@nestjs/jwt';

export interface OAuth2ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
}

export interface OAuth2UserInfo {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  provider: string;
}

export interface OAuth2StateData {
  state: string;
  provider: string;
  redirectUri?: string;
  createdAt: number;
}

@Injectable()
export class OAuth2Provider {
  private readonly providers: Map<string, OAuth2ProviderConfig> = new Map();
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
    this.logger.setContext('OAuth2Provider');
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Google OAuth2
    this.providers.set('google', {
      clientId: this.configService.get<string>('GOOGLE_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('GOOGLE_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('GOOGLE_REDIRECT_URI')!,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      scopes: ['openid', 'email', 'profile'],
    });

    // GitHub OAuth2
    this.providers.set('github', {
      clientId: this.configService.get<string>('GITHUB_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('GITHUB_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('GITHUB_REDIRECT_URI')!,
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      scopes: ['user:email'],
    });

    // Microsoft OAuth2
    this.providers.set('microsoft', {
      clientId: this.configService.get<string>('MICROSOFT_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('MICROSOFT_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('MICROSOFT_REDIRECT_URI')!,
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      scopes: ['openid', 'email', 'profile'],
    });

    // LinkedIn OAuth2
    this.providers.set('linkedin', {
      clientId: this.configService.get<string>('LINKEDIN_CLIENT_ID')!,
      clientSecret: this.configService.get<string>('LINKEDIN_CLIENT_SECRET')!,
      redirectUri: this.configService.get<string>('LINKEDIN_REDIRECT_URI')!,
      authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      userInfoUrl: 'https://api.linkedin.com/v2/people/~:(id,firstName,lastName,emailAddress,profilePicture(displayImage~:playableStreams))',
      scopes: ['r_liteprofile', 'r_emailaddress'],
    });
  }

  /**
   * Generate OAuth2 authorization URL
   */
  async getAuthorizationUrl(provider: string, redirectUri?: string): Promise<{ url: string; state: string }> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported OAuth2 provider: ${provider}`);
    }

    const state = uuidv4();
    const stateData: OAuth2StateData = {
      state,
      provider,
      redirectUri,
      createdAt: Date.now(),
    };

    // Store state in Redis with expiry
    await this.redisService.setex(
      `oauth2_state:${state}`,
      this.stateExpiry,
      JSON.stringify(stateData)
    );

    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: providerConfig.redirectUri,
      response_type: 'code',
      scope: providerConfig.scopes.join(' '),
      state,
    });

    const authorizationUrl = `${providerConfig.authorizationUrl}?${params.toString()}`;

    this.logger.info('OAuth2 authorization URL generated', {
      provider,
      state,
      redirectUri: providerConfig.redirectUri,
    });

    return { url: authorizationUrl, state };
  }

  /**
   * Exchange authorization code for access token and user info
   */
  async exchangeCodeForTokens(
    provider: string,
    code: string,
    state: string,
  ): Promise<{ user: OAuth2UserInfo; tokens: any }> {
    // Verify state
    const stateData = await this.verifyState(state, provider);
    
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported OAuth2 provider: ${provider}`);
    }

    try {
      // Exchange code for access token
      const tokenResponse = await this.exchangeCode(providerConfig, code);
      
      // Get user info
      const userInfo = await this.getUserInfo(providerConfig, tokenResponse.access_token);
      
      // Store tokens in Redis
      const tokenKey = `oauth2_tokens:${userInfo.id}:${provider}`;
      await this.redisService.setex(
        tokenKey,
        this.tokenExpiry,
        JSON.stringify(tokenResponse)
      );

      this.logger.info('OAuth2 token exchange successful', {
        provider,
        userId: userInfo.id,
        email: userInfo.email,
      });

      return {
        user: userInfo,
        tokens: tokenResponse,
      };
    } catch (error) {
      this.logger.error('OAuth2 token exchange failed', {
        provider,
        error: error.message,
        code,
        state,
      });
      throw new UnauthorizedException('Failed to exchange authorization code');
    }
  }

  /**
   * Authenticate or create user from OAuth2 provider
   */
  async authenticateUser(userInfo: OAuth2UserInfo): Promise<{ user: any; jwtToken: string }> {
    // Check if user exists with this OAuth2 provider
    let user = await this.userService.findByOAuth2Provider(userInfo.provider, userInfo.id);

    if (!user) {
      // Check if user exists with the same email
      const existingUser = await this.userService.findByEmail(userInfo.email);
      
      if (existingUser) {
        // Link OAuth2 account to existing user
        user = await this.userService.linkOAuth2Account(
          existingUser.id,
          userInfo.provider,
          userInfo.id,
          userInfo
        );
      } else {
        // Create new user
        user = await this.userService.createFromOAuth2(userInfo);
      }
    } else {
      // Update user info
      user = await this.userService.updateOAuth2UserInfo(user.id, userInfo);
    }

    // Generate JWT token
    const payload = {
      sub: user.id,
      email: user.email,
      authMethod: 'oauth2',
      provider: userInfo.provider,
    };

    const jwtToken = this.jwtService.sign(payload);

    this.logger.info('OAuth2 user authentication successful', {
      provider: userInfo.provider,
      userId: user.id,
      email: user.email,
    });

    return { user, jwtToken };
  }

  /**
   * Refresh OAuth2 access token
   */
  async refreshToken(provider: string, refreshToken: string): Promise<any> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported OAuth2 provider: ${provider}`);
    }

    try {
      const response = await lastValueFrom(
        this.httpService.post(
          providerConfig.tokenUrl,
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
      this.logger.error('OAuth2 token refresh failed', {
        provider,
        error: error.message,
      });
      throw new UnauthorizedException('Failed to refresh access token');
    }
  }

  /**
   * Revoke OAuth2 access token
   */
  async revokeToken(provider: string, accessToken: string): Promise<void> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported OAuth2 provider: ${provider}`);
    }

    try {
      // Note: Not all providers support token revocation
      if (provider === 'google') {
        await lastValueFrom(
          this.httpService.post('https://oauth2.googleapis.com/revoke', {
            token: accessToken,
          })
        );
      }

      this.logger.info('OAuth2 token revoked', { provider });
    } catch (error) {
      this.logger.error('OAuth2 token revocation failed', {
        provider,
        error: error.message,
      });
      // Don't throw error as revocation is optional
    }
  }

  private async verifyState(state: string, provider: string): Promise<OAuth2StateData> {
    const stateDataStr = await this.redisService.get(`oauth2_state:${state}`);
    
    if (!stateDataStr) {
      throw new BadRequestException('Invalid or expired state');
    }

    const stateData: OAuth2StateData = JSON.parse(stateDataStr);
    
    if (stateData.provider !== provider) {
      throw new BadRequestException('State provider mismatch');
    }

    if (Date.now() - stateData.createdAt > this.stateExpiry * 1000) {
      throw new BadRequestException('State expired');
    }

    // Clean up state
    await this.redisService.del(`oauth2_state:${state}`);
    
    return stateData;
  }

  private async exchangeCode(providerConfig: OAuth2ProviderConfig, code: string): Promise<any> {
    const response = await lastValueFrom(
      this.httpService.post(
        providerConfig.tokenUrl,
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

  private async getUserInfo(providerConfig: OAuth2ProviderConfig, accessToken: string): Promise<OAuth2UserInfo> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };

    const response = await lastValueFrom(
      this.httpService.get(providerConfig.userInfoUrl, { headers })
    );

    const data = response.data;
    
    // Transform response data based on provider
    switch (providerConfig.authorizationUrl) {
      case 'https://accounts.google.com/o/oauth2/v2/auth':
        return {
          id: data.id,
          email: data.email,
          name: data.name,
          firstName: data.given_name,
          lastName: data.family_name,
          avatar: data.picture,
          provider: 'google',
        };
      
      case 'https://github.com/login/oauth/authorize':
        return {
          id: data.id.toString(),
          email: data.email,
          name: data.name,
          avatar: data.avatar_url,
          provider: 'github',
        };
      
      case 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize':
        return {
          id: data.id,
          email: data.mail || data.userPrincipalName,
          name: data.displayName,
          provider: 'microsoft',
        };
      
      case 'https://www.linkedin.com/oauth/v2/authorization':
        return {
          id: data.id,
          email: data.emailAddress,
          firstName: data.firstName.localized.en_US,
          lastName: data.lastName.localized.en_US,
          provider: 'linkedin',
        };
      
      default:
        throw new BadRequestException('Unsupported OAuth2 provider for user info extraction');
    }
  }

  /**
   * Get list of supported OAuth2 providers
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
