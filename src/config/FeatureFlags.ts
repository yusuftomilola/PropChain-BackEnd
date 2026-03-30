import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentConfigService } from './EnvironmentConfig';
import { FeatureFlagEntry, EnvironmentName } from '../models/Configuration';

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private flags: Record<string, FeatureFlagEntry> = {};

  constructor(private readonly environmentConfig: EnvironmentConfigService) {
    this.loadFromEnvironment();
  }

  loadFromEnvironment(): void {
    const env = this.environmentConfig.getEnvironmentName();

    Object.keys(process.env)
      .filter(key => key.startsWith('FEATURE_FLAG_'))
      .forEach(key => {
        const normalized = key.replace('FEATURE_FLAG_', '').toLowerCase();
        const value = process.env[key];
        const enabled = value === 'true' || value === '1';

        this.flags[normalized] = {
          key: normalized,
          enabled,
          description: `Loaded from env ${key}`,
          environments: [env],
        };
      });

    this.logger.log(`Loaded ${Object.keys(this.flags).length} feature flags from environment`);
  }

  defineFlag(flag: string, enabled: boolean, description?: string, environments?: EnvironmentName[]): FeatureFlagEntry {
    const existing = this.flags[flag] || { key: flag, enabled, description: '', environments: undefined };

    const entry: FeatureFlagEntry = {
      key: flag,
      enabled,
      description: description ?? existing.description,
      environments: environments ?? existing.environments,
    };

    this.flags[flag] = entry;
    this.logger.log(`Feature flag '${flag}' set to ${enabled}`);
    return entry;
  }

  isEnabled(flag: string, defaultValue = false): boolean {
    const entry = this.flags[flag];
    if (!entry) {
      return defaultValue;
    }

    const env = this.environmentConfig.getEnvironmentName();
    if (entry.environments && entry.environments.length > 0) {
      if (!entry.environments.includes(env)) {
        this.logger.debug(`Feature flag '${flag}' is not active in ${env}`);
        return false;
      }
    }

    return entry.enabled;
  }

  getFlag(flag: string): FeatureFlagEntry | undefined {
    return this.flags[flag];
  }

  listFlags(): FeatureFlagEntry[] {
    return Object.values(this.flags);
  }

  removeFlag(flag: string): boolean {
    if (!this.flags[flag]) {
      return false;
    }
    delete this.flags[flag];
    this.logger.log(`Feature flag '${flag}' removed`);
    return true;
  }
}
