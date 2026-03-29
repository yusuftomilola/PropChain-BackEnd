/**
 * @fileoverview Module for application monitoring tasks, like indexer health.
 * @issue #208
 */

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { makeGaugeProvider, makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { IndexerMonitorService } from './indexer-monitor.service';
import { IndexerMonitorController } from './src/monitoring/indexer-monitor.controller';
import { PrismaModule } from '../src/database/prisma/prisma.module';
import { BlockchainModule } from '../src/blockchain/blockchain.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, BlockchainModule],
  controllers: [IndexerMonitorController],
  providers: [
    IndexerMonitorService,
    makeGaugeProvider({
      name: 'propchain_indexer_current_height',
      help: 'The latest block height processed by the indexer.',
    }),
    makeGaugeProvider({
      name: 'propchain_indexer_target_height',
      help: 'The current latest block height on the blockchain.',
    }),
    makeGaugeProvider({
      name: 'propchain_indexer_height_drift',
      help: 'The difference between target and current indexer height.',
    }),
    makeCounterProvider({
      name: 'propchain_indexer_alerts_total',
      help: 'Total number of indexer alerts generated.',
      labelNames: ['type', 'severity'],
    }),
    makeGaugeProvider({
      name: 'propchain_indexer_health_status',
      help: 'Health status of the indexer (1 = healthy, 0 = unhealthy).',
    }),
    makeGaugeProvider({
      name: 'propchain_indexer_consecutive_failures',
      help: 'Number of consecutive failures in indexer monitoring.',
    }),
    makeGaugeProvider({
      name: 'propchain_indexer_last_check_timestamp',
      help: 'Timestamp of the last indexer health check.',
    }),
  ],
  exports: [IndexerMonitorService],
})
export class MonitoringModule { }