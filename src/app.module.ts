import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SessionsModule } from './sessions/sessions.module';
import { TrustScoreModule } from './trust-score/trust-score.module';
import { PropertiesModule } from './properties/properties.module';
import { PrismaModule } from './database/prisma.module';
import { AppController } from './app.controller';
import './common/common.types'; // Load registered enums

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: true,
      subscriptions: {
        'graphql-ws': true,
      },
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    DashboardModule,
    SessionsModule,
    TrustScoreModule,
    PropertiesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
