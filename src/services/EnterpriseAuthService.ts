import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/services/redis.service';
import { StructuredLoggerService } from '../../common/logging/logger.service';
import { UserService } from '../../users/user.service';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Provider } from '../OAuth2Provider';
import { SAMLProvider } from '../SAMLProvider';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

export interface EnterpriseConfig {
  id: string;
  name: string;
  domain: string;
  ssoProvider: 'saml' | 'oauth2' | 'ldap';
  ssoConfig: any;
  mfaRequired: boolean;
  ipWhitelist?: string[];
  sessionTimeout: number;
  allowedGroups?: string[];
  adminGroups?: string[];
}

export interface EnterpriseUser {
  id: string;
  email: string;
  name?: string;
  department?: string;
  title?: string;
  groups: string[];
  manager?: string;
  employeeId?: string;
  enterpriseId: string;
  permissions: string[];
  lastLogin?: Date;
}

export interface EnterpriseSession {
  sessionId: string;
  userId: string;
  enterpriseId: string;
  authMethod: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
  mfaVerified?: boolean;
}

export interface MFAMethod {
  type: 'totp' | 'sms' | 'email' | 'push';
  enabled: boolean;
  secret?: string;
  phoneNumber?: string;
  backupCodes?: string[];
}

@Injectable()
export class EnterpriseAuthService {
  private readonly enterprises: Map<string, EnterpriseConfig> = new Map();
  private readonly sessionExpiry = 28800; // 8 hours
  private readonly mfaExpiry = 300; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly logger: StructuredLoggerService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly oauth2Provider: OAuth2Provider,
    private readonly samlProvider: SAMLProvider,
  ) {
    this.logger.setContext('EnterpriseAuthService');
    this.initializeEnterprises();
  }

  private initializeEnterprises(): void {
    // Initialize enterprise configurations from environment or database
    const enterpriseConfigs = this.configService.get<EnterpriseConfig[]>('ENTERPRISE_CONFIGS') || [];
    
    enterpriseConfigs.forEach(config => {
      this.enterprises.set(config.id, config);
    });

    // Example enterprise configurations
    if (this.configService.get<string>('EXAMPLE_ENTERPRISE_ENABLED') === 'true') {
      this.enterprises.set('example-corp', {
        id: 'example-corp',
        name: 'Example Corporation',
        domain: 'example.com',
        ssoProvider: 'saml',
        ssoConfig: {
          provider: 'azure-ad',
          entityId: 'https://sts.windows.net/example-corp-id/',
        },
        mfaRequired: true,
        ipWhitelist: ['192.168.1.0/24', '10.0.0.0/8'],
        sessionTimeout: 28800,
        allowedGroups: ['Employees', 'Contractors'],
        adminGroups: ['IT-Admins', 'HR-Admins'],
      });
    }
  }

  /**
   * Authenticate user via enterprise SSO
   */
  async authenticateEnterpriseUser(
    enterpriseId: string,
    authMethod: 'saml' | 'oauth2',
    authData: any,
    context: { ipAddress: string; userAgent: string },
  ): Promise<{ user: EnterpriseUser; session: EnterpriseSession; jwtToken: string }> {
    // Validate enterprise configuration
    const enterprise = this.enterprises.get(enterpriseId);
    if (!enterprise) {
      throw new BadRequestException(`Enterprise not found: ${enterpriseId}`);
    }

    // Validate IP whitelist if configured
    if (enterprise.ipWhitelist && !this.isIpAllowed(context.ipAddress, enterprise.ipWhitelist)) {
      this.logger.warn('Enterprise login blocked - IP not whitelisted', {
        enterpriseId,
        ipAddress: context.ipAddress,
      });
      throw new ForbiddenException('Access denied from this IP address');
    }

    let enterpriseUser: EnterpriseUser;

    try {
      // Authenticate via SSO provider
      switch (authMethod) {
        case 'saml':
          enterpriseUser = await this.authenticateViaSAML(enterprise, authData);
          break;
        case 'oauth2':
          enterpriseUser = await this.authenticateViaOAuth2(enterprise, authData);
          break;
        default:
          throw new BadRequestException(`Unsupported auth method: ${authMethod}`);
      }

      // Validate user groups
      if (enterprise.allowedGroups && !this.hasAllowedGroups(enterpriseUser.groups, enterprise.allowedGroups)) {
        throw new ForbiddenException('User not in allowed groups');
      }

      // Create enterprise session
      const session = await this.createEnterpriseSession(enterpriseUser, context, enterprise);

      // Generate JWT token with enterprise claims
      const jwtToken = this.generateEnterpriseJWT(enterpriseUser, session, enterprise);

      this.logger.info('Enterprise user authenticated successfully', {
        enterpriseId,
        userId: enterpriseUser.id,
        email: enterpriseUser.email,
        authMethod,
        ipAddress: context.ipAddress,
      });

      return { user: enterpriseUser, session, jwtToken };
    } catch (error) {
      this.logger.error('Enterprise authentication failed', {
        enterpriseId,
        authMethod,
        error: error.message,
        ipAddress: context.ipAddress,
      });
      throw error;
    }
  }

  /**
   * Initiate MFA challenge for enterprise user
   */
  async initiateMFAChallenge(
    sessionId: string,
    method: MFAMethod['type'],
  ): Promise<{ challengeId: string; methods: MFAMethod[] }> {
    const session = await this.getEnterpriseSession(sessionId);
    if (!session) {
      throw new UnauthorizedException('Invalid session');
    }

    const user = await this.userService.findById(session.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Get available MFA methods for user
    const availableMethods = await this.getUserMFAMethods(user.id);

    // Check if requested method is available
    const selectedMethod = availableMethods.find(m => m.type === method && m.enabled);
    if (!selectedMethod) {
      throw new BadRequestException(`MFA method ${method} not available for user`);
    }

    // Generate challenge
    const challengeId = uuidv4();
    const challengeData = {
      sessionId,
      method,
      createdAt: Date.now(),
      attempts: 0,
    };

    await this.redisService.setex(
      `mfa_challenge:${challengeId}`,
      this.mfaExpiry,
      JSON.stringify(challengeData)
    );

    // Send MFA challenge based on method
    await this.sendMFAChallenge(user, method, challengeId);

    this.logger.info('MFA challenge initiated', {
      userId: user.id,
      sessionId,
      method,
      challengeId,
    });

    return { challengeId, methods: availableMethods };
  }

  /**
   * Verify MFA challenge response
   */
  async verifyMFAChallenge(
    challengeId: string,
    response: string,
  ): Promise<{ verified: boolean; session?: EnterpriseSession }> {
    const challengeDataStr = await this.redisService.get(`mfa_challenge:${challengeId}`);
    if (!challengeDataStr) {
      throw new BadRequestException('Invalid or expired challenge');
    }

    const challengeData = JSON.parse(challengeDataStr);
    
    if (challengeData.attempts >= 3) {
      await this.redisService.del(`mfa_challenge:${challengeId}`);
      throw new ForbiddenException('Too many MFA attempts');
    }

    const session = await this.getEnterpriseSession(challengeData.sessionId);
    if (!session) {
      throw new UnauthorizedException('Invalid session');
    }

    const user = await this.userService.findById(session.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const verified = await this.verifyMFAResponse(user, challengeData.method, response);

    if (verified) {
      // Update session to mark MFA as verified
      session.mfaVerified = true;
      await this.updateEnterpriseSession(session);

      // Clean up challenge
      await this.redisService.del(`mfa_challenge:${challengeId}`);

      this.logger.info('MFA challenge verified successfully', {
        userId: user.id,
        sessionId: session.sessionId,
        method: challengeData.method,
      });

      return { verified: true, session };
    } else {
      // Increment attempt count
      challengeData.attempts++;
      await this.redisService.setex(
        `mfa_challenge:${challengeId}`,
        this.mfaExpiry,
        JSON.stringify(challengeData)
      );

      this.logger.warn('MFA challenge verification failed', {
        userId: user.id,
        sessionId: session.sessionId,
        method: challengeData.method,
        attempts: challengeData.attempts,
      });

      return { verified: false };
    }
  }

  /**
   * Validate enterprise session
   */
  async validateEnterpriseSession(sessionId: string): Promise<EnterpriseSession | null> {
    const session = await this.getEnterpriseSession(sessionId);
    
    if (!session) {
      return null;
    }

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      await this.invalidateSession(sessionId);
      return null;
    }

    // Update last activity
    session.expiresAt = new Date(Date.now() + this.sessionExpiry * 1000);
    await this.updateEnterpriseSession(session);

    return session;
  }

  /**
   * Invalidate enterprise session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    await this.redisService.del(`enterprise_session:${sessionId}`);
    
    this.logger.info('Enterprise session invalidated', { sessionId });
  }

  /**
   * Get enterprise configuration
   */
  getEnterpriseConfig(enterpriseId: string): EnterpriseConfig | null {
    return this.enterprises.get(enterpriseId) || null;
  }

  /**
   * List all enterprises
   */
  listEnterprises(): EnterpriseConfig[] {
    return Array.from(this.enterprises.values());
  }

  private async authenticateViaSAML(enterprise: EnterpriseConfig, authData: any): Promise<EnterpriseUser> {
    const samlResponse = await this.samlProvider.processResponse(
      authData.samlResponse,
      authData.relayState,
    );

    // Extract enterprise-specific information
    const enterpriseUser: EnterpriseUser = {
      id: samlResponse.user.id,
      email: samlResponse.user.email,
      name: samlResponse.user.name,
      department: samlResponse.user.department,
      title: samlResponse.user.title,
      groups: samlResponse.user.groups || [],
      enterpriseId: enterprise.id,
      permissions: this.calculatePermissions(samlResponse.user.groups || [], enterprise),
    };

    return enterpriseUser;
  }

  private async authenticateViaOAuth2(enterprise: EnterpriseConfig, authData: any): Promise<EnterpriseUser> {
    const oauth2Response = await this.oauth2Provider.exchangeCodeForTokens(
      enterprise.ssoConfig.provider,
      authData.code,
      authData.state,
    );

    const { user } = await this.oauth2Provider.authenticateUser(oauth2Response.user);

    // Transform to enterprise user
    const enterpriseUser: EnterpriseUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      groups: user.groups || [],
      enterpriseId: enterprise.id,
      permissions: this.calculatePermissions(user.groups || [], enterprise),
    };

    return enterpriseUser;
  }

  private async createEnterpriseSession(
    user: EnterpriseUser,
    context: { ipAddress: string; userAgent: string },
    enterprise: EnterpriseConfig,
  ): Promise<EnterpriseSession> {
    const sessionId = uuidv4();
    const session: EnterpriseSession = {
      sessionId,
      userId: user.id,
      enterpriseId: enterprise.id,
      authMethod: enterprise.ssoProvider,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + enterprise.sessionTimeout * 1000),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      mfaVerified: !enterprise.mfaRequired,
    };

    await this.redisService.setex(
      `enterprise_session:${sessionId}`,
      enterprise.sessionTimeout,
      JSON.stringify(session)
    );

    return session;
  }

  private generateEnterpriseJWT(
    user: EnterpriseUser,
    session: EnterpriseSession,
    enterprise: EnterpriseConfig,
  ): string {
    const payload = {
      sub: user.id,
      email: user.email,
      enterpriseId: enterprise.id,
      sessionId: session.sessionId,
      authMethod: session.authMethod,
      permissions: user.permissions,
      groups: user.groups,
      mfaVerified: session.mfaVerified,
      type: 'enterprise',
    };

    return this.jwtService.sign(payload, {
      expiresIn: `${enterprise.sessionTimeout}s`,
    });
  }

  private async getEnterpriseSession(sessionId: string): Promise<EnterpriseSession | null> {
    const sessionStr = await this.redisService.get(`enterprise_session:${sessionId}`);
    return sessionStr ? JSON.parse(sessionStr) : null;
  }

  private async updateEnterpriseSession(session: EnterpriseSession): Promise<void> {
    const ttl = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
    if (ttl > 0) {
      await this.redisService.setex(
        `enterprise_session:${session.sessionId}`,
        ttl,
        JSON.stringify(session)
      );
    }
  }

  private isIpAllowed(ipAddress: string, whitelist: string[]): boolean {
    // Simple IP validation - in production, use a proper CIDR library
    return whitelist.some(allowed => {
      if (allowed.includes('/')) {
        // CIDR notation - simplified check
        const [network] = allowed.split('/');
        return ipAddress.startsWith(network);
      }
      return ipAddress === allowed;
    });
  }

  private hasAllowedGroups(userGroups: string[], allowedGroups: string[]): boolean {
    return allowedGroups.some(allowed => userGroups.includes(allowed));
  }

  private calculatePermissions(userGroups: string[], enterprise: EnterpriseConfig): string[] {
    const permissions: string[] = [];

    // Base permissions for all enterprise users
    permissions.push('enterprise.access');

    // Admin permissions
    if (enterprise.adminGroups && userGroups.some(group => enterprise.adminGroups!.includes(group))) {
      permissions.push('enterprise.admin', 'enterprise.user_management');
    }

    // Department-specific permissions
    if (userGroups.includes('HR')) {
      permissions.push('enterprise.hr_access');
    }
    if (userGroups.includes('Finance')) {
      permissions.push('enterprise.finance_access');
    }
    if (userGroups.includes('IT')) {
      permissions.push('enterprise.it_access');
    }

    return permissions;
  }

  private async getUserMFAMethods(userId: string): Promise<MFAMethod[]> {
    // In a real implementation, this would fetch from database
    return [
      { type: 'totp', enabled: true },
      { type: 'sms', enabled: false },
      { type: 'email', enabled: true },
      { type: 'push', enabled: false },
    ];
  }

  private async sendMFAChallenge(user: any, method: MFAMethod['type'], challengeId: string): Promise<void> {
    switch (method) {
      case 'totp':
        // TOTP challenge is handled client-side
        break;
      case 'sms':
        // Send SMS with verification code
        const smsCode = this.generateVerificationCode();
        await this.redisService.setex(`mfa_sms:${user.id}`, this.mfaExpiry, smsCode);
        // await this.smsService.send(user.phoneNumber, `Your verification code is: ${smsCode}`);
        break;
      case 'email':
        // Send email with verification code
        const emailCode = this.generateVerificationCode();
        await this.redisService.setex(`mfa_email:${user.id}`, this.mfaExpiry, emailCode);
        // await this.emailService.send(user.email, 'MFA Verification', `Your verification code is: ${emailCode}`);
        break;
      case 'push':
        // Send push notification
        break;
    }
  }

  private async verifyMFAResponse(user: any, method: MFAMethod['type'], response: string): Promise<boolean> {
    switch (method) {
      case 'totp':
        // Verify TOTP token using speakeasy or similar
        return this.verifyTOTP(user.id, response);
      case 'sms':
        const smsCode = await this.redisService.get(`mfa_sms:${user.id}`);
        return smsCode === response;
      case 'email':
        const emailCode = await this.redisService.get(`mfa_email:${user.id}`);
        return emailCode === response;
      case 'push':
        // Verify push notification response
        return true;
      default:
        return false;
    }
  }

  private verifyTOTP(userId: string, token: string): boolean {
    // In a real implementation, use speakeasy or similar library
    // return speakeasy.totp.verify({
    //   secret: user.totpSecret,
    //   encoding: 'base32',
    //   token,
    //   window: 2,
    // });
    return token.length === 6; // Simplified check
  }

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Check if user has specific enterprise permission
   */
  async hasPermission(sessionId: string, permission: string): Promise<boolean> {
    const session = await this.validateEnterpriseSession(sessionId);
    if (!session) {
      return false;
    }

    const user = await this.userService.findById(session.userId);
    if (!user) {
      return false;
    }

    const enterprise = this.enterprises.get(session.enterpriseId);
    if (!enterprise) {
      return false;
    }

    const enterpriseUser: EnterpriseUser = {
      id: user.id,
      email: user.email,
      groups: user.groups || [],
      enterpriseId: session.enterpriseId,
      permissions: this.calculatePermissions(user.groups || [], enterprise),
    };

    return enterpriseUser.permissions.includes(permission);
  }

  /**
   * Get user's enterprise permissions
   */
  async getUserPermissions(sessionId: string): Promise<string[]> {
    const session = await this.validateEnterpriseSession(sessionId);
    if (!session) {
      return [];
    }

    const user = await this.userService.findById(session.userId);
    if (!user) {
      return [];
    }

    const enterprise = this.enterprises.get(session.enterpriseId);
    if (!enterprise) {
      return [];
    }

    return this.calculatePermissions(user.groups || [], enterprise);
  }
}
