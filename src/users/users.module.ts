import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { VerificationDocumentsService } from './verification-documents.service';
import {
  VerificationDocumentsController,
  AdminVerificationDocumentsController,
} from './verification-documents.controller';
import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationController } from './email-verification.controller';
import { PrismaModule } from '../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    UsersController,
    VerificationDocumentsController,
    AdminVerificationDocumentsController,
    EmailVerificationController,
  ],
  providers: [UsersService, VerificationDocumentsService, EmailVerificationService],
  exports: [UsersService, VerificationDocumentsService, EmailVerificationService],
})
export class UsersModule {}
