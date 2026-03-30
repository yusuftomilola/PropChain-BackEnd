import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigVersioningService } from './utils/config.versioning';
import { ConfigAuditService } from './utils/config.audit';
import { EnvironmentConfigService } from './EnvironmentConfig';
import { FeatureFlagsService } from './FeatureFlags';
import {
  ConfigurationEntry,
  ConfigurationUpdateResult,
  EnvironmentConfiguration,
  ConfigValue,
} from '../models/Configuration';

@Injectable()
export class ConfigManager {
  private readonly logger = new Logger(ConfigManager.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly versioningService: ConfigVersioningService,
    private readonly auditService: ConfigAuditService,
    private readonly environmentConfigService: EnvironmentConfigService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  get(key: string): ConfigValue {
    return this.configService.get<ConfigValue>(key);
  }

  getAll(): Record<string, ConfigValue> {
    const values: Record<string, ConfigValue> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && value !== null) {
        values[key] = value;
      }
    }
    return values;
  }

  async set(key: string, value: ConfigValue, author?: string): Promise<ConfigurationUpdateResult> {
    const oldValue = process.env[key] ?? null;

    try {
      process.env[key] = String(value);
      await this.versioningService.createVersion(`Updated configuration ${key}`);
      await this.auditService.logUpdate(key, oldValue, String(value), author ?? 'system');
      this.logger.log(`Config value for ${key} set to ${value}`);

      return {
        success: true,
        key,
        oldValue,
        newValue: value,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        success: false,
        error: message,
      };
    }
  }

  async delete(key: string, author?: string): Promise<ConfigurationUpdateResult> {
    const oldValue = process.env[key];
    if (oldValue === undefined) {
      return { success: false, error: `Key ${key} does not exist` };
    }

    try {
      delete process.env[key];
      await this.versioningService.createVersion(`Deleted configuration ${key}`);
      await this.auditService.logDelete(key, oldValue, author ?? 'system');
      this.logger.log(`Config key ${key} deleted`);

      return {
        success: true,
        key,
        oldValue,
        newValue: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        success: false,
        error: message,
      };
    }
  }

  getEnvironmentConfig(environment?: string): EnvironmentConfiguration {
    return this.environmentConfigService.getActiveConfig();
  }

  getFeatureFlagState(key: string, defaultValue = false): boolean {
    return this.featureFlagsService.isEnabled(key, defaultValue);
  }

  setFeatureFlag(key: string, enabled: boolean, environments?: string[]): void {
    this.featureFlagsService.defineFlag(key, enabled, `Set by ConfigManager`, environments as any);
  }

  validateConfig(config: EnvironmentConfiguration): { valid: boolean; errors: string[] } {
    return this.environmentConfigService.validate(config);
  }

  async rollback(versionId: string): Promise<{ success: boolean; message?: string }> {
    const { success, error } = await this.versioningService.rollbackToVersion(versionId);
    if (!success) {
      return { success: false, message: error };
    }
    return { success: true };
  }
}
