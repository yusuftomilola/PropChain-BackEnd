import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/services/redis.service';
import { StructuredLoggerService } from '../../common/logging/logger.service';
import { UserService } from '../../users/user.service';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import * as xml2js from 'xml2js';
import { v4 as uuidv4 } from 'uuid';

export interface SAMLEntityDescriptor {
  entityID: string;
  ssoURL: string;
  sloURL?: string;
  certificate: string;
  nameIDFormat: string;
}

export interface SAMLRequest {
  id: string;
  issuer: string;
  assertionConsumerServiceURL: string;
  destination: string;
  timestamp: string;
  relayState?: string;
}

export interface SAMLResponse {
  id: string;
  issuer: string;
  audience: string;
  nameID: string;
  nameIDFormat: string;
  attributes: Record<string, string[]>;
  sessionIndex?: string;
  notBefore: string;
  notOnOrAfter: string;
}

export interface SAMLUserInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  department?: string;
  title?: string;
  groups?: string[];
  provider: string;
}

@Injectable()
export class SAMLProvider {
  private readonly providers: Map<string, SAMLEntityDescriptor> = new Map();
  private readonly requestExpiry = 300; // 5 minutes
  private readonly responseExpiry = 600; // 10 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly logger: StructuredLoggerService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {
    this.logger.setContext('SAMLProvider');
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Example SAML IdP configurations
    // These should be configured based on your enterprise SSO setup

    // Azure AD SAML
    this.providers.set('azure-ad', {
      entityID: this.configService.get<string>('AZURE_AD_ENTITY_ID')!,
      ssoURL: this.configService.get<string>('AZURE_AD_SSO_URL')!,
      sloURL: this.configService.get<string>('AZURE_AD_SLO_URL'),
      certificate: this.configService.get<string>('AZURE_AD_CERTIFICATE')!,
      nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    });

    // Okta SAML
    this.providers.set('okta', {
      entityID: this.configService.get<string>('OKTA_ENTITY_ID')!,
      ssoURL: this.configService.get<string>('OKTA_SSO_URL')!,
      sloURL: this.configService.get<string>('OKTA_SLO_URL'),
      certificate: this.configService.get<string>('OKTA_CERTIFICATE')!,
      nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    });

    // ADFS SAML
    this.providers.set('adfs', {
      entityID: this.configService.get<string>('ADFS_ENTITY_ID')!,
      ssoURL: this.configService.get<string>('ADFS_SSO_URL')!,
      sloURL: this.configService.get<string>('ADFS_SLO_URL'),
      certificate: this.configService.get<string>('ADFS_CERTIFICATE')!,
      nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    });
  }

  /**
   * Generate SAML authentication request
   */
  async generateAuthRequest(
    provider: string,
    relayState?: string,
  ): Promise<{ samlRequest: string; relayState: string; requestId: string }> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new BadRequestException(`Unsupported SAML provider: ${provider}`);
    }

    const requestId = `_id_${uuidv4().replace(/-/g, '')}`;
    const timestamp = new Date().toISOString();
    const assertionConsumerServiceURL = this.configService.get<string>(
      'SAML_ASSERTION_CONSUMER_SERVICE_URL'
    )!;

    const samlRequest: SAMLRequest = {
      id: requestId,
      issuer: this.configService.get<string>('SAML_ENTITY_ID')!,
      assertionConsumerServiceURL,
      destination: providerConfig.ssoURL,
      timestamp,
      relayState,
    };

    // Store request in Redis
    await this.redisService.setex(
      `saml_request:${requestId}`,
      this.requestExpiry,
      JSON.stringify(samlRequest)
    );

    // Generate SAML AuthnRequest XML
    const authnRequestXml = this.buildAuthnRequestXml(samlRequest, providerConfig);
    
    // Base64 encode the XML
    const encodedRequest = Buffer.from(authnRequestXml).toString('base64');

    // Generate relay state if not provided
    const finalRelayState = relayState || uuidv4();

    this.logger.info('SAML auth request generated', {
      provider,
      requestId,
      relayState: finalRelayState,
    });

    return {
      samlRequest: encodedRequest,
      relayState: finalRelayState,
      requestId,
    };
  }

  /**
   * Process SAML response
   */
  async processResponse(
    samlResponse: string,
    relayState?: string,
  ): Promise<{ user: SAMLUserInfo; jwtToken: string }> {
    try {
      // Decode SAML response
      const decodedResponse = Buffer.from(samlResponse, 'base64').toString('utf-8');
      
      // Parse and validate SAML response
      const response = await this.parseAndValidateResponse(decodedResponse);
      
      // Extract user information
      const userInfo = this.extractUserInfo(response);
      
      // Authenticate or create user
      const { user, jwtToken } = await this.authenticateUser(userInfo);

      this.logger.info('SAML response processed successfully', {
        provider: userInfo.provider,
        userId: user.id,
        email: user.email,
      });

      return { user: userInfo, jwtToken };
    } catch (error) {
      this.logger.error('SAML response processing failed', {
        error: error.message,
        relayState,
      });
      throw new UnauthorizedException('Invalid SAML response');
    }
  }

  /**
   * Generate SAML logout request
   */
  async generateLogoutRequest(
    provider: string,
    nameID: string,
    sessionIndex?: string,
  ): Promise<{ samlRequest: string; relayState: string }> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig || !providerConfig.sloURL) {
      throw new BadRequestException(`SLO not supported for provider: ${provider}`);
    }

    const requestId = `_id_${uuidv4().replace(/-/g, '')}`;
    const timestamp = new Date().toISOString();
    const relayState = uuidv4();

    // Store logout request in Redis
    await this.redisService.setex(
      `saml_logout_request:${requestId}`,
      this.requestExpiry,
      JSON.stringify({
        requestId,
        nameID,
        sessionIndex,
        timestamp,
        provider,
      })
    );

    // Generate SAML LogoutRequest XML
    const logoutRequestXml = this.buildLogoutRequestXml(
      requestId,
      nameID,
      sessionIndex,
      providerConfig
    );

    // Base64 encode the XML
    const encodedRequest = Buffer.from(logoutRequestXml).toString('base64');

    this.logger.info('SAML logout request generated', {
      provider,
      requestId,
      nameID,
    });

    return {
      samlRequest: encodedRequest,
      relayState,
    };
  }

  /**
   * Process SAML logout response
   */
  async processLogoutResponse(samlResponse: string): Promise<void> {
    try {
      const decodedResponse = Buffer.from(samlResponse, 'base64').toString('utf-8');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(decodedResponse);

      const response = result['samlp:LogoutResponse'];
      if (!response) {
        throw new Error('Invalid SAML logout response format');
      }

      const status = response['samlp:Status'][0]['samlp:StatusCode'][0].$.Value;
      if (status !== 'urn:oasis:names:tc:SAML:2.0:status:Success') {
        throw new Error('SAML logout failed');
      }

      this.logger.info('SAML logout response processed successfully');
    } catch (error) {
      this.logger.error('SAML logout response processing failed', {
        error: error.message,
      });
      throw new UnauthorizedException('Invalid SAML logout response');
    }
  }

  private buildAuthnRequestXml(request: SAMLRequest, provider: SAMLEntityDescriptor): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest 
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${request.id}"
  Version="2.0"
  IssueInstant="${request.timestamp}"
  Destination="${request.destination}"
  AssertionConsumerServiceURL="${request.assertionConsumerServiceURL}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${request.issuer}</saml:Issuer>
  <samlp:NameIDPolicy Format="${provider.nameIDFormat}" AllowCreate="true"/>
  <samlp:RequestedAuthnContext Comparison="exact">
    <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
  </samlp:RequestedAuthnContext>
</samlp:AuthnRequest>`;
  }

  private buildLogoutRequestXml(
    requestId: string,
    nameID: string,
    sessionIndex: string | undefined,
    provider: SAMLEntityDescriptor,
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:LogoutRequest 
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${requestId}"
  Version="2.0"
  IssueInstant="${new Date().toISOString()}"
  Destination="${provider.sloURL}">
  <saml:Issuer>${this.configService.get<string>('SAML_ENTITY_ID')}</saml:Issuer>
  <saml:NameID Format="${provider.nameIDFormat}">${nameID}</saml:NameID>
  ${sessionIndex ? `<samlp:SessionIndex>${sessionIndex}</samlp:SessionIndex>` : ''}
</samlp:LogoutRequest>`;
  }

  private async parseAndValidateResponse(xmlResponse: string): Promise<SAMLResponse> {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlResponse);

    const response = result['samlp:Response'];
    if (!response) {
      throw new Error('Invalid SAML response format');
    }

    const assertion = response['saml:Assertion']?.[0];
    if (!assertion) {
      throw new Error('No SAML assertion found');
    }

    // Extract and validate response data
    const responseId = response.$.ID;
    const issuer = assertion['saml:Issuer'][0];
    const subject = assertion['saml:Subject'][0];
    const nameID = subject['saml:NameID'][0];
    const conditions = assertion['saml:Conditions'][0];
    const attributes = assertion['saml:AttributeStatement']?.[0]?.['saml:Attribute'] || [];

    // Validate timestamps
    const notBefore = new Date(conditions.$.NotBefore);
    const notOnOrAfter = new Date(conditions.$.NotOnOrAfter);
    const now = new Date();

    if (now < notBefore || now > notOnOrAfter) {
      throw new Error('SAML response is not within valid time range');
    }

    // Extract attributes
    const attributeMap: Record<string, string[]> = {};
    attributes.forEach((attr: any) => {
      const name = attr.$.Name;
      const values = attr['saml:AttributeValue'].map((val: any) => val._ || val);
      attributeMap[name] = values;
    });

    return {
      id: responseId,
      issuer,
      audience: conditions['saml:AudienceRestriction'][0]['saml:Audience'][0],
      nameID: nameID._ || nameID,
      nameIDFormat: nameID.$.Format,
      attributes: attributeMap,
      sessionIndex: assertion['saml:AuthnStatement']?.[0]?.$.SessionIndex,
      notBefore: conditions.$.NotBefore,
      notOnOrAfter: conditions.$.NotOnOrAfter,
    };
  }

  private extractUserInfo(response: SAMLResponse): SAMLUserInfo {
    // Determine provider from issuer
    let provider = 'unknown';
    for (const [key, config] of this.providers.entries()) {
      if (response.issuer.includes(config.entityID)) {
        provider = key;
        break;
      }
    }

    // Extract user attributes (common SAML attribute names)
    const email = response.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress']?.[0] ||
                  response.attributes['email']?.[0] ||
                  response.nameID;

    const firstName = response.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname']?.[0] ||
                      response.attributes['firstName']?.[0];

    const lastName = response.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname']?.[0] ||
                     response.attributes['lastName']?.[0];

    const name = response.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name']?.[0] ||
                 response.attributes['name']?.[0];

    const department = response.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department']?.[0] ||
                       response.attributes['department']?.[0];

    const title = response.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/title']?.[0] ||
                  response.attributes['title']?.[0];

    const groups = response.attributes['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'] ||
                   response.attributes['groups'] ||
                   [];

    return {
      id: response.nameID,
      email: email || '',
      firstName,
      lastName,
      name,
      department,
      title,
      groups,
      provider,
    };
  }

  private async authenticateUser(userInfo: SAMLUserInfo): Promise<{ user: any; jwtToken: string }> {
    // Check if user exists with this SAML provider
    let user = await this.userService.findBySAMLProvider(userInfo.provider, userInfo.id);

    if (!user) {
      // Check if user exists with the same email
      const existingUser = await this.userService.findByEmail(userInfo.email);
      
      if (existingUser) {
        // Link SAML account to existing user
        user = await this.userService.linkSAMLAccount(
          existingUser.id,
          userInfo.provider,
          userInfo.id,
          userInfo
        );
      } else {
        // Create new user
        user = await this.userService.createFromSAML(userInfo);
      }
    } else {
      // Update user info
      user = await this.userService.updateSAMLUserInfo(user.id, userInfo);
    }

    // Generate JWT token
    const payload = {
      sub: user.id,
      email: user.email,
      authMethod: 'saml',
      provider: userInfo.provider,
      groups: userInfo.groups,
    };

    const jwtToken = this.jwtService.sign(payload);

    this.logger.info('SAML user authentication successful', {
      provider: userInfo.provider,
      userId: user.id,
      email: user.email,
    });

    return { user, jwtToken };
  }

  /**
   * Get list of supported SAML providers
   */
  getSupportedProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if provider is configured
   */
  isProviderConfigured(provider: string): boolean {
    const config = this.providers.get(provider);
    return !!(config?.entityID && config?.ssoURL && config?.certificate);
  }

  /**
   * Get provider metadata
   */
  getProviderMetadata(provider: string): string | null {
    const config = this.providers.get(provider);
    if (!config) {
      return null;
    }

    const entityID = this.configService.get<string>('SAML_ENTITY_ID')!;
    const assertionConsumerServiceURL = this.configService.get<string>(
      'SAML_ASSERTION_CONSUMER_SERVICE_URL'
    )!;
    const sloURL = this.configService.get<string>('SAML_SINGLE_LOGOUT_SERVICE_URL');

    return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor 
  xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${entityID}">
  <md:SPSSODescriptor 
    AuthnRequestsSigned="true" 
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${this.configService.get<string>('SAML_CERTIFICATE')}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:AssertionConsumerService 
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${assertionConsumerServiceURL}"
      index="1"/>
    ${sloURL ? `
    <md:SingleLogoutService 
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${sloURL}"/>` : ''}
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
  }
}
