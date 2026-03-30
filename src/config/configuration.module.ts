import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigurationService } from './configuration.service';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationManagementController } from './configuration.management.controller';
import { ConfigManager } from './ConfigManager';
import { EnvironmentConfigService } from './EnvironmentConfig';
import { FeatureFlagsService } from './FeatureFlags';
import { StartupValidationService } from './startup.validation.service';
import { ConfigHotReloadService } from './utils/config.hot-reload';
import { ConfigVersioningService } from './utils/config.versioning';
import { ConfigAuditService } from './utils/config.audit';

@Module({
  imports: [ConfigModule],
  providers: [
    ConfigurationService,
    ConfigManager,
    EnvironmentConfigService,
    FeatureFlagsService,
    StartupValidationService,
    ConfigHotReloadService,
    ConfigVersioningService,
    ConfigAuditService,
  ],
  controllers: [ConfigurationController, ConfigurationManagementController],
  exports: [
    ConfigurationService,
    ConfigManager,
    EnvironmentConfigService,
    FeatureFlagsService,
    ConfigHotReloadService,
    ConfigVersioningService,
    ConfigAuditService,
  ],
})
export class ConfigurationModule {}
