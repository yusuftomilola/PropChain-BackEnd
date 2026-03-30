import { Test, TestingModule } from '@nestjs/testing';
import { ConfigManager } from '../../src/config/ConfigManager';
import { ConfigurationService } from '../../src/config/configuration.service';
import { ConfigVersioningService } from '../../src/config/utils/config.versioning';
import { ConfigAuditService } from '../../src/config/utils/config.audit';
import { EnvironmentConfigService } from '../../src/config/EnvironmentConfig';
import { FeatureFlagsService } from '../../src/config/FeatureFlags';
import { ConfigService } from '@nestjs/config';

describe('ConfigManager', () => {
  let service: ConfigManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigManager,
        ConfigurationService,
        EnvironmentConfigService,
        FeatureFlagsService,
        ConfigVersioningService,
        ConfigAuditService,
        ConfigService,
      ],
    }).compile();

    service = module.get<ConfigManager>(ConfigManager);
  });

  it('getAll returns current env settings', () => {
    process.env.TEST_KEY = 'test';
    const all = service.getAll();
    expect(all.TEST_KEY).toBe('test');
  });

  it('set and delete config values', async () => {
    const res = await service.set('TEST_UPDATE', 'new');
    expect(res.success).toBe(true);
    expect(process.env.TEST_UPDATE).toBe('new');

    const del = await service.delete('TEST_UPDATE');
    expect(del.success).toBe(true);
    expect(process.env.TEST_UPDATE).toBeUndefined();
  });
});
