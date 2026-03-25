# API Versioning Implementation Guide

## Overview

The API versioning system provides a comprehensive solution for managing different API versions with support for:
- Multiple version extraction strategies (URL path, headers, query parameters)
- Version deprecation policies with timeline-based warnings
- Backward compatibility through response transformations
- Version-specific feature flags

## Version Strategy

### Supported Versions

| Version | Status | Release Date | Deprecation Date | Sunset Date |
|---------|--------|--------------|------------------|-------------|
| 1.0 | Active | 2024-01-01 | - | - |
| 2.0 | Active | 2025-06-01 | 2026-06-01 | 2026-12-01 |

### Version Extraction

The API supports multiple ways to specify the version:

1. **URL Path** (recommended):
   ```
   GET /api/v1/properties
   GET /api/v2/properties
   ```

2. **Header**:
   ```
   Accept-Version: 1.0
   ```

3. **Query Parameter**:
   ```
   GET /api/properties?version=1.0
   ```

### Default Version

If no version is specified, the API defaults to version `1.0`.

## Versioning Implementation

### Middleware

The [`ApiVersionMiddleware`](src/common/api-version/middleware/api-version.middleware.ts) extracts and validates the API version from incoming requests.

```typescript
// Applying middleware globally
consumer
  .apply(ApiVersionMiddleware)
  .forRoutes('*');
```

### Guard

The [`ApiVersionGuard`](src/common/api-version/guards/api-version.guard.ts) enforces version requirements and deprecation policies.

```typescript
// Using decorators on controllers/endpoints
@Controller('properties')
class PropertiesController {
  @Get()
  @RequiresVersion('2.0')
  async getProperties() { }

  @Get(':id')
  @Deprecated('1.0', '/api/v2/properties/{id}')
  async getProperty() { }
}
```

### Interceptor

The [`ApiVersionInterceptor`](src/common/api-version/interceptors/api-version.interceptor.ts) adds version metadata to responses and handles backward compatibility.

```typescript
// Response includes version metadata
{
  "data": [...],
  "_metadata": {
    "version": "1.0",
    "timestamp": "2025-03-24T12:00:00Z",
    "deprecated": false
  }
}
```

### Response Headers

The API adds the following headers to responses:

- `X-API-Version`: The version being used (e.g., "1.0")
- `X-API-Versions-Available`: Comma-separated list of supported versions
- `Deprecation`: Header indicating deprecated versions
- `Warning`: Warning header for deprecated versions
- `Link`: Migration guide link for deprecated versions

## Deprecation Policy

### Timeline

1. **Active**: Full support with new features
2. **Deprecated**: Still functional but shows warnings
3. **Sunset**: No longer available, returns 410 Gone

### Deprecation Headers

When using a deprecated version:

```
Deprecation: version="1.0"
Warning: 299 - "API version 1.0 is deprecated"
Link: </docs/migrations/v1-to-v2>; rel="migration-guide"
```

### Client Actions

Clients should:
1. Monitor `Deprecation` and `Warning` headers
2. Plan migration within deprecation window
3. Use `Link` header for migration guides

## Version Compatibility

### Breaking Changes

Version 2.0 includes these breaking changes:

1. **Response Structure**: Changed response format for property endpoints
2. **Authentication Flow**: Updated authentication mechanism
3. **Transaction Format**: Modified transaction object structure

### Backward Compatibility

The interceptor automatically transforms responses to maintain backward compatibility:

```typescript
// For v1 clients accessing v2 endpoints
// Responses are transformed to v1 format automatically
```

### Compatibility Checking

Use the [`ApiVersionService`](src/common/api-version/services/api-version.service.ts) to check version compatibility:

```typescript
constructor(private versionService: ApiVersionService) {}

checkVersion() {
  const result = this.versionService.checkCompatibility('1.0', '2.0');
  // Returns compatibility level and recommended version
}
```

## Feature Flags

Version-specific features can be checked:

```typescript
const feature = this.versionService.getFeatureAvailability('advancedFilters', '1.0');
// { feature: 'advancedFilters', available: false, minimumVersion: '2.0' }
```

## Configuration

### Environment Variables

```env
# Enable/disable API versioning
API_VERSIONING_ENABLED=true

# Default API version
API_DEFAULT_VERSION=1.0
```

### Custom Deprecation Timeline

```typescript
// Configure custom deprecation periods
versionService.setDeprecationConfig({
  warnAfterDays: 30,    // Start warnings 30 days before sunset
  errorAfterDays: 60,  // Return errors 60 days before sunset
  sunsetAfterDays: 90,  // Fully sunset after 90 days
});
```

## Migration Guide

### From v1.0 to v2.0

1. Update version in requests:
   - Change `/api/v1/` to `/api/v2/` in URLs, OR
   - Add header `Accept-Version: 2.0`

2. Update response handling:
   - Response structure has changed
   - Check `_metadata` for version information

3. Authentication:
   - New authentication flow with enhanced token refresh

4. Transaction format:
   - New `transactionId` format
   - Additional `metadata` field

## Testing Versioning

```typescript
// Test version extraction
const result = versionService.checkCompatibility('1.0', '2.0');
expect(result.isCompatible).toBe(false);
expect(result.compatibilityLevel).toBe(CompatibilityLevel.BREAKING);
```

## Error Responses

### Unsupported Version (400)
```json
{
  "error": "Unsupported API Version",
  "message": "Version \"3.0\" is not supported",
  "supportedVersions": ["1.0", "2.0"],
  "code": "UNSUPPORTED_VERSION"
}
```

### Version Required (412)
```json
{
  "error": "Version Required",
  "message": "This endpoint requires version 2.0",
  "requiredVersion": "2.0",
  "currentVersion": "1.0"
}
```

### Version Sunset (410)
```json
{
  "error": "Version Sunset",
  "message": "API version 1.0 has been sunset",
  "sunsetDate": "2026-12-01"
}
```

## Best Practices

1. **Always specify version**: Include version in all API requests
2. **Monitor headers**: Watch for deprecation warnings
3. **Plan migrations**: Migrate before sunset dates
4. **Test thoroughly**: Verify compatibility between versions
5. **Use latest versions**: Prefer the latest stable version
