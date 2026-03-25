/**
 * API Version Module
 *
 * Provides comprehensive API versioning support including:
 * - Version extraction from URL, headers, and query params
 * - Version validation and deprecation handling
 * - Version-specific response transformations
 * - Version compatibility checks
 *
 * Usage:
 * 1. Import ApiVersionModule in your app module
 * 2. Apply ApiVersionMiddleware globally
 * 3. Use @RequiresVersion() decorator on routes requiring specific versions
 * 4. Use @Deprecated() decorator to mark deprecated endpoints
 */

import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiVersionMiddleware } from './middleware/api-version.middleware';
import { ApiVersionGuard } from './guards/api-version.guard';
import { ApiVersionInterceptor, VersionDeprecationInterceptor } from './interceptors/api-version.interceptor';
import { ApiVersionService } from './services/api-version.service';
import { DEFAULT_API_VERSION } from './constants';

// Re-export types for module consumers
export type { ApiVersionMetadata } from './constants';
export type { VersionDeprecationConfig } from './constants';
export type { VersionFeatureFlag } from './constants';
export type { ApiVersionRequest } from './middleware/api-version.middleware';
export type { VersionCompatibilityResult } from './services/api-version.service';
export type { DeprecationNotice } from './services/api-version.service';
export type { VersionFeatureAvailability } from './services/api-version.service';

// Re-export constants
export {
  API_VERSIONS,
  DEFAULT_API_VERSION,
  SUPPORTED_VERSIONS,
  VERSION_METADATA,
  VersionStatus,
  CompatibilityLevel,
} from './constants';

// Re-export middleware
export { ApiVersionMiddleware, VERSION_HEADER, VERSION_QUERY_PARAM } from './middleware/api-version.middleware';

// Re-export guards
export { ApiVersionGuard, RequiresVersion, Deprecated } from './guards/api-version.guard';

// Re-export interceptors
export {
  ApiVersionInterceptor,
  VersionDeprecationInterceptor,
  Versionable,
} from './interceptors/api-version.interceptor';

// Re-export service
export { ApiVersionService } from './services/api-version.service';

@Module({
  providers: [
    ApiVersionService,
    ApiVersionMiddleware,
    ApiVersionGuard,
    {
      provide: APP_GUARD,
      useClass: ApiVersionGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiVersionInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: VersionDeprecationInterceptor,
    },
  ],
  exports: [ApiVersionService, ApiVersionMiddleware, ApiVersionGuard],
})
export class ApiVersionModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ApiVersionMiddleware).forRoutes('*');
  }
}
