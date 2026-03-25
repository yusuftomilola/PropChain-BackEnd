/**
 * API Version Guard
 *
 * Guard that validates the API version and enforces deprecation policies.
 * This guard can be applied to routes to ensure proper version handling.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SUPPORTED_VERSIONS, DEFAULT_API_VERSION, VERSION_METADATA, VersionStatus } from '../constants';
import { ApiVersionRequest } from '../middleware/api-version.middleware';

/**
 * Metadata key for version requirements
 */
export const API_VERSION_KEY = 'apiVersion';

/**
 * Decorator to specify required version for a route
 */
export function RequiresVersion(version: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(API_VERSION_KEY, version, descriptor.value);
    return descriptor;
  };
}

/**
 * Decorator to mark a route as deprecated in a specific version
 */
export function Deprecated(version: string, alternative?: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata('deprecatedVersion', version, descriptor.value);
    Reflect.defineMetadata('deprecatedAlternative', alternative, descriptor.value);
    return descriptor;
  };
}

@Injectable()
export class ApiVersionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiVersionRequest>();
    const response = context.switchToHttp().getResponse();

    // Get version from request (set by middleware)
    const apiVersion = request.apiVersion || DEFAULT_API_VERSION;

    // Get route-specific version requirements
    const requiredVersion = this.reflector.get<string>(API_VERSION_KEY, context.getHandler());

    const deprecatedVersion = this.reflector.get<string>('deprecatedVersion', context.getHandler());

    const deprecatedAlternative = this.reflector.get<string>('deprecatedAlternative', context.getHandler());

    // Validate version
    if (!SUPPORTED_VERSIONS.includes(apiVersion as any)) {
      throw new BadRequestException({
        error: 'Unsupported API Version',
        message: `Version "${apiVersion}" is not supported`,
        supportedVersions: SUPPORTED_VERSIONS,
        code: 'UNSUPPORTED_VERSION',
      });
    }

    // Check version compatibility
    if (requiredVersion && !this.isCompatible(apiVersion, requiredVersion)) {
      throw new HttpException(
        {
          error: 'Version Required',
          message: `This endpoint requires version ${requiredVersion}. Current version: ${apiVersion}`,
          requiredVersion,
          currentVersion: apiVersion,
        },
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // Handle deprecation
    const metadata = VERSION_METADATA[apiVersion];
    if (metadata) {
      // Add deprecation headers if version is deprecated
      if (metadata.status === VersionStatus.DEPRECATED) {
        response.setHeader('Deprecation', `version="${apiVersion}"`);
        response.setHeader('Link', `<${metadata.migrationGuide}>; rel="migration-guide"`);

        // Add warning header
        response.setHeader('Warning', `299 - "API version ${apiVersion} is deprecated"`);
      }

      // Handle sunset version
      if (metadata.status === VersionStatus.SUNSET) {
        throw new HttpException(
          {
            error: 'Version Sunset',
            message: `API version ${apiVersion} has been sunset and is no longer available.`,
            sunsetDate: metadata.sunsetDate,
          },
          HttpStatus.GONE,
        );
      }
    }

    // Handle route-specific deprecation
    if (deprecatedVersion && apiVersion === deprecatedVersion) {
      response.setHeader('Deprecation', `version="${deprecatedVersion}"`);
      if (deprecatedAlternative) {
        response.setHeader('Link', `<${deprecatedAlternative}>; rel="alternative"`);
      }
    }

    return true;
  }

  /**
   * Check if the requested version is compatible with required version
   */
  private isCompatible(requested: string, required: string): boolean {
    const requestedParts = requested.split('.').map(Number);
    const requiredParts = required.split('.').map(Number);

    // Major version must match
    if (requestedParts[0] !== requiredParts[0]) {
      return false;
    }

    // Minor version must be >= required
    return requestedParts[1] >= requiredParts[1];
  }
}
