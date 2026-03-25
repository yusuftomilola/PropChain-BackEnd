import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * API Abuse Detection Service
 *
 * Detects and prevents various forms of API abuse
 */
@Injectable()
export class AbuseDetectionService {
  private readonly logger = new Logger(AbuseDetectionService.name);
  private abuseTracker = new Map<string, AbuseTracker>();
  private globalLimits = new Map<string, RateLimit>();

  constructor(private readonly configService: ConfigService) {
    this.initializeGlobalLimits();
    this.startCleanup();
  }

  /**
   * Check request for abuse
   */
  checkAbuse(request: any): AbuseAnalysis {
    const clientIp = this.getClientIp(request);
    const endpoint = request.route?.path || request.url;
    const method = request.method;
    const apiKey = request.headers['x-api-key'];

    const analysis: AbuseAnalysis = {
      clientIp,
      endpoint,
      method,
      apiKey,
      violations: [],
      riskScore: 0,
      shouldBlock: false,
      timestamp: new Date(),
    };

    // Check various abuse types
    this.checkRateLimiting(clientIp, endpoint, analysis);
    this.checkBurstRequests(clientIp, analysis);
    this.checkPayloadSize(request, analysis);
    this.checkEndpointAbuse(clientIp, endpoint, analysis);
    this.checkGlobalLimits(clientIp, analysis);
    this.checkBehavioralPatterns(clientIp, request, analysis);

    // Update tracking
    this.updateAbuseTracker(clientIp, request, analysis);

    return analysis;
  }

  /**
   * Check rate limiting
   */
  private checkRateLimiting(clientIp: string, endpoint: string, analysis: AbuseAnalysis): void {
    const tracker = this.abuseTracker.get(clientIp);
    if (!tracker) {
      return;
    }

    const now = Date.now();
    const windowSize = 60 * 1000; // 1 minute window
    const recentRequests = tracker.requests.filter(time => now - time < windowSize);

    // Get rate limit for endpoint
    const rateLimit = this.getRateLimitForEndpoint(endpoint);
    const limit = rateLimit.requestsPerMinute;

    if (recentRequests.length > limit) {
      analysis.violations.push({
        type: 'RATE_LIMIT_EXCEEDED',
        severity: 'high',
        description: `Rate limit exceeded: ${recentRequests.length}/${limit} requests per minute`,
        count: recentRequests.length,
        limit,
      });
      analysis.riskScore += 40;
    }
  }

  /**
   * Check for burst requests
   */
  private checkBurstRequests(clientIp: string, analysis: AbuseAnalysis): void {
    const tracker = this.abuseTracker.get(clientIp);
    if (!tracker) {
      return;
    }

    const now = Date.now();
    const burstWindow = 10 * 1000; // 10 seconds
    const recentRequests = tracker.requests.filter(time => now - time < burstWindow);

    const maxBurst = this.configService.get<number>('MAX_BURST_REQUESTS', 30);

    if (recentRequests.length > maxBurst) {
      analysis.violations.push({
        type: 'BURST_DETECTED',
        severity: 'medium',
        description: `Burst requests detected: ${recentRequests.length} in 10 seconds`,
        count: recentRequests.length,
        limit: maxBurst,
      });
      analysis.riskScore += 25;
    }
  }

  /**
   * Check payload size
   */
  private checkPayloadSize(request: any, analysis: AbuseAnalysis): void {
    const maxPayloadSize = this.configService.get<number>('MAX_PAYLOAD_SIZE', 10 * 1024 * 1024); // 10MB

    let payloadSize = 0;

    if (request.body) {
      payloadSize = JSON.stringify(request.body).length;
    }

    if (payloadSize > maxPayloadSize) {
      analysis.violations.push({
        type: 'PAYLOAD_TOO_LARGE',
        severity: 'medium',
        description: `Payload too large: ${payloadSize} bytes (max: ${maxPayloadSize})`,
        size: payloadSize,
        limit: maxPayloadSize,
      });
      analysis.riskScore += 20;
    }
  }

  /**
   * Check endpoint-specific abuse
   */
  private checkEndpointAbuse(clientIp: string, endpoint: string, analysis: AbuseAnalysis): void {
    const tracker = this.abuseTracker.get(clientIp);
    if (!tracker) {
      return;
    }

    // Check for abuse on sensitive endpoints
    const sensitiveEndpoints = ['/auth/login', '/auth/register', '/auth/forgot-password', '/api/keys', '/api/users'];

    if (sensitiveEndpoints.some(ep => endpoint.includes(ep))) {
      const now = Date.now();
      const hourWindow = 60 * 60 * 1000; // 1 hour
      const recentRequests = tracker.requests.filter(time => now - time < hourWindow);

      const maxSensitiveRequests = this.configService.get<number>('MAX_SENSITIVE_REQUESTS_PER_HOUR', 100);

      if (recentRequests.length > maxSensitiveRequests) {
        analysis.violations.push({
          type: 'SENSITIVE_ENDPOINT_ABUSE',
          severity: 'high',
          description: `Too many requests to sensitive endpoint: ${endpoint}`,
          count: recentRequests.length,
          limit: maxSensitiveRequests,
        });
        analysis.riskScore += 35;
      }
    }
  }

  /**
   * Check global limits
   */
  private checkGlobalLimits(clientIp: string, analysis: AbuseAnalysis): void {
    const tracker = this.abuseTracker.get(clientIp);
    if (!tracker) {
      return;
    }

    const now = Date.now();
    const dayWindow = 24 * 60 * 60 * 1000; // 24 hours
    const dailyRequests = tracker.requests.filter(time => now - time < dayWindow);

    const maxDailyRequests = this.configService.get<number>('MAX_DAILY_REQUESTS', 10000);

    if (dailyRequests.length > maxDailyRequests) {
      analysis.violations.push({
        type: 'DAILY_LIMIT_EXCEEDED',
        severity: 'critical',
        description: `Daily limit exceeded: ${dailyRequests.length} requests`,
        count: dailyRequests.length,
        limit: maxDailyRequests,
      });
      analysis.riskScore += 60;
      analysis.shouldBlock = true;
    }
  }

  /**
   * Check behavioral patterns
   */
  private checkBehavioralPatterns(clientIp: string, request: any, analysis: AbuseAnalysis): void {
    const tracker = this.abuseTracker.get(clientIp);
    if (!tracker || tracker.requests.length < 20) {
      return;
    }

    // Check for automated behavior patterns
    const intervals = this.calculateRequestIntervals(tracker.requests);
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = this.calculateVariance(intervals, avgInterval);

    // Very consistent intervals suggest automation
    if (variance < 100) {
      // Low variance
      analysis.violations.push({
        type: 'AUTOMATED_BEHAVIOR',
        severity: 'medium',
        description: 'Automated behavior detected (too consistent request intervals)',
        variance,
        avgInterval,
      });
      analysis.riskScore += 15;
    }

    // Check for endpoint scanning behavior
    const uniqueEndpoints = new Set(tracker.endpoints);
    const endpointVariety = uniqueEndpoints.size / tracker.requests.length;

    if (endpointVariety > 0.8 && tracker.requests.length > 50) {
      analysis.violations.push({
        type: 'SCANNING_BEHAVIOR',
        severity: 'high',
        description: 'Endpoint scanning behavior detected',
        uniqueEndpoints: uniqueEndpoints.size,
        totalRequests: tracker.requests.length,
      });
      analysis.riskScore += 30;
    }
  }

  /**
   * Update abuse tracker
   */
  private updateAbuseTracker(clientIp: string, request: any, analysis: AbuseAnalysis): void {
    const now = Date.now();

    if (!this.abuseTracker.has(clientIp)) {
      this.abuseTracker.set(clientIp, {
        ip: clientIp,
        requests: [now],
        endpoints: [request.url],
        userAgents: [request.headers['user-agent'] || ''],
        violations: [],
        firstSeen: now,
        lastSeen: now,
      });
    } else {
      const tracker = this.abuseTracker.get(clientIp);
      if (!tracker) {
        // This should not happen in the else branch, but handle defensively
        return;
      }
      tracker.requests.push(now);
      tracker.endpoints.push(request.url);
      tracker.userAgents.push(request.headers['user-agent'] || '');
      tracker.lastSeen = now;

      // Keep only last 1000 requests
      if (tracker.requests.length > 1000) {
        tracker.requests = tracker.requests.slice(-1000);
      }

      // Add violations
      tracker.violations.push(...analysis.violations);
    }
  }

  /**
   * Get rate limit for specific endpoint
   */
  private getRateLimitForEndpoint(endpoint: string): RateLimit {
    // Check for specific endpoint limits
    for (const [pattern, limit] of this.globalLimits.entries()) {
      if (endpoint.includes(pattern)) {
        return limit;
      }
    }

    // Default rate limit
    return {
      requestsPerMinute: this.configService.get<number>('DEFAULT_RATE_LIMIT_PER_MINUTE', 100),
      requestsPerHour: this.configService.get<number>('DEFAULT_RATE_LIMIT_PER_HOUR', 1000),
    };
  }

  /**
   * Calculate request intervals
   */
  private calculateRequestIntervals(requests: number[]): number[] {
    const intervals: number[] = [];

    for (let i = 1; i < requests.length; i++) {
      intervals.push(requests[i] - requests[i - 1]);
    }

    return intervals;
  }

  /**
   * Calculate variance
   */
  private calculateVariance(values: number[], mean: number): number {
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Get client IP
   */
  private getClientIp(request: any): string {
    return (
      request.ip ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      '0.0.0.0'
    );
  }

  /**
   * Get abuse statistics
   */
  getAbuseStatistics(): AbuseStatistics {
    const now = Date.now();
    const recentTrackers = Array.from(this.abuseTracker.values()).filter(tracker => now - tracker.lastSeen < 3600000); // Last hour

    const totalRequests = recentTrackers.reduce((sum, tracker) => sum + tracker.requests.length, 0);
    const totalViolations = recentTrackers.reduce((sum, tracker) => sum + tracker.violations.length, 0);
    const uniqueIps = recentTrackers.length;

    return {
      totalRequests,
      totalViolations,
      uniqueIps,
      averageRequestsPerIp: uniqueIps > 0 ? totalRequests / uniqueIps : 0,
      violationRate: totalRequests > 0 ? totalViolations / totalRequests : 0,
      timestamp: new Date(),
    };
  }

  /**
   * Block IP address
   */
  blockIp(clientIp: string, reason: string, duration?: number): void {
    const tracker = this.abuseTracker.get(clientIp);
    if (tracker) {
      tracker.blocked = true;
      tracker.blockReason = reason;
      tracker.blockedAt = Date.now();

      if (duration) {
        tracker.blockUntil = Date.now() + duration;
      }

      this.logger.warn(`IP ${clientIp} blocked: ${reason}`);
    }
  }

  /**
   * Unblock IP address
   */
  unblockIp(clientIp: string): void {
    const tracker = this.abuseTracker.get(clientIp);
    if (tracker) {
      delete tracker.blocked;
      delete tracker.blockReason;
      delete tracker.blockedAt;
      delete tracker.blockUntil;

      this.logger.log(`IP ${clientIp} unblocked`);
    }
  }

  /**
   * Initialize global rate limits
   */
  private initializeGlobalLimits(): void {
    // Set default rate limits for different endpoint types
    this.globalLimits.set('/auth', {
      requestsPerMinute: 10,
      requestsPerHour: 100,
    });

    this.globalLimits.set('/api/keys', {
      requestsPerMinute: 5,
      requestsPerHour: 50,
    });

    this.globalLimits.set('/api/users', {
      requestsPerMinute: 20,
      requestsPerHour: 200,
    });
  }

  /**
   * Start cleanup process
   */
  private startCleanup(): void {
    setInterval(
      () => {
        const now = Date.now();
        const cutoff = now - 24 * 60 * 60 * 1000; // 24 hours ago

        for (const [ip, tracker] of this.abuseTracker.entries()) {
          // Remove old trackers
          if (tracker.lastSeen < cutoff) {
            this.abuseTracker.delete(ip);
            continue;
          }

          // Unblock expired blocks
          if (tracker.blocked && tracker.blockUntil && now > tracker.blockUntil) {
            delete tracker.blocked;
            delete tracker.blockReason;
            delete tracker.blockedAt;
            delete tracker.blockUntil;
          }

          // Keep only last 1000 requests
          if (tracker.requests.length > 1000) {
            tracker.requests = tracker.requests.slice(-1000);
          }
        }
      },
      60 * 60 * 1000,
    ); // Every hour
  }
}

// Type definitions
interface AbuseTracker {
  ip: string;
  requests: number[];
  endpoints: string[];
  userAgents: string[];
  violations: AbuseViolation[];
  firstSeen: number;
  lastSeen: number;
  blocked?: boolean;
  blockReason?: string;
  blockedAt?: number;
  blockUntil?: number;
}

interface AbuseViolation {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  count?: number;
  limit?: number;
  size?: number;
  variance?: number;
  avgInterval?: number;
  uniqueEndpoints?: number;
  totalRequests?: number;
}

interface AbuseAnalysis {
  clientIp: string;
  endpoint: string;
  method: string;
  apiKey?: string;
  violations: AbuseViolation[];
  riskScore: number;
  shouldBlock: boolean;
  timestamp: Date;
}

interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
}

interface AbuseStatistics {
  totalRequests: number;
  totalViolations: number;
  uniqueIps: number;
  averageRequestsPerIp: number;
  violationRate: number;
  timestamp: Date;
}
