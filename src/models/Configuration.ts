export type EnvironmentName = 'development' | 'staging' | 'production' | 'test';

export type ConfigValue = string | number | boolean | null;

export interface ConfigurationEntry {
  key: string;
  value: ConfigValue;
  description?: string;
  sensitive?: boolean;
}

export interface FeatureFlagEntry {
  key: string;
  enabled: boolean;
  description?: string;
  environments?: EnvironmentName[];
}

export interface EnvironmentConfiguration {
  environment: EnvironmentName;
  settings: Record<string, ConfigValue>;
  featureFlags: Record<string, boolean>;
}

export interface ConfigurationUpdateResult {
  success: boolean;
  key?: string;
  oldValue?: ConfigValue;
  newValue?: ConfigValue;
  error?: string;
}
