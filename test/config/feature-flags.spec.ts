import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagsService } from '../../src/config/FeatureFlags';
import { EnvironmentConfigService } from '../../src/config/EnvironmentConfig';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeatureFlagsService, EnvironmentConfigService],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
  });

  it('loads environment flags from process.env', () => {
    process.env.FEATURE_FLAG_TEST_MODE = 'true';
    service.loadFromEnvironment();
    expect(service.isEnabled('test_mode')).toBe(true);
  });

  it('allow creating and removing flags', () => {
    service.defineFlag('new_flag', true, 'Test flag');
    expect(service.isEnabled('new_flag')).toBe(true);
    expect(service.removeFlag('new_flag')).toBe(true);
    expect(service.isEnabled('new_flag')).toBe(false);
  });
});
