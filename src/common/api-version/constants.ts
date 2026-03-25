/**
 * API Version Constants
 *
 * Defines all supported API versions and their metadata.
 * Version format: MAJOR.MINOR (e.g., "1.0", "2.0")
 */

export const API_VERSIONS = {
  V1: '1.0',
  V2: '2.0',
} as const;

export const DEFAULT_API_VERSION = API_VERSIONS.V1;

export const SUPPORTED_VERSIONS = Object.values(API_VERSIONS);

/**
 * Version status indicating whether a version is active, deprecated, or sunset
 */
export enum VersionStatus {
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  SUNSET = 'sunset',
}

/**
 * API version metadata
 */
export interface ApiVersionMetadata {
  version: string;
  status: VersionStatus;
  releaseDate: string;
  sunsetDate?: string;
  deprecationDate?: string;
  migrationGuide?: string;
  breakingChanges: string[];
  newFeatures: string[];
  bugFixes: string[];
}

/**
 * Map of version to its metadata
 */
export const VERSION_METADATA: Record<string, ApiVersionMetadata> = {
  '1.0': {
    version: '1.0',
    status: VersionStatus.ACTIVE,
    releaseDate: '2024-01-01',
    breakingChanges: [],
    newFeatures: [
      'User authentication with JWT',
      'Property management',
      'Transaction handling',
      'Blockchain integration',
    ],
    bugFixes: [],
  },
  '2.0': {
    version: '2.0',
    status: VersionStatus.ACTIVE,
    releaseDate: '2025-06-01',
    deprecationDate: '2026-06-01',
    sunsetDate: '2026-12-01',
    breakingChanges: [
      'Changed response structure for property endpoints',
      'Updated authentication flow',
      'Modified transaction format',
    ],
    newFeatures: [
      'Enhanced property search with filters',
      'Improved transaction batching',
      'Better error responses',
      'GraphQL support',
    ],
    bugFixes: ['Fixed pagination issues', 'Resolved caching problems'],
    migrationGuide: '/docs/migrations/v1-to-v2',
  },
};

/**
 * Configuration for version deprecation policies
 */
export interface VersionDeprecationConfig {
  warnAfterDays: number;
  errorAfterDays: number;
  sunsetAfterDays: number;
}

export const DEFAULT_DEPRECATION_CONFIG: VersionDeprecationConfig = {
  warnAfterDays: 30, // Start warning 30 days before sunset
  errorAfterDays: 60, // Return errors 60 days before sunset
  sunsetAfterDays: 90, // Fully sunset after 90 days
};

/**
 * Version compatibility levels
 */
export enum CompatibilityLevel {
  COMPATIBLE = 'compatible',
  BREAKING = 'breaking',
  DEPRECATED = 'deprecated',
}

/**
 * Feature flag for version-specific features
 */
export interface VersionFeatureFlag {
  name: string;
  version: string;
  enabled: boolean;
  description: string;
}
