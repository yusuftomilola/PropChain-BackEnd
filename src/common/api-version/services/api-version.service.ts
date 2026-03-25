/**
 * API Version Service
 *
 * Service to handle version compatibility, deprecation policies,
 * and version-specific feature flags.
 */

import { Injectable } from '@nestjs/common';
import {
  SUPPORTED_VERSIONS,
  DEFAULT_API_VERSION,
  VERSION_METADATA,
  ApiVersionMetadata,
  VersionStatus,
  CompatibilityLevel,
  VersionDeprecationConfig,
  DEFAULT_DEPRECATION_CONFIG,
} from '../constants';

/**
 * Version compatibility check result
 */
export interface VersionCompatibilityResult {
  isCompatible: boolean;
  compatibilityLevel: CompatibilityLevel;
  breakingChanges: string[];
  recommendedVersion: string;
  migrationRequired: boolean;
}

/**
 * Deprecation notice
 */
export interface DeprecationNotice {
  version: string;
  status: VersionStatus;
  message: string;
  daysUntilDeprecation?: number;
  daysUntilSunset?: number;
  alternativeVersion?: string;
  migrationGuide?: string;
}

/**
 * Version feature availability
 */
export interface VersionFeatureAvailability {
  feature: string;
  available: boolean;
  minimumVersion: string;
}

@Injectable()
export class ApiVersionService {
  private deprecationConfig: VersionDeprecationConfig;

  constructor() {
    this.deprecationConfig = DEFAULT_DEPRECATION_CONFIG;
  }

  /**
   * Get all supported versions
   */
  getSupportedVersions(): string[] {
    return [...SUPPORTED_VERSIONS];
  }

  /**
   * Get version metadata
   */
  getVersionMetadata(version: string): ApiVersionMetadata | null {
    return VERSION_METADATA[version] || null;
  }

  /**
   * Get all version metadata
   */
  getAllVersionMetadata(): Record<string, ApiVersionMetadata> {
    return { ...VERSION_METADATA };
  }

  /**
   * Check version compatibility between two versions
   */
  checkCompatibility(requestedVersion: string, targetVersion: string): VersionCompatibilityResult {
    const requested = this.parseVersion(requestedVersion);
    const target = this.parseVersion(targetVersion);

    // Same version is always compatible
    if (requestedVersion === targetVersion) {
      return {
        isCompatible: true,
        compatibilityLevel: CompatibilityLevel.COMPATIBLE,
        breakingChanges: [],
        recommendedVersion: targetVersion,
        migrationRequired: false,
      };
    }

    // Check major version difference
    if (requested.major < target.major) {
      const targetMetadata = VERSION_METADATA[targetVersion];
      return {
        isCompatible: false,
        compatibilityLevel: CompatibilityLevel.BREAKING,
        breakingChanges: targetMetadata?.breakingChanges || [],
        recommendedVersion: targetVersion,
        migrationRequired: true,
      };
    }

    // Check minor version difference for deprecation
    if (requested.major === target.major && requested.minor < target.minor) {
      const targetMetadata = VERSION_METADATA[targetVersion];
      return {
        isCompatible: true,
        compatibilityLevel: CompatibilityLevel.DEPRECATED,
        breakingChanges: targetMetadata?.breakingChanges || [],
        recommendedVersion: targetVersion,
        migrationRequired: false,
      };
    }

    return {
      isCompatible: true,
      compatibilityLevel: CompatibilityLevel.COMPATIBLE,
      breakingChanges: [],
      recommendedVersion: targetVersion,
      migrationRequired: false,
    };
  }

  /**
   * Get deprecation notice for a version
   */
  getDeprecationNotice(version: string): DeprecationNotice | null {
    const metadata = VERSION_METADATA[version];

    if (!metadata) {
      return null;
    }

    const now = new Date();
    let daysUntilDeprecation: number | undefined;
    let daysUntilSunset: number | undefined;

    if (metadata.deprecationDate) {
      const deprecationDate = new Date(metadata.deprecationDate);
      daysUntilDeprecation = Math.ceil((deprecationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    if (metadata.sunsetDate) {
      const sunsetDate = new Date(metadata.sunsetDate);
      daysUntilSunset = Math.ceil((sunsetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    let message = '';
    const status = metadata.status;

    if (status === VersionStatus.SUNSET) {
      message = `API version ${version} has been sunset and is no longer available.`;
    } else if (status === VersionStatus.DEPRECATED) {
      message = `API version ${version} is deprecated and will be sunset.`;
    }

    return {
      version,
      status,
      message,
      daysUntilDeprecation,
      daysUntilSunset,
      alternativeVersion: this.getLatestActiveVersion(),
      migrationGuide: metadata.migrationGuide,
    };
  }

  /**
   * Check if a version is active
   */
  isVersionActive(version: string): boolean {
    const metadata = VERSION_METADATA[version];
    return metadata?.status === VersionStatus.ACTIVE;
  }

  /**
   * Check if a version is deprecated
   */
  isVersionDeprecated(version: string): boolean {
    const metadata = VERSION_METADATA[version];
    return metadata?.status === VersionStatus.DEPRECATED;
  }

  /**
   * Check if a version is sunset
   */
  isVersionSunset(version: string): boolean {
    const metadata = VERSION_METADATA[version];
    return metadata?.status === VersionStatus.SUNSET;
  }

  /**
   * Get the latest active version
   */
  getLatestActiveVersion(): string {
    const activeVersions = Object.values(VERSION_METADATA).filter(v => v.status === VersionStatus.ACTIVE);

    if (activeVersions.length === 0) {
      return DEFAULT_API_VERSION;
    }

    // Sort by version and return latest
    return activeVersions.sort((a, b) => {
      const aParts = this.parseVersion(a.version);
      const bParts = this.parseVersion(b.version);
      return bParts.major - aParts.major || bParts.minor - aParts.minor;
    })[0].version;
  }

  /**
   * Get feature availability for a version
   */
  getFeatureAvailability(feature: string, version: string): VersionFeatureAvailability {
    // Define features and their minimum required versions
    const featureMap: Record<string, string> = {
      // Add features here as they are added in new versions
      // Example: 'graphQL': '2.0',
      // Example: 'advancedFilters': '2.0',
    };

    const minimumVersion = featureMap[feature];

    if (!minimumVersion) {
      // Feature is available in all versions
      return {
        feature,
        available: true,
        minimumVersion: DEFAULT_API_VERSION,
      };
    }

    return {
      feature,
      available: this.isVersionCompatible(version, minimumVersion),
      minimumVersion,
    };
  }

  /**
   * Check if version is compatible with minimum version
   */
  private isVersionCompatible(version: string, minimumVersion: string): boolean {
    const v = this.parseVersion(version);
    const min = this.parseVersion(minimumVersion);

    if (v.major < min.major) {
      return false;
    }
    if (v.major > min.major) {
      return true;
    }
    return v.minor >= min.minor;
  }

  /**
   * Parse version string to object
   */
  private parseVersion(version: string): { major: number; minor: number } {
    const parts = version.split('.');
    return {
      major: parseInt(parts[0], 10),
      minor: parseInt(parts[1] || '0', 10),
    };
  }

  /**
   * Set custom deprecation config
   */
  setDeprecationConfig(config: Partial<VersionDeprecationConfig>): void {
    this.deprecationConfig = {
      ...DEFAULT_DEPRECATION_CONFIG,
      ...config,
    };
  }

  /**
   * Get deprecation config
   */
  getDeprecationConfig(): VersionDeprecationConfig {
    return { ...this.deprecationConfig };
  }
}
