/**
 * API Version Interceptor
 *
 * Intercepts responses and applies version-specific transformations
 * to ensure backward compatibility across API versions.
 */

import { Injectable, NestInterceptor, ExecutionContext, CallHandler, HttpException, HttpStatus } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { ApiVersionRequest, VERSION_QUERY_PARAM } from '../middleware/api-version.middleware';
import { DEFAULT_API_VERSION, VERSION_METADATA, VersionStatus, CompatibilityLevel } from '../constants';

/**
 * Metadata key for version-specific response transformation
 */
export const VERSION_TRANSFORM_KEY = 'versionTransform';

/**
 * Response transformation rule
 */
export interface VersionTransformRule {
  path: string;
  transform: (data: any, version: string) => any;
}

/**
 * Decorator to mark a controller or method for version-specific handling
 */
export function Versionable(version: string): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(VERSION_TRANSFORM_KEY, version, descriptor.value);
    }
    return target;
  };
}

interface ResponseMetadata {
  version: string;
  timestamp: string;
  deprecated?: boolean;
  sunset?: boolean;
  migrationGuide?: string;
}

@Injectable()
export class ApiVersionInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<ApiVersionRequest>();
    const response = context.switchToHttp().getResponse();
    const version = request.apiVersion || DEFAULT_API_VERSION;
    const handler = context.getHandler();

    // Get version-specific transform requirements
    const transformVersion = this.reflector.get<string>(VERSION_TRANSFORM_KEY, handler);

    // Determine metadata for response
    const metadata = VERSION_METADATA[version];
    const isDeprecated = metadata?.status === VersionStatus.DEPRECATED;
    const isSunset = metadata?.status === VersionStatus.SUNSET;

    // Add version headers to response
    response.setHeader('X-API-Version', version);

    if (isDeprecated) {
      response.setHeader('Deprecation', `version="${version}"`);
      response.setHeader('Warning', `299 - "API version ${version} is deprecated"`);
    }

    if (isSunset) {
      response.setHeader('Deprecation', `version="${version}"`);
    }

    return next.handle().pipe(
      map(data => {
        // Apply version-specific transformations
        let transformedData = data;

        if (transformVersion) {
          transformedData = this.applyTransform(data, version, transformVersion);
        }

        // Wrap response with version metadata
        return this.wrapWithMetadata(transformedData, version, {
          deprecated: isDeprecated,
          sunset: isSunset,
          migrationGuide: metadata?.migrationGuide,
        });
      }),
    );
  }

  /**
   * Apply version-specific transformations for backward compatibility
   */
  private applyTransform(data: any, version: string, targetVersion: string): any {
    // If versions match, no transformation needed
    if (version === targetVersion) {
      return data;
    }

    // Apply transformations based on version differences
    if (this.isBreakingChange(version, targetVersion)) {
      return this.handleBreakingChanges(data, version, targetVersion);
    }

    return data;
  }

  /**
   * Check if there's a breaking change between versions
   */
  private isBreakingChange(from: string, to: string): boolean {
    const fromParts = from.split('.').map(Number);
    const toParts = to.split('.').map(Number);

    // Major version difference is always breaking
    if (fromParts[0] !== toParts[0]) {
      return true;
    }

    // Check metadata for breaking changes
    const metadata = VERSION_METADATA[to];
    return metadata?.breakingChanges.length > 0;
  }

  /**
   * Handle breaking changes by transforming response
   */
  private handleBreakingChanges(data: any, fromVersion: string, toVersion: string): any {
    // Deep clone to avoid mutating original
    const transformed = JSON.parse(JSON.stringify(data));

    // Apply version-specific adaptations
    if (toVersion === '2.0') {
      return this.transformToV2(transformed, fromVersion);
    }

    return transformed;
  }

  /**
   * Transform response to v2 format
   */
  private transformToV2(data: any, fromVersion: string): any {
    if (Array.isArray(data)) {
      return data.map(item => this.transformItemToV2(item));
    }

    if (data && typeof data === 'object') {
      return this.transformItemToV2(data);
    }

    return data;
  }

  /**
   * Transform individual item to v2 format
   */
  private transformItemToV2(item: any): any {
    // Transform common fields
    const transformed = { ...item };

    // Rename or transform fields as needed
    // Example: transform 'id' to 'uuid' if needed
    // Example: transform date formats

    return transformed;
  }

  /**
   * Wrap response with version metadata
   */
  private wrapWithMetadata(
    data: any,
    version: string,
    options: {
      deprecated?: boolean;
      sunset?: boolean;
      migrationGuide?: string;
    },
  ): any {
    const metadata: ResponseMetadata = {
      version,
      timestamp: new Date().toISOString(),
    };

    if (options.deprecated) {
      metadata.deprecated = true;
    }

    if (options.sunset) {
      metadata.sunset = true;
    }

    if (options.migrationGuide) {
      metadata.migrationGuide = options.migrationGuide;
    }

    // If data is already an object with a specific structure, merge carefully
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return {
        ...data,
        _metadata: metadata,
      };
    }

    return {
      data,
      _metadata: metadata,
    };
  }
}

/**
 * Interceptor to handle deprecation warnings
 */
@Injectable()
export class VersionDeprecationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<ApiVersionRequest>();
    const response = context.switchToHttp().getResponse();
    const version = request.apiVersion || DEFAULT_API_VERSION;
    const metadata = VERSION_METADATA[version];

    // Add deprecation headers if applicable
    if (metadata) {
      if (metadata.status === VersionStatus.DEPRECATED) {
        const deprecationDate = new Date(metadata.deprecationDate);
        const daysUntilDeprecation = Math.ceil((deprecationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        if (daysUntilDeprecation <= 30) {
          response.setHeader(
            'Warning',
            `299 - "API version ${version} will be deprecated in ${daysUntilDeprecation} days"`,
          );
        }
      }
    }

    return next.handle();
  }
}
