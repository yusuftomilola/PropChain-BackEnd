import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesAdminController } from './properties-admin.controller';
import { PropertiesService } from './properties.service';
import { PrismaModule } from '../database/prisma/prisma.module';
import { ValuationModule } from '../valuation/valuation.module';
import { PropertySearchService } from './search/property-search.service';
import { CacheModule } from '../common/cache/cache.module';
import { BoundaryValidationModule } from '../common/validation';

@Module({
  imports: [PrismaModule, ValuationModule, CacheModule, BoundaryValidationModule],
  controllers: [PropertiesController, PropertiesAdminController],
  providers: [PropertiesService, PropertySearchService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
