import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { PropertiesModule } from './properties/properties.module';
import { PrismaModule } from './database/prisma.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    UsersModule,
    PropertiesModule,
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
