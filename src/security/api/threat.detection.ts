import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * API Threat Detection Service
 *
 * Detects and prevents various API security threats
 */
@Injectable()
export class ThreatDetectionService {
  private readonly logger = new Logger(ThreatDetectionService.name);
  private requestTracker = new Map<string, RequestTracker>();
  private ipBlacklist = new Set<string>();
  private suspiciousPatterns = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {
    this.loadBlacklist();
    this.startCleanup();
  }

  /**
   * Analyze request for potential threats
   */
  analyzeRequest(request: any): ThreatAnalysis {
    const clientIp = this.getClientIp(request);
    const userAgent = request.headers['user-agent'] || '';
    const endpoint = request.route?.path || request.url;
    const method = request.method;

    const analysis: ThreatAnalysis = {
      clientIp,
      userAgent,
      endpoint,
      method,
      threats: [],
      riskScore: 0,
      shouldBlock: false,
      timestamp: new Date(),
    };

    // Check various threat types
    this.checkRateLimiting(clientIp, analysis);
    this.checkBruteForce(clientIp, endpoint, analysis);
    this.checkSqlInjection(request, analysis);
    this.checkXss(request, analysis);
    this.checkCsrf(request, analysis);
    this.checkSuspiciousPatterns(request, analysis);
    this.checkBlacklistedIp(clientIp, analysis);
    this.checkAnomalousBehavior(clientIp, request, analysis);

    // Update request tracking
    this.updateRequestTracker(clientIp, request);

    return analysis;
  }

  /**
   * Check rate limiting violations
   */
  private checkRateLimiting(clientIp: string, analysis: ThreatAnalysis): void {
    const tracker = this.requestTracker.get(clientIp);
    if (!tracker) {
      return;
    }

    const now = Date.now();
    const recentRequests = tracker.requests.filter(time => now - time < 60000); // Last minute

    const rateLimit = this.configService.get<number>('RATE_LIMIT_PER_MINUTE', 100);
    if (recentRequests.length > rateLimit) {
      analysis.threats.push({
        type: 'RATE_LIMIT_EXCEEDED',
        severity: 'high',
        description: `Rate limit exceeded: ${recentRequests.length} requests in last minute`,
        confidence: 0.9,
      });
      analysis.riskScore += 30;
    }
  }

  /**
   * Check for brute force attacks
   */
  private checkBruteForce(clientIp: string, endpoint: string, analysis: ThreatAnalysis): void {
    const tracker = this.requestTracker.get(clientIp);
    if (!tracker) {
      return;
    }

    // Check for repeated failed attempts on sensitive endpoints
    const sensitiveEndpoints = ['/auth/login', '/auth/register', '/api/keys'];
    if (sensitiveEndpoints.some(ep => endpoint.includes(ep))) {
      const recentFailures = tracker.failedRequests.filter(time => Date.now() - time < 300000); // Last 5 minutes

      if (recentFailures.length > 10) {
        analysis.threats.push({
          type: 'BRUTE_FORCE',
          severity: 'critical',
          description: `Brute force attack detected on ${endpoint}`,
          confidence: 0.85,
        });
        analysis.riskScore += 50;
        analysis.shouldBlock = true;
      }
    }
  }

  /**
   * Check for SQL injection attempts
   */
  private checkSqlInjection(request: any, analysis: ThreatAnalysis): void {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
      /(--|\/\*|\*\/|;|'|")/g,
      /\b(OR|AND)\s+\d+\s*=\s*\d+/gi,
      /\b(OR|AND)\s+['"].*['"]\s*=\s*['"].*['"]/gi,
    ];

    const checkValue = (value: any, path: string): void => {
      if (typeof value === 'string') {
        for (const pattern of sqlPatterns) {
          if (pattern.test(value)) {
            analysis.threats.push({
              type: 'SQL_INJECTION',
              severity: 'critical',
              description: `SQL injection pattern detected in ${path}`,
              confidence: 0.8,
            });
            analysis.riskScore += 40;
            analysis.shouldBlock = true;
            break;
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        for (const key in value) {
          if (value.hasOwnProperty(key)) {
            checkValue(value[key], `${path}.${key}`);
          }
        }
      }
    };

    checkValue(request.body, 'body');
    checkValue(request.query, 'query');
    checkValue(request.params, 'params');
  }

  /**
   * Check for XSS attempts
   */
  private checkXss(request: any, analysis: ThreatAnalysis): void {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe\b/gi,
      /<object\b/gi,
      /<embed\b/gi,
    ];

    const checkValue = (value: any, path: string): void => {
      if (typeof value === 'string') {
        for (const pattern of xssPatterns) {
          if (pattern.test(value)) {
            analysis.threats.push({
              type: 'XSS',
              severity: 'high',
              description: `XSS pattern detected in ${path}`,
              confidence: 0.75,
            });
            analysis.riskScore += 25;
            break;
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        for (const key in value) {
          if (value.hasOwnProperty(key)) {
            checkValue(value[key], `${path}.${key}`);
          }
        }
      }
    };

    checkValue(request.body, 'body');
    checkValue(request.query, 'query');
  }

  /**
   * Check for CSRF attempts
   */
  private checkCsrf(request: any, analysis: ThreatAnalysis): void {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

    if (methods.includes(request.method)) {
      const csrfToken = request.headers['x-csrf-token'] || request.body._csrf;

      if (!csrfToken && !this.isSafeOrigin(request)) {
        analysis.threats.push({
          type: 'CSRF',
          severity: 'medium',
          description: 'Missing CSRF token for state-changing request',
          confidence: 0.6,
        });
        analysis.riskScore += 15;
      }
    }
  }

  /**
   * Check for suspicious patterns
   */
  private checkSuspiciousPatterns(request: any, analysis: ThreatAnalysis): void {
    const suspiciousPatterns = [
      /\.\.\//g, // Path traversal
      /\.\.\\/g, // Path traversal
      /\/etc\/passwd/gi, // System file access
      /\/proc\//gi, // Process information
      /<\?php/gi, // PHP tags
      /<%/gi, // ASP tags
    ];

    const checkValue = (value: any, path: string): void => {
      if (typeof value === 'string') {
        for (const pattern of suspiciousPatterns) {
          if (pattern.test(value)) {
            analysis.threats.push({
              type: 'SUSPICIOUS_PATTERN',
              severity: 'medium',
              description: `Suspicious pattern detected in ${path}`,
              confidence: 0.5,
            });
            analysis.riskScore += 10;
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        for (const key in value) {
          if (value.hasOwnProperty(key)) {
            checkValue(value[key], `${path}.${key}`);
          }
        }
      }
    };

    checkValue(request.url, 'url');
    checkValue(request.body, 'body');
    checkValue(request.query, 'query');
  }

  /**
   * Check if IP is blacklisted
   */
  private checkBlacklistedIp(clientIp: string, analysis: ThreatAnalysis): void {
    if (this.ipBlacklist.has(clientIp)) {
      analysis.threats.push({
        type: 'BLACKLISTED_IP',
        severity: 'critical',
        description: 'Request from blacklisted IP address',
        confidence: 1.0,
      });
      analysis.riskScore += 100;
      analysis.shouldBlock = true;
    }
  }

  /**
   * Check for anomalous behavior
   */
  private checkAnomalousBehavior(clientIp: string, request: any, analysis: ThreatAnalysis): void {
    const tracker = this.requestTracker.get(clientIp);
    if (!tracker || tracker.requests.length < 10) {
      return;
    }

    // Check for unusual request patterns
    const endpoints = new Set(tracker.endpoints);
    const uniqueEndpoints = endpoints.size;
    const totalRequests = tracker.requests.length;

    // High variety of endpoints in short time might indicate scanning
    if (uniqueEndpoints > totalRequests * 0.8 && totalRequests > 20) {
      analysis.threats.push({
        type: 'ANOMALOUS_BEHAVIOR',
        severity: 'medium',
        description: 'Unusual request pattern detected - possible scanning',
        confidence: 0.6,
      });
      analysis.riskScore += 20;
    }

    // Check for unusual user agent changes
    const userAgents = new Set(tracker.userAgents);
    if (userAgents.size > 3) {
      analysis.threats.push({
        type: 'ANOMALOUS_BEHAVIOR',
        severity: 'low',
        description: 'Multiple user agents from same IP',
        confidence: 0.4,
      });
      analysis.riskScore += 10;
    }
  }

  /**
   * Update request tracker
   */
  private updateRequestTracker(clientIp: string, request: any): void {
    const now = Date.now();

    if (!this.requestTracker.has(clientIp)) {
      this.requestTracker.set(clientIp, {
        ip: clientIp,
        requests: [now],
        endpoints: [request.url],
        userAgents: [request.headers['user-agent'] || ''],
        failedRequests: [],
        firstSeen: now,
        lastSeen: now,
      });
    } else {
      const tracker = this.requestTracker.get(clientIp);
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
    }
  }

  /**
   * Record failed request
   */
  recordFailedRequest(clientIp: string, reason: string): void {
    const tracker = this.requestTracker.get(clientIp);
    if (tracker) {
      tracker.failedRequests.push(Date.now());

      // Keep only last 100 failed requests
      if (tracker.failedRequests.length > 100) {
        tracker.failedRequests = tracker.failedRequests.slice(-100);
      }
    }

    this.logger.warn(`Failed request from ${clientIp}: ${reason}`);
  }

  /**
   * Add IP to blacklist
   */
  addToBlacklist(clientIp: string, reason: string, duration?: number): void {
    this.ipBlacklist.add(clientIp);
    this.logger.warn(`IP ${clientIp} blacklisted: ${reason}`);

    if (duration) {
      setTimeout(() => {
        this.ipBlacklist.delete(clientIp);
        this.logger.log(`IP ${clientIp} removed from blacklist`);
      }, duration);
    }
  }

  /**
   * Remove IP from blacklist
   */
  removeFromBlacklist(clientIp: string): void {
    this.ipBlacklist.delete(clientIp);
    this.logger.log(`IP ${clientIp} removed from blacklist`);
  }

  /**
   * Get threat statistics
   */
  getThreatStatistics(): ThreatStatistics {
    const now = Date.now();
    const recentThreats = Array.from(this.requestTracker.values()).filter(tracker => now - tracker.lastSeen < 3600000); // Last hour

    const totalRequests = recentThreats.reduce((sum, tracker) => sum + tracker.requests.length, 0);
    const totalFailed = recentThreats.reduce((sum, tracker) => sum + tracker.failedRequests.length, 0);
    const uniqueIps = recentThreats.length;

    return {
      totalRequests,
      totalFailed,
      uniqueIps,
      blacklistedIps: this.ipBlacklist.size,
      averageRequestsPerIp: uniqueIps > 0 ? totalRequests / uniqueIps : 0,
      failureRate: totalRequests > 0 ? totalFailed / totalRequests : 0,
      timestamp: new Date(),
    };
  }

  /**
   * Get client IP from request
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
   * Check if origin is safe
   */
  private isSafeOrigin(request: any): boolean {
    const origin = request.headers.origin || request.headers.referer;
    const allowedOrigins = this.configService.get<string[]>('CORS_ALLOWED_ORIGINS', []);

    return !origin || allowedOrigins.includes(origin);
  }

  /**
   * Load blacklist from configuration
   */
  private loadBlacklist(): void {
    const blacklistedIps = this.configService.get<string[]>('BLACKLISTED_IPS', []);
    blacklistedIps.forEach(ip => this.ipBlacklist.add(ip));
  }

  /**
   * Start cleanup process
   */
  private startCleanup(): void {
    setInterval(
      () => {
        const now = Date.now();
        const cutoff = now - 24 * 60 * 60 * 1000; // 24 hours ago

        for (const [ip, tracker] of this.requestTracker.entries()) {
          if (tracker.lastSeen < cutoff) {
            this.requestTracker.delete(ip);
          }
        }
      },
      60 * 60 * 1000,
    ); // Every hour
  }
}

// Type definitions
interface RequestTracker {
  ip: string;
  requests: number[];
  endpoints: string[];
  userAgents: string[];
  failedRequests: number[];
  firstSeen: number;
  lastSeen: number;
}

interface ThreatAnalysis {
  clientIp: string;
  userAgent: string;
  endpoint: string;
  method: string;
  threats: Threat[];
  riskScore: number;
  shouldBlock: boolean;
  timestamp: Date;
}

interface Threat {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  confidence: number;
}

interface ThreatStatistics {
  totalRequests: number;
  totalFailed: number;
  uniqueIps: number;
  blacklistedIps: number;
  averageRequestsPerIp: number;
  failureRate: number;
  timestamp: Date;
}
