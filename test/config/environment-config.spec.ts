import { EnvironmentConfigService } from '../../src/config/EnvironmentConfig';

describe('EnvironmentConfigService', () => {
  let service: EnvironmentConfigService;

  beforeEach(() => {
    service = new EnvironmentConfigService();
  });

  it('should load default environment config with environment type', () => {
    const config = service.loadDefault('test');
    expect(config.environment).toBe('test');
    expect(config.settings.LOG_LEVEL).toBe('silent');
  });

  it('should merge overrides into config', () => {
    const base = service.loadDefault('development');
    const merged = service.mergeOverrides(base, { LOG_LEVEL: 'warn', CUSTOM: 'value' });

    expect(merged.settings.LOG_LEVEL).toBe('warn');
    expect(merged.settings.CUSTOM).toBe('value');
  });

  it('should validate config', () => {
    const config = service.loadDefault('staging');
    const result = service.validate(config);
    expect(result.valid).toBe(true);
  });
});
