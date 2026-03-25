import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Email Deliverability Service
 *
 * Optimizes email deliverability and manages sender reputation
 */
@Injectable()
export class DeliverabilityService {
  private readonly logger = new Logger(DeliverabilityService.name);
  private senderReputation: Map<string, SenderReputation> = new Map();
  private deliverabilityMetrics: Map<string, DeliverabilityMetrics> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.initializeSenderReputation();
  }

  /**
   * Analyze email deliverability
   */
  async analyzeDeliverability(emailData: EmailDeliverabilityData): Promise<DeliverabilityAnalysis> {
    const analysis: DeliverabilityAnalysis = {
      emailId: emailData.emailId,
      sender: emailData.sender,
      recipients: emailData.recipients,
      score: 0,
      issues: [],
      recommendations: [],
      timestamp: new Date(),
    };

    // Check sender reputation
    const senderRep = this.getSenderReputation(emailData.sender);
    analysis.score += senderRep.score * 0.3;

    if (senderRep.score < 50) {
      analysis.issues.push({
        type: 'sender_reputation',
        severity: 'high',
        message: `Low sender reputation score: ${senderRep.score}`,
        recommendation: 'Improve sender reputation by reducing complaints and bounces',
      });
    }

    // Check content quality
    const contentAnalysis = this.analyzeContent(emailData);
    analysis.score += contentAnalysis.score * 0.2;
    analysis.issues.push(...contentAnalysis.issues);

    // Check recipient list quality
    const recipientAnalysis = this.analyzeRecipients(emailData.recipients);
    analysis.score += recipientAnalysis.score * 0.2;
    analysis.issues.push(...recipientAnalysis.issues);

    // Check technical setup
    const technicalAnalysis = this.analyzeTechnicalSetup(emailData);
    analysis.score += technicalAnalysis.score * 0.3;
    analysis.issues.push(...technicalAnalysis.issues);

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis.issues);

    // Normalize score to 0-100
    analysis.score = Math.max(0, Math.min(100, analysis.score));

    this.logger.log(`Email deliverability analysis completed`, {
      emailId: emailData.emailId,
      score: analysis.score,
      issuesCount: analysis.issues.length,
    });

    return analysis;
  }

  /**
   * Optimize email for better deliverability
   */
  async optimizeEmail(emailData: EmailOptimizationData): Promise<EmailOptimizationResult> {
    const optimizations: EmailOptimization[] = [];

    // Optimize subject line
    const subjectOptimization = this.optimizeSubject(emailData.subject);
    if (subjectOptimization.recommendations.length > 0) {
      optimizations.push(subjectOptimization);
    }

    // Optimize content
    const contentOptimization = this.optimizeContent(emailData.content);
    if (contentOptimization.recommendations.length > 0) {
      optimizations.push(contentOptimization);
    }

    // Optimize sending parameters
    const sendingOptimization = this.optimizeSendingParameters(emailData);
    if (sendingOptimization.recommendations.length > 0) {
      optimizations.push(sendingOptimization);
    }

    // Apply optimizations if auto-apply is enabled
    let optimizedData = { ...emailData };

    if (emailData.autoApply) {
      if (subjectOptimization.optimizedSubject) {
        optimizedData.subject = subjectOptimization.optimizedSubject;
      }

      if (contentOptimization.optimizedContent) {
        optimizedData.content = contentOptimization.optimizedContent;
      }

      if (sendingOptimization.optimizedParameters) {
        optimizedData = { ...optimizedData, ...sendingOptimization.optimizedParameters };
      }
    }

    const result: EmailOptimizationResult = {
      originalData: emailData,
      optimizedData,
      optimizations,
      overallScore: this.calculateOptimizationScore(optimizations),
      timestamp: new Date(),
    };

    this.logger.log(`Email optimization completed`, {
      emailId: emailData.emailId,
      optimizationsCount: optimizations.length,
      overallScore: result.overallScore,
    });

    return result;
  }

  /**
   * Warm up IP address
   */
  async warmupIP(ipAddress: string, plan: WarmupPlan): Promise<WarmupResult> {
    this.logger.log(`Starting IP warmup for ${ipAddress}`, {
      plan: plan.name,
      duration: plan.durationDays,
    });

    const results: WarmupDayResult[] = [];
    let totalSent = 0;
    let reputationChange = 0;

    for (let day = 1; day <= plan.durationDays; day++) {
      const dayResult = await this.executeWarmupDay(ipAddress, day, plan);
      results.push(dayResult);

      totalSent += dayResult.sent;
      reputationChange += dayResult.reputationChange;

      // Check if we should stop due to poor performance
      if (dayResult.deliverabilityRate < 0.7) {
        this.logger.warn(`Stopping warmup due to poor deliverability: ${dayResult.deliverabilityRate}`);
        break;
      }

      // Wait until next day
      await this.delay(24 * 60 * 60 * 1000); // 24 hours
    }

    const finalReputation = this.getSenderReputation(ipAddress);
    finalReputation.score += reputationChange;

    // Update sender reputation
    this.updateSenderReputation(ipAddress, finalReputation);

    const result: WarmupResult = {
      ipAddress,
      plan: plan.name,
      durationDays: plan.durationDays,
      totalSent,
      finalReputation: finalReputation.score,
      deliverabilityRate: totalSent > 0 ? results.reduce((sum, r) => sum + r.delivered, 0) / totalSent : 0,
      dailyResults: results,
      success: finalReputation.score >= 70,
      timestamp: new Date(),
    };

    this.logger.log(`IP warmup completed`, {
      ipAddress,
      finalScore: finalReputation.score,
      deliverabilityRate: result.deliverabilityRate,
      success: result.success,
    });

    return result;
  }

  /**
   * Monitor sender reputation
   */
  async monitorSenderReputation(sender: string): Promise<ReputationMonitorResult> {
    const reputation = this.getSenderReputation(sender);
    const metrics = this.getDeliverabilityMetrics(sender);

    const alerts: ReputationAlert[] = [];

    // Check for reputation drops
    if (reputation.score < 70) {
      alerts.push({
        type: 'low_reputation',
        severity: 'high',
        message: `Sender reputation dropped to ${reputation.score}`,
        recommendation: 'Review recent sending practices and reduce complaint rates',
      });
    }

    // Check for high bounce rates
    if (metrics.bounceRate > 5) {
      alerts.push({
        type: 'high_bounce_rate',
        severity: 'medium',
        message: `High bounce rate: ${metrics.bounceRate}%`,
        recommendation: 'Clean email lists and verify recipient addresses',
      });
    }

    // Check for high complaint rates
    if (metrics.complaintRate > 0.1) {
      alerts.push({
        type: 'high_complaint_rate',
        severity: 'critical',
        message: `High complaint rate: ${metrics.complaintRate}%`,
        recommendation: 'Immediately review sending practices and consent compliance',
      });
    }

    // Check for low engagement
    if (metrics.openRate < 15) {
      alerts.push({
        type: 'low_engagement',
        severity: 'medium',
        message: `Low open rate: ${metrics.openRate}%`,
        recommendation: 'Improve subject lines and content relevance',
      });
    }

    const result: ReputationMonitorResult = {
      sender,
      reputation,
      metrics,
      alerts,
      healthScore: this.calculateReputationHealthScore(reputation, metrics),
      timestamp: new Date(),
    };

    this.logger.log(`Reputation monitoring completed`, {
      sender,
      healthScore: result.healthScore,
      alertsCount: alerts.length,
    });

    return result;
  }

  /**
   * Get deliverability recommendations
   */
  async getDeliverabilityRecommendations(sender: string): Promise<DeliverabilityRecommendation[]> {
    const reputation = this.getSenderReputation(sender);
    const metrics = this.getDeliverabilityMetrics(sender);

    const recommendations: DeliverabilityRecommendation[] = [];

    // Authentication recommendations
    if (!reputation.spfConfigured) {
      recommendations.push({
        category: 'authentication',
        priority: 'high',
        title: 'Configure SPF Records',
        description: 'Set up Sender Policy Framework (SPF) records to verify your sending domains',
        impact: 'High - Improves deliverability and prevents spoofing',
        effort: 'Medium',
      });
    }

    if (!reputation.dkimConfigured) {
      recommendations.push({
        category: 'authentication',
        priority: 'high',
        title: 'Configure DKIM Signing',
        description: 'Implement DomainKeys Identified Mail (DKIM) to sign your emails',
        impact: 'High - Ensures message integrity and prevents tampering',
        effort: 'Medium',
      });
    }

    if (!reputation.dmarcConfigured) {
      recommendations.push({
        category: 'authentication',
        priority: 'high',
        title: 'Configure DMARC Policy',
        description: 'Set up Domain-based Message Authentication, Reporting, and Conformance (DMARC)',
        impact: 'High - Provides visibility into authentication failures',
        effort: 'Low',
      });
    }

    // Content recommendations
    if (metrics.spamScore > 3) {
      recommendations.push({
        category: 'content',
        priority: 'medium',
        title: 'Reduce Spam Triggers',
        description: 'Avoid words and phrases that commonly trigger spam filters',
        impact: 'Medium - Directly affects inbox placement',
        effort: 'Low',
      });
    }

    // List hygiene recommendations
    if (metrics.bounceRate > 2) {
      recommendations.push({
        category: 'list_hygiene',
        priority: 'high',
        title: 'Improve List Hygiene',
        description: 'Regularly clean and validate your email lists',
        impact: 'High - Reduces bounces and improves sender reputation',
        effort: 'Medium',
      });
    }

    // Engagement recommendations
    if (metrics.openRate < 20) {
      recommendations.push({
        category: 'engagement',
        priority: 'medium',
        title: 'Improve Subject Lines',
        description: 'Test different subject lines to improve open rates',
        impact: 'Medium - Directly impacts campaign performance',
        effort: 'Low',
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
    });
  }

  /**
   * Analyze email content
   */
  private analyzeContent(emailData: EmailDeliverabilityData): ContentAnalysis {
    const issues: ContentIssue[] = [];
    let score = 100;

    // Check for spam triggers
    const spamTriggers = [
      'free',
      'winner',
      'cash',
      'bonus',
      'click here',
      'congratulations',
      'limited time',
      'act now',
      'urgent',
      'special promotion',
    ];

    const content = `${emailData.subject} ${emailData.content}`.toLowerCase();

    for (const trigger of spamTriggers) {
      if (content.includes(trigger)) {
        issues.push({
          type: 'spam_trigger',
          severity: 'medium',
          message: `Contains potential spam trigger: "${trigger}"`,
        });
        score -= 10;
      }
    }

    // Check subject line length
    if (emailData.subject.length > 60) {
      issues.push({
        type: 'long_subject',
        severity: 'low',
        message: 'Subject line is too long for optimal display',
      });
      score -= 5;
    }

    // Check content-to-image ratio
    const textLength = emailData.content.replace(/<[^>]*>/g, '').length;
    const totalLength = emailData.content.length;
    const imageRatio = (totalLength - textLength) / totalLength;

    if (imageRatio > 0.7) {
      issues.push({
        type: 'image_heavy',
        severity: 'medium',
        message: 'High image-to-text ratio may trigger spam filters',
      });
      score -= 15;
    }

    // Check for personalization
    if (!emailData.content.includes('{{') && !emailData.content.includes('{{firstName}}')) {
      issues.push({
        type: 'no_personalization',
        severity: 'low',
        message: 'Consider adding personalization to improve engagement',
      });
      score -= 5;
    }

    return {
      score: Math.max(0, score),
      issues,
    };
  }

  /**
   * Analyze recipients
   */
  private analyzeRecipients(recipients: string[]): RecipientAnalysis {
    const issues: RecipientIssue[] = [];
    let score = 100;

    // Check for role-based addresses
    const roleAddresses = recipients.filter(
      email =>
        email.startsWith('info@') ||
        email.startsWith('sales@') ||
        email.startsWith('marketing@') ||
        email.startsWith('noreply@'),
    );

    if (roleAddresses.length > recipients.length * 0.5) {
      issues.push({
        type: 'many_role_addresses',
        severity: 'medium',
        message: 'High proportion of role-based email addresses',
      });
      score -= 10;
    }

    // Check for suspicious domains
    const suspiciousDomains = recipients.filter(email => {
      const domain = email.split('@')[1];
      return this.isSuspiciousDomain(domain);
    });

    if (suspiciousDomains.length > 0) {
      issues.push({
        type: 'suspicious_domains',
        severity: 'high',
        message: `Contains suspicious domains: ${suspiciousDomains.join(', ')}`,
      });
      score -= 20;
    }

    return {
      score: Math.max(0, score),
      issues,
    };
  }

  /**
   * Analyze technical setup
   */
  private analyzeTechnicalSetup(emailData: EmailDeliverabilityData): TechnicalAnalysis {
    const issues: TechnicalIssue[] = [];
    let score = 100;

    // Check sending frequency
    if (emailData.sendRate > 100) {
      // More than 100 emails per hour
      issues.push({
        type: 'high_frequency',
        severity: 'high',
        message: 'High sending frequency may trigger rate limiting',
      });
      score -= 25;
    }

    // Check reply-to address
    if (!emailData.replyTo) {
      issues.push({
        type: 'no_reply_to',
        severity: 'low',
        message: 'Missing reply-to address',
      });
      score -= 5;
    }

    // Check unsubscribe link
    if (!emailData.unsubscribeUrl) {
      issues.push({
        type: 'no_unsubscribe',
        severity: 'high',
        message: 'Missing unsubscribe link is illegal in many jurisdictions',
      });
      score -= 30;
    }

    return {
      score: Math.max(0, score),
      issues,
    };
  }

  /**
   * Optimize subject line
   */
  private optimizeSubject(subject: string): EmailOptimization {
    const recommendations: string[] = [];
    let optimizedSubject = subject;

    // Check length
    if (subject.length > 50) {
      recommendations.push('Consider shortening subject line to under 50 characters');
    }

    // Check for personalization
    if (!subject.includes('{{') && !subject.includes('{{firstName}}')) {
      recommendations.push('Add recipient personalization to improve open rates');
    }

    // Check for spam triggers
    const spamWords = ['free', 'winner', 'urgent'];
    const lowerSubject = subject.toLowerCase();

    for (const word of spamWords) {
      if (lowerSubject.includes(word)) {
        recommendations.push(`Remove or modify spam trigger word: "${word}"`);
      }
    }

    // Apply optimizations
    if (recommendations.length > 0 && subject.length > 50) {
      optimizedSubject = `${subject.substring(0, 47)}...`;
    }

    return {
      type: 'subject',
      original: subject,
      optimizedSubject,
      recommendations,
    };
  }

  /**
   * Optimize content
   */
  private optimizeContent(content: string): EmailOptimization {
    const recommendations: string[] = [];
    const optimizedContent = content;

    // Check image-to-text ratio
    const textLength = content.replace(/<[^>]*>/g, '').length;
    const totalLength = content.length;
    const imageRatio = (totalLength - textLength) / totalLength;

    if (imageRatio > 0.6) {
      recommendations.push('Reduce image-to-text ratio to avoid spam filters');
    }

    // Check for alt text
    if (!content.includes('alt=')) {
      recommendations.push('Add alt text to images for accessibility');
    }

    return {
      type: 'content',
      original: content,
      optimizedContent,
      recommendations,
    };
  }

  /**
   * Optimize sending parameters
   */
  private optimizeSendingParameters(emailData: EmailOptimizationData): EmailOptimization {
    const recommendations: string[] = [];
    const optimizedParameters: any = {};

    // Optimize send time
    if (!emailData.sendTime || emailData.sendTime.getHours() < 9 || emailData.sendTime.getHours() > 17) {
      recommendations.push('Schedule emails for business hours (9 AM - 5 PM)');
      optimizedParameters.sendTime = this.getNextBusinessHour(emailData.sendTime);
    }

    // Optimize throttle rate
    if (emailData.throttleRate > 50) {
      recommendations.push('Reduce throttle rate to avoid overwhelming recipients');
      optimizedParameters.throttleRate = 30;
    }

    return {
      type: 'sending',
      original: '',
      optimizedContent: '',
      recommendations,
      optimizedParameters,
    };
  }

  /**
   * Calculate optimization score
   */
  private calculateOptimizationScore(optimizations: EmailOptimization[]): number {
    if (optimizations.length === 0) {
      return 100;
    }

    const totalScore = optimizations.reduce((sum, opt) => {
      return sum + opt.recommendations.length * 10;
    }, 0);

    return Math.max(0, 100 - totalScore);
  }

  /**
   * Execute warmup day
   */
  private async executeWarmupDay(ipAddress: string, day: number, plan: WarmupPlan): Promise<WarmupDayResult> {
    const dailyLimit = plan.dailyVolume[day - 1] || 10;
    const sent = Math.min(dailyLimit, 20); // Max 20 per day for warmup
    const delivered = Math.floor(sent * (0.8 + day * 0.02)); // Gradually improving deliverability
    const reputationChange = day * 2; // Improve reputation each day

    // Simulate sending emails
    await this.delay(sent * 100); // Simulate sending time

    return {
      day,
      sent,
      delivered,
      bounces: sent - delivered,
      deliverabilityRate: delivered / sent,
      reputationChange,
    };
  }

  /**
   * Get sender reputation
   */
  private getSenderReputation(sender: string): SenderReputation {
    return (
      this.senderReputation.get(sender) || {
        score: 75,
        spfConfigured: false,
        dkimConfigured: false,
        dmarcConfigured: false,
        lastUpdated: new Date(),
      }
    );
  }

  /**
   * Update sender reputation
   */
  private updateSenderReputation(sender: string, reputation: SenderReputation): void {
    this.senderReputation.set(sender, reputation);
  }

  /**
   * Get deliverability metrics
   */
  private getDeliverabilityMetrics(sender: string): DeliverabilityMetrics {
    return (
      this.deliverabilityMetrics.get(sender) || {
        totalSent: 1000,
        delivered: 950,
        bounced: 30,
        complained: 5,
        opened: 400,
        clicked: 200,
        spamScore: 2.5,
        bounceRate: 3.0,
        complaintRate: 0.5,
        openRate: 42.1,
        clickRate: 50.0,
        lastUpdated: new Date(),
      }
    );
  }

  /**
   * Calculate reputation health score
   */
  private calculateReputationHealthScore(reputation: SenderReputation, metrics: DeliverabilityMetrics): number {
    let score = reputation.score * 0.4; // 40% weight to reputation score

    // Add deliverability metrics
    score += (100 - metrics.bounceRate) * 0.2; // 20% weight to bounce rate
    score += (100 - metrics.complaintRate * 10) * 0.2; // 20% weight to complaint rate
    score += metrics.openRate * 0.1; // 10% weight to open rate
    score += Math.min(metrics.clickRate, 100) * 0.1; // 10% weight to click rate

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if domain is suspicious
   */
  private isSuspiciousDomain(domain: string): boolean {
    const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf'];
    const suspiciousWords = ['spam', 'scam', 'fake', 'phish'];

    const tld = `.${domain.split('.').pop()}`;
    const domainLower = domain.toLowerCase();

    return suspiciousTlds.includes(tld) || suspiciousWords.some(word => domainLower.includes(word));
  }

  /**
   * Get next business hour
   */
  private getNextBusinessHour(currentTime: Date): Date {
    const next = new Date(currentTime);
    next.setHours(9);
    next.setMinutes(0);
    next.setSeconds(0);

    if (next <= currentTime) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  /**
   * Initialize sender reputation
   */
  private initializeSenderReputation(): void {
    // Initialize with default senders
    const defaultSenders = [
      this.configService.get<string>('DEFAULT_SENDER_EMAIL'),
      'noreply@propchain.com',
      'support@propchain.com',
    ];

    for (const sender of defaultSenders) {
      if (sender && !this.senderReputation.has(sender)) {
        this.senderReputation.set(sender, {
          score: 75,
          spfConfigured: false,
          dkimConfigured: false,
          dmarcConfigured: false,
          lastUpdated: new Date(),
        });
      }
    }
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate recommendations from issues
   */
  private generateRecommendations(issues: DeliverabilityIssue[]): string[] {
    return issues
      .filter(issue => issue.recommendation)
      .map(issue => issue.recommendation as string)
      .filter((rec, index, arr) => arr.indexOf(rec) === index); // Remove duplicates
  }
}

// Type definitions
interface EmailDeliverabilityData {
  emailId: string;
  sender: string;
  recipients: string[];
  subject: string;
  content: string;
  sendRate?: number;
  sendTime?: Date;
  replyTo?: string;
  unsubscribeUrl?: string;
  autoApply?: boolean;
}

interface DeliverabilityAnalysis {
  emailId: string;
  sender: string;
  recipients: string[];
  score: number;
  issues: DeliverabilityIssue[];
  recommendations: string[];
  timestamp: Date;
}

interface DeliverabilityIssue {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  recommendation?: string;
}

interface EmailOptimizationData {
  emailId: string;
  subject: string;
  content: string;
  sendRate?: number;
  sendTime?: Date;
  throttleRate?: number;
  autoApply?: boolean;
}

interface EmailOptimizationResult {
  originalData: EmailOptimizationData;
  optimizedData: EmailOptimizationData;
  optimizations: EmailOptimization[];
  overallScore: number;
  timestamp: Date;
}

interface EmailOptimization {
  type: 'subject' | 'content' | 'sending';
  original: string;
  optimizedSubject?: string;
  optimizedContent?: string;
  recommendations: string[];
  optimizedParameters?: any;
}

interface ContentAnalysis {
  score: number;
  issues: ContentIssue[];
}

interface ContentIssue {
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

interface RecipientAnalysis {
  score: number;
  issues: RecipientIssue[];
}

interface RecipientIssue {
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

interface TechnicalAnalysis {
  score: number;
  issues: TechnicalIssue[];
}

interface TechnicalIssue {
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

interface SenderReputation {
  score: number;
  spfConfigured: boolean;
  dkimConfigured: boolean;
  dmarcConfigured: boolean;
  lastUpdated: Date;
}

interface DeliverabilityMetrics {
  totalSent: number;
  delivered: number;
  bounced: number;
  complained: number;
  opened: number;
  clicked: number;
  spamScore: number;
  bounceRate: number;
  complaintRate: number;
  openRate: number;
  clickRate: number;
  lastUpdated: Date;
}

interface WarmupPlan {
  name: string;
  durationDays: number;
  dailyVolume: number[];
}

interface WarmupResult {
  ipAddress: string;
  plan: string;
  durationDays: number;
  totalSent: number;
  finalReputation: number;
  deliverabilityRate: number;
  dailyResults: WarmupDayResult[];
  success: boolean;
  timestamp: Date;
}

interface WarmupDayResult {
  day: number;
  sent: number;
  delivered: number;
  bounces: number;
  deliverabilityRate: number;
  reputationChange: number;
}

interface ReputationMonitorResult {
  sender: string;
  reputation: SenderReputation;
  metrics: DeliverabilityMetrics;
  alerts: ReputationAlert[];
  healthScore: number;
  timestamp: Date;
}

interface ReputationAlert {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  recommendation: string;
}

interface DeliverabilityRecommendation {
  category: 'authentication' | 'content' | 'list_hygiene' | 'engagement';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  impact: string;
  effort: 'Low' | 'Medium' | 'High';
}
