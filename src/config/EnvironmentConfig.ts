import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentConfiguration, EnvironmentName, ConfigValue } from '../models/Configuration';

const DEFAULT_VALUES: Record<EnvironmentName, Record<string, ConfigValue>> = {
  development: {
    LOG_LEVEL: 'debug',
    THROTTLE_LIMIT: 50,
    THROTTLE_TTL: 60,
  },
  staging: {
    LOG_LEVEL: 'info',
    THROTTLE_LIMIT: 25,
    THROTTLE_TTL: 60,
  },
  production: {
    LOG_LEVEL: 'warn',
    THROTTLE_LIMIT: 10,
    THROTTLE_TTL: 60,
  },
  test: {
    LOG_LEVEL: 'silent',
    THROTTLE_LIMIT: 1000,
    THROTTLE_TTL: 1,
  },
};

@Injectable()
export class EnvironmentConfigService {
  private readonly logger = new Logger(EnvironmentConfigService.name);

  getEnvironmentName(): EnvironmentName {
    const env = (process.env.NODE_ENV as EnvironmentName) || 'development';
    if (!['production', 'staging', 'development', 'test'].includes(env)) {
      return 'development';
    }
    return env;
  }

  loadDefault(environment?: EnvironmentName): EnvironmentConfiguration {
    const env = environment || this.getEnvironmentName();

    return {
      environment: env,
      settings: { ...DEFAULT_VALUES[env] },
      featureFlags: {},
    };
  }

  mergeOverrides(
    config: EnvironmentConfiguration,
    overrides: Partial<Record<string, ConfigValue>>,
  ): EnvironmentConfiguration {
    const merged: EnvironmentConfiguration = {
      ...config,
      settings: {
        ...config.settings,
        ...overrides,
      },
      featureFlags: {
        ...config.featureFlags,
      },
    };

    this.logger.log(`Merged overrides into ${config.environment} config`);
    return merged;
  }

  getActiveConfig(): EnvironmentConfiguration {
    const env = this.getEnvironmentName();
    const configValues: Record<string, ConfigValue> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && value !== null) {
        configValues[key] = value;
      }
    }

    // Assign defaults and env-based defaults
    const config = this.loadDefault(env);
    return this.mergeOverrides(config, configValues);
  }

  validate(configuration: EnvironmentConfiguration): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!configuration.environment) {
      errors.push('Environment name is required');
    }

    if (Object.keys(configuration.settings).length === 0) {
      errors.push('Settings must include at least one key');
    }

    if (errors.length > 0) {
      this.logger.warn('Environment configuration validation failed: ' + errors.join(', '));
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }
}
