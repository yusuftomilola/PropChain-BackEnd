import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailTemplateService } from './email.template';
import { EmailAnalyticsService } from './email.analytics';
import { EmailQueueService } from './email.queue';

/**
 * Email Service
 *
 * Handles email sending with multiple providers and advanced features
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private providers: Map<string, EmailProvider> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly templateService: EmailTemplateService,
    private readonly analyticsService: EmailAnalyticsService,
    private readonly queueService: EmailQueueService,
  ) {
    this.initializeProviders();
  }

  /**
   * Send email using template
   */
  async sendTemplatedEmail(
    to: string | string[],
    templateName: string,
    data: any,
    options?: EmailOptions,
  ): Promise<EmailSendResult> {
    const startTime = Date.now();

    try {
      // Render template
      const renderedEmail = this.templateService.renderTemplate(templateName, data, options?.locale);

      // Prepare email
      const emailData: EmailData = {
        to: Array.isArray(to) ? to : [to],
        subject: renderedEmail.subject,
        html: renderedEmail.content,
        text: this.generateTextVersion(renderedEmail.content),
        from: options?.from || this.configService.get<string>('EMAIL_FROM'),
        replyTo: options?.replyTo,
        cc: options?.cc,
        bcc: options?.bcc,
        attachments: options?.attachments,
        priority: options?.priority || 'normal',
        headers: options?.headers,
      };

      // Send email
      const result = await this.sendEmail(emailData, {
        templateName,
        templateData: data,
        locale: options?.locale || 'en',
        abTestVariant: options?.abTestVariant,
      });

      // Track analytics
      await this.analyticsService.trackEmailSent({
        emailId: result.emailId,
        templateName,
        recipientCount: Array.isArray(to) ? to.length : 1,
        provider: result.provider,
        deliveryTime: Date.now() - startTime,
        success: true,
      });

      this.logger.log(`Email sent successfully using template: ${templateName}`, {
        emailId: result.emailId,
        recipients: Array.isArray(to) ? to.length : 1,
        provider: result.provider,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Track failure
      await this.analyticsService.trackEmailSent({
        emailId: `failed-${Date.now()}`,
        templateName,
        recipientCount: Array.isArray(to) ? to.length : 1,
        provider: 'unknown',
        deliveryTime: Date.now() - startTime,
        success: false,
        error: errorMessage,
      });

      this.logger.error(`Failed to send email using template: ${templateName}`, errorMessage);
      throw error;
    }
  }

  /**
   * Send email directly
   */
  async sendEmail(emailData: EmailData, metadata?: EmailMetadata): Promise<EmailSendResult> {
    const emailId = this.generateEmailId();
    const provider = this.selectProvider(emailData);

    try {
      const result = await provider.send({
        ...emailData,
        messageId: emailId,
      });

      return {
        emailId,
        provider: provider.name,
        messageId: result.messageId,
        status: 'sent',
        timestamp: new Date(),
        metadata,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        emailId,
        provider: provider.name,
        status: 'failed',
        error: errorMessage,
        timestamp: new Date(),
        metadata,
      };
    }
  }

  /**
   * Schedule email for later delivery
   */
  async scheduleEmail(emailData: EmailData, scheduledFor: Date, metadata?: EmailMetadata): Promise<string> {
    const jobId = await this.queueService.add(
      'send-email',
      {
        emailData,
        scheduledFor,
        metadata,
      },
      {
        delay: scheduledFor.getTime() - Date.now(),
        attempts: 3,
        backoff: 'exponential',
      },
    );

    this.logger.log(`Email scheduled for delivery`, {
      jobId,
      scheduledFor: scheduledFor.toISOString(),
    });

    return jobId;
  }

  /**
   * Send batch emails
   */
  async sendBatchEmails(emails: BatchEmailData[], options?: BatchEmailOptions): Promise<BatchEmailResult> {
    const batchId = this.generateBatchId();
    const results: EmailSendResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    const startTime = Date.now();

    try {
      for (const email of emails) {
        try {
          const result = await this.sendEmail(email.data, email.metadata);
          results.push(result);

          if (result.status === 'sent') {
            successCount++;
          } else {
            failureCount++;
          }
        } catch (error) {
          failureCount++;
          results.push({
            emailId: this.generateEmailId(),
            provider: 'unknown',
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date(),
          });
        }

        // Rate limiting between batch sends
        if (options?.rateLimit) {
          await this.delay(options.rateLimit);
        }
      }

      const totalTime = Date.now() - startTime;

      // Track batch analytics
      await this.analyticsService.trackBatchEmail({
        batchId,
        totalEmails: emails.length,
        successCount,
        failureCount,
        totalTime,
      });

      this.logger.log(`Batch email completed`, {
        batchId,
        totalEmails: emails.length,
        successCount,
        failureCount,
        totalTime,
      });

      return {
        batchId,
        totalEmails: emails.length,
        successCount,
        failureCount,
        results,
        totalTime,
      };
    } catch (error) {
      this.logger.error('Batch email sending failed', error);
      throw error;
    }
  }

  /**
   * Send personalized email with A/B testing
   */
  async sendPersonalizedEmail(
    to: string | string[],
    templateName: string,
    baseData: any,
    personalizationRules: PersonalizationRule[],
    options?: EmailOptions,
  ): Promise<EmailSendResult> {
    // Determine A/B test variant
    const variant = this.determineABTestVariant(options?.abTestVariant);

    // Apply personalization rules
    const personalizedData = this.applyPersonalizationRules(baseData, personalizationRules);

    // Get template variant if A/B testing
    let finalTemplate = templateName;
    if (variant && variant !== 'control') {
      finalTemplate = `${templateName}_${variant}`;
    }

    return this.sendTemplatedEmail(to, finalTemplate, personalizedData, {
      ...options,
      abTestVariant: variant,
    });
  }

  /**
   * Initialize email providers
   */
  private initializeProviders(): void {
    // Initialize primary provider (SMTP)
    const smtpConfig = {
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<boolean>('SMTP_SECURE', false),
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    };

    this.transporter = nodemailer.createTransport(smtpConfig);

    // Register providers
    this.providers.set('smtp', {
      name: 'smtp',
      send: async emailData => {
        const result = await this.transporter.sendMail(emailData);
        return { messageId: result.messageId };
      },
      isAvailable: async () => true,
      priority: 1,
    });

    // Add backup providers (SendGrid, AWS SES, etc.)
    this.initializeBackupProviders();
  }

  /**
   * Initialize backup email providers
   */
  private initializeBackupProviders(): void {
    // SendGrid provider
    if (this.configService.get<string>('SENDGRID_API_KEY')) {
      this.providers.set('sendgrid', {
        name: 'sendgrid',
        send: async emailData => {
          // SendGrid implementation would go here
          return { messageId: `sendgrid-${Date.now()}` };
        },
        isAvailable: async () => true,
        priority: 2,
      });
    }

    // AWS SES provider
    if (this.configService.get<string>('AWS_ACCESS_KEY_ID')) {
      this.providers.set('ses', {
        name: 'ses',
        send: async emailData => {
          // AWS SES implementation would go here
          return { messageId: `ses-${Date.now()}` };
        },
        isAvailable: async () => true,
        priority: 3,
      });
    }
  }

  /**
   * Select best available provider
   */
  private selectProvider(emailData: EmailData): EmailProvider {
    const availableProviders = Array.from(this.providers.values()).filter(provider => provider.priority);

    // Sort by priority (lower number = higher priority)
    availableProviders.sort((a, b) => a.priority - b.priority);

    const provider = availableProviders[0] ?? this.providers.get('smtp');
    if (!provider) {
      throw new Error('No email provider available');
    }
    return provider;
  }

  /**
   * Determine A/B test variant
   */
  private determineABTestVariant(forcedVariant?: 'A' | 'B' | 'control'): 'A' | 'B' | 'control' {
    if (forcedVariant) {
      return forcedVariant;
    }

    const abTestPercentage = this.configService.get<number>('AB_TEST_PERCENTAGE', 10);
    const random = Math.random() * 100;

    if (random < abTestPercentage / 2) {
      return 'A';
    }
    if (random < abTestPercentage) {
      return 'B';
    }
    return 'control';
  }

  /**
   * Apply personalization rules
   */
  private applyPersonalizationRules(baseData: any, rules: PersonalizationRule[]): any {
    let personalizedData = { ...baseData };

    for (const rule of rules) {
      if (this.evaluateCondition(rule.condition, personalizedData)) {
        personalizedData = this.applyTransformation(personalizedData, rule.transformation);
      }
    }

    return personalizedData;
  }

  /**
   * Evaluate personalization condition
   */
  private evaluateCondition(condition: string, data: any): boolean {
    // Simple condition evaluation - in production, use a proper expression parser
    try {
      // Replace variables with actual values
      let evalCondition = condition;
      Object.keys(data).forEach(key => {
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        evalCondition = evalCondition.replace(regex, JSON.stringify(data[key]));
      });

      return eval(evalCondition);
    } catch {
      return false;
    }
  }

  /**
   * Apply transformation rule
   */
  private applyTransformation(data: any, transformation: any): any {
    // Simple transformation - in production, use a proper transformation engine
    if (transformation.type === 'set') {
      return { ...data, [transformation.field]: transformation.value };
    }
    if (transformation.type === 'multiply') {
      return { ...data, [transformation.field]: data[transformation.field] * transformation.value };
    }
    return data;
  }

  /**
   * Generate text version from HTML
   */
  private generateTextVersion(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Generate unique email ID
   */
  private generateEmailId(): string {
    return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test email configuration
   */
  async testConfiguration(): Promise<EmailTestResult> {
    try {
      const testEmail = {
        to: [this.configService.get<string>('EMAIL_TEST_TO')],
        subject: 'PropChain Email Test',
        html: '<h1>Email Configuration Test</h1><p>This is a test email from PropChain.</p>',
        text: 'Email Configuration Test\n\nThis is a test email from PropChain.',
      };

      const result = await this.sendEmail(testEmail);

      return {
        success: result.status === 'sent',
        provider: result.provider,
        messageId: result.messageId,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        provider: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Type definitions
interface EmailData {
  to: string[];
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: any[];
  priority?: 'low' | 'normal' | 'high';
  headers?: Record<string, string>;
}

interface EmailOptions {
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: any[];
  priority?: 'low' | 'normal' | 'high';
  headers?: Record<string, string>;
  locale?: string;
  abTestVariant?: 'A' | 'B' | 'control';
}

interface EmailMetadata {
  templateName?: string;
  templateData?: any;
  locale?: string;
  abTestVariant?: 'A' | 'B' | 'control';
  campaignId?: string;
  userId?: string;
}

interface EmailSendResult {
  emailId: string;
  provider: string;
  messageId?: string;
  status: 'sent' | 'failed' | 'queued';
  error?: string;
  timestamp: Date;
  metadata?: EmailMetadata;
}

interface BatchEmailData {
  data: EmailData;
  metadata?: EmailMetadata;
}

interface BatchEmailOptions {
  rateLimit?: number; // milliseconds between sends
  maxConcurrency?: number;
}

interface BatchEmailResult {
  batchId: string;
  totalEmails: number;
  successCount: number;
  failureCount: number;
  results: EmailSendResult[];
  totalTime: number;
}

interface PersonalizationRule {
  condition: string;
  transformation: {
    type: 'set' | 'multiply' | 'append';
    field: string;
    value: any;
  };
}

interface EmailProvider {
  name: string;
  send: (emailData: EmailData & { messageId: string }) => Promise<{ messageId: string }>;
  isAvailable: () => Promise<boolean>;
  priority: number;
}

interface EmailTestResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}
