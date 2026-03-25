/**
 * API Version Middleware
 *
 * Extracts and validates API version from incoming requests.
 * Supports version extraction from:
 * - URL path: /api/v1/resource
 * - Header: Accept-Version: 1.0
 * - Query param: ?version=1.0
 */

import { Injectable, NestMiddleware, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SUPPORTED_VERSIONS, DEFAULT_API_VERSION, VERSION_METADATA, VersionStatus } from '../constants';

export interface ApiVersionRequest extends Request {
  apiVersion?: string;
  versionMetadata?: (typeof VERSION_METADATA)[string];
}

/**
 * Header name for version specification
 */
export const VERSION_HEADER = 'Accept-Version';

/**
 * Query parameter name for version specification
 */
export const VERSION_QUERY_PARAM = 'version';

/**
 * Path pattern to extract version from URL
 */
const VERSION_PATH_PATTERN = /^\/v(\d+\.\d+)/;

@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
  constructor() {}

  async use(req: ApiVersionRequest, res: Response, next: NextFunction) {
    try {
      // Extract version from different sources
      let version = this.extractVersion(req);

      // Validate and normalize version
      version = this.normalizeVersion(version, req);

      // Attach version info to request
      req.apiVersion = version;
      req.versionMetadata = VERSION_METADATA[version];

      // Add version headers to response
      res.setHeader('X-API-Version', version);
      res.setHeader('X-API-Versions-Available', SUPPORTED_VERSIONS.join(', '));

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException({ error: 'Invalid API Version', message: error.message }, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Extract version from request using multiple strategies
   */
  private extractVersion(req: Request): string | null {
    // 1. Try URL path: /api/v1/resource
    const pathVersion = this.extractFromPath(req.path);
    if (pathVersion) {
      return pathVersion;
    }

    // 2. Try header: Accept-Version: 1.0
    const headerVersion = req.headers[VERSION_HEADER.toLowerCase()] as string;
    if (headerVersion) {
      return headerVersion;
    }

    // 3. Try query param: ?version=1.0
    const queryVersion = req.query[VERSION_QUERY_PARAM] as string;
    if (queryVersion) {
      return queryVersion;
    }

    // 4. Default to configured default version
    return DEFAULT_API_VERSION;
  }

  /**
   * Extract version from URL path
   */
  private extractFromPath(path: string): string | null {
    const match = path.match(VERSION_PATH_PATTERN);
    return match ? `1.${match[1]}` : null;
  }

  /**
   * Normalize and validate the version
   */
  private normalizeVersion(version: string | null, req: Request): string {
    // Use default if no version provided
    if (!version) {
      return DEFAULT_API_VERSION;
    }

    // Normalize version format (ensure MAJOR.MINOR)
    const normalizedVersion = this.normalizeVersionFormat(version);

    // Check if version is supported
    if (!SUPPORTED_VERSIONS.includes(normalizedVersion as any)) {
      throw new BadRequestException({
        error: 'Unsupported API Version',
        message: `Version "${version}" is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
        supportedVersions: SUPPORTED_VERSIONS,
        code: 'UNSUPPORTED_VERSION',
      });
    }

    return normalizedVersion;
  }

  /**
   * Normalize version format
   */
  private normalizeVersionFormat(version: string): string {
    // Handle v1, v1.0, v2.0 formats
    const cleaned = version.replace(/^v/, '');
    const parts = cleaned.split('.');

    if (parts.length === 1) {
      return `${parts[0]}.0`;
    }

    return `${parts[0]}.${parts[1]}`;
  }
}

/**
 * Guard to check if a version is deprecated
 */
@Injectable()
export class VersionDeprecationGuard {
  checkDeprecationStatus(version: string): {
    isDeprecated: boolean;
    isSunset: boolean;
    message?: string;
  } {
    const metadata = VERSION_METADATA[version];

    if (!metadata) {
      return { isDeprecated: false, isSunset: false };
    }

    const now = new Date();
    const deprecationDate = metadata.deprecationDate ? new Date(metadata.deprecationDate) : null;
    const sunsetDate = metadata.sunsetDate ? new Date(metadata.sunsetDate) : null;

    // Check if sunset
    if (sunsetDate && now >= sunsetDate) {
      return {
        isDeprecated: true,
        isSunset: true,
        message: `API version ${version} has been sunset. Please migrate to a supported version.`,
      };
    }

    // Check if deprecated
    if (deprecationDate && now >= deprecationDate) {
      return {
        isDeprecated: true,
        isSunset: false,
        message: `API version ${version} is deprecated. Please migrate to a supported version.`,
      };
    }

    return { isDeprecated: false, isSunset: false };
  }
}
