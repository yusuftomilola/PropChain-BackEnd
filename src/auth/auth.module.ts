import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { UsersModule } from '../users/users.module';
import { SessionsModule } from '../sessions/sessions.module';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [PrismaModule, UsersModule, SessionsModule],
  imports: [PrismaModule, UsersModule, EmailModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, ApiKeyAuthGuard, RolesGuard],
  exports: [AuthService, RolesGuard],
})
export class AuthModule {}
