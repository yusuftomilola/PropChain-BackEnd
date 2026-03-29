import { Injectable, Logger } from '@nestjs/common';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type ApiKeyTier = 'free' | 'basic' | 'premium' | 'enterprise';

export interface RequestEvent {
  ip: string;
  userId?: string;
  apiKey?: string;
  endpoint: string;
  method: string;
  timestamp: number;
  responseTimeMs?: number;
  statusCode?: number;
  country?: string;
}

export interface ThreatProfile {
  ip: string;
  userId?: string;
  trustScore: number; // 0 (untrusted) – 100 (fully trusted)
  threatLevel: ThreatLevel;
  requestsLastMinute: number;
  failureRate: number;
  anomalyScore: number;
  blockedUntil?: number;
  flags: string[];
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  threatLevel: ThreatLevel;
  retryAfterMs?: number;
  reason?: string;
}

export interface GeoRateLimit {
  country: string;
  requestsPerMinute: number;
  blocked: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_LIMITS: Record<ApiKeyTier, number> = {
  free: 60,
  basic: 300,
  premium: 1000,
  enterprise: 5000,
};

const THREAT_MULTIPLIERS: Record<ThreatLevel, number> = {
  none: 1.0,
  low: 0.75,
  medium: 0.5,
  high: 0.25,
  critical: 0,
};

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * AdaptiveRateLimiterService
 *
 * Extends basic rate limiting with behavioural anomaly detection,
 * per-client trust scores, API key tier management, geographic
 * rate limiting, and real-time threat intelligence.
 */
@Injectable()
export class AdaptiveRateLimiterService {
  private readonly logger = new Logger(AdaptiveRateLimiterService.name);

  /** Rolling 1-minute request windows per IP */
  private readonly requestWindows = new Map<string, number[]>();
  /** Threat profiles per IP */
  private readonly threatProfiles = new Map<string, ThreatProfile>();
  /** Geographic rate limit overrides */
  private readonly geoLimits = new Map<string, GeoRateLimit>();
  /** API key → tier mapping */
  private readonly apiKeyTiers = new Map<string, ApiKeyTier>();

  private readonly WINDOW_MS = 60_000;
  private readonly ANOMALY_BURST_THRESHOLD = 3; // × baseline → anomaly

  // ── Main decision ─────────────────────────────────────────────────────────

  /**
   * Evaluate a request and return an allow/deny decision with adaptive limits.
   */
  evaluate(event: RequestEvent): RateLimitDecision {
    const key = this.buildKey(event);
    this.recordRequest(key, event);

    const profile = this.getOrCreateProfile(event.ip, event.userId);
    this.updateBehaviourProfile(profile, event);

    // Check hard block
    if (profile.blockedUntil && Date.now() < profile.blockedUntil) {
      return {
        allowed: false,
        limit: 0,
        remaining: 0,
        resetAtMs: profile.blockedUntil,
        threatLevel: profile.threatLevel,
        retryAfterMs: profile.blockedUntil - Date.now(),
        reason: 'IP temporarily blocked due to threat activity',
      };
    }

    // Geographic check
    if (event.country) {
      const geoLimit = this.geoLimits.get(event.country.toUpperCase());
      if (geoLimit?.blocked) {
        return {
          allowed: false,
          limit: 0,
          remaining: 0,
          resetAtMs: Date.now() + this.WINDOW_MS,
          threatLevel: 'critical',
          reason: `Requests from ${event.country} are currently blocked`,
        };
      }
    }

    // Determine effective limit
    const tier = event.apiKey ? (this.apiKeyTiers.get(event.apiKey) ?? 'free') : 'free';
    const baseLimit = TIER_LIMITS[tier];
    const multiplier = THREAT_MULTIPLIERS[profile.threatLevel];
    const effectiveLimit = Math.floor(baseLimit * multiplier);

    const windowRequests = this.countWindowRequests(key);
    const remaining = Math.max(0, effectiveLimit - windowRequests);
    const resetAtMs = Date.now() + this.WINDOW_MS;

    const allowed = effectiveLimit > 0 && windowRequests <= effectiveLimit;

    if (!allowed) {
      this.logger.warn(
        `Rate limit exceeded for ${key} (tier=${tier}, threat=${profile.threatLevel}, reqs=${windowRequests}/${effectiveLimit})`,
      );
    }

    return {
      allowed,
      limit: effectiveLimit,
      remaining,
      resetAtMs,
      threatLevel: profile.threatLevel,
      retryAfterMs: allowed ? undefined : this.WINDOW_MS,
    };
  }

  // ── Threat / behaviour analysis ───────────────────────────────────────────

  /**
   * Update the behavioural threat profile for an IP based on request patterns.
   */
  private updateBehaviourProfile(profile: ThreatProfile, event: RequestEvent): void {
    const key = profile.ip;
    const now = Date.now();
    const windowRequests = this.countWindowRequests(key);

    profile.requestsLastMinute = windowRequests;

    // Anomaly: sudden burst beyond expected baseline
    const tier = event.apiKey ? (this.apiKeyTiers.get(event.apiKey) ?? 'free') : 'free';
    const baseline = TIER_LIMITS[tier] / 10; // expected per-10s average
    if (windowRequests > baseline * this.ANOMALY_BURST_THRESHOLD) {
      profile.anomalyScore = Math.min(100, profile.anomalyScore + 10);
      if (!profile.flags.includes('burst')) profile.flags.push('burst');
    }

    // Failure rate analysis
    if (event.statusCode && event.statusCode >= 400) {
      profile.failureRate = Math.min(1, profile.failureRate + 0.05);
      if (profile.failureRate > 0.5 && !profile.flags.includes('high_failure')) {
        profile.flags.push('high_failure');
      }
    } else {
      profile.failureRate = Math.max(0, profile.failureRate - 0.01);
    }

    // Derive threat level from anomaly score
    profile.threatLevel = this.scoreToThreatLevel(profile.anomalyScore, profile.failureRate);

    // Auto-block critical threats for 15 minutes
    if (profile.threatLevel === 'critical' && !profile.blockedUntil) {
      profile.blockedUntil = now + 15 * 60_000;
      this.logger.error(`Auto-blocked ${profile.ip} — critical threat detected`);
    }

    // Trust score decays with anomaly activity
    profile.trustScore = Math.max(0, 100 - profile.anomalyScore);

    this.threatProfiles.set(key, profile);
  }

  private scoreToThreatLevel(anomalyScore: number, failureRate: number): ThreatLevel {
    const combined = anomalyScore * 0.7 + failureRate * 100 * 0.3;
    if (combined >= 90) return 'critical';
    if (combined >= 70) return 'high';
    if (combined >= 40) return 'medium';
    if (combined >= 20) return 'low';
    return 'none';
  }

  // ── API key tiers ─────────────────────────────────────────────────────────

  /**
   * Register or update the tier for an API key.
   */
  setApiKeyTier(apiKey: string, tier: ApiKeyTier): void {
    this.apiKeyTiers.set(apiKey, tier);
    this.logger.log(`API key tier set: ${apiKey.slice(0, 8)}… → ${tier}`);
  }

  // ── Geographic controls ───────────────────────────────────────────────────

  /**
   * Configure a per-country rate limit or block.
   */
  setGeoLimit(country: string, requestsPerMinute: number, blocked = false): void {
    this.geoLimits.set(country.toUpperCase(), { country, requestsPerMinute, blocked });
  }

  /**
   * Remove a geographic restriction.
   */
  removeGeoLimit(country: string): void {
    this.geoLimits.delete(country.toUpperCase());
  }

  // ── Manual moderation ─────────────────────────────────────────────────────

  /**
   * Manually block an IP for a given duration.
   */
  blockIp(ip: string, durationMs: number): void {
    const profile = this.getOrCreateProfile(ip);
    profile.blockedUntil = Date.now() + durationMs;
    profile.flags.push('manually_blocked');
    this.threatProfiles.set(ip, profile);
    this.logger.warn(`Manually blocked ${ip} for ${durationMs}ms`);
  }

  /**
   * Clear a manual block and reset anomaly score for an IP.
   */
  unblockIp(ip: string): void {
    const profile = this.threatProfiles.get(ip);
    if (profile) {
      profile.blockedUntil = undefined;
      profile.anomalyScore = 0;
      profile.threatLevel = 'none';
      profile.flags = profile.flags.filter((f) => f !== 'manually_blocked');
      this.threatProfiles.set(ip, profile);
    }
  }

  /**
   * Get the current threat profile for an IP.
   */
  getThreatProfile(ip: string): ThreatProfile | undefined {
    return this.threatProfiles.get(ip);
  }

  /**
   * List all IPs currently flagged at or above a given threat level.
   */
  getThreats(minLevel: ThreatLevel = 'medium'): ThreatProfile[] {
    const order: ThreatLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
    const minIdx = order.indexOf(minLevel);
    return Array.from(this.threatProfiles.values()).filter(
      (p) => order.indexOf(p.threatLevel) >= minIdx,
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildKey(event: RequestEvent): string {
    return event.userId ?? event.apiKey ?? event.ip;
  }

  private recordRequest(key: string, _event: RequestEvent): void {
    const now = Date.now();
    const window = this.requestWindows.get(key) ?? [];
    window.push(now);
    // Prune entries outside the rolling window
    const cutoff = now - this.WINDOW_MS;
    const trimmed = window.filter((t) => t > cutoff);
    this.requestWindows.set(key, trimmed);
  }

  private countWindowRequests(key: string): number {
    const now = Date.now();
    const cutoff = now - this.WINDOW_MS;
    return (this.requestWindows.get(key) ?? []).filter((t) => t > cutoff).length;
  }

  private getOrCreateProfile(ip: string, userId?: string): ThreatProfile {
    if (!this.threatProfiles.has(ip)) {
      this.threatProfiles.set(ip, {
        ip,
        userId,
        trustScore: 100,
        threatLevel: 'none',
        requestsLastMinute: 0,
        failureRate: 0,
        anomalyScore: 0,
        flags: [],
      });
    }
    return this.threatProfiles.get(ip)!;
  }
}
