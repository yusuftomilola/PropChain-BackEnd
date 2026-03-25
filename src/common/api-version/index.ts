/**
 * API Versioning Module
 *
 * Main entry point for the API versioning feature.
 * Provides version extraction, validation, deprecation handling,
 * and backward compatibility support.
 */

import { ApiVersionModule } from './api-version.module';

export default ApiVersionModule;
export { ApiVersionModule } from './api-version.module';

// Re-export from constants
export {
  API_VERSIONS,
  DEFAULT_API_VERSION,
  SUPPORTED_VERSIONS,
  VERSION_METADATA,
  VersionStatus,
  CompatibilityLevel,
  type ApiVersionMetadata,
  type VersionDeprecationConfig,
  type VersionFeatureFlag,
} from './constants';

// Re-export from middleware
export {
  ApiVersionMiddleware,
  type ApiVersionRequest,
  VERSION_HEADER,
  VERSION_QUERY_PARAM,
} from './middleware/api-version.middleware';

// Re-export from guards
export { ApiVersionGuard, RequiresVersion, Deprecated } from './guards/api-version.guard';

// Re-export from interceptors
export {
  ApiVersionInterceptor,
  VersionDeprecationInterceptor,
  Versionable,
} from './interceptors/api-version.interceptor';

// Re-export from service
export {
  ApiVersionService,
  type VersionCompatibilityResult,
  type DeprecationNotice,
  type VersionFeatureAvailability,
} from './services/api-version.service';
