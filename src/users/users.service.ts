import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { hashPassword, sanitizeUser } from '../auth/security.utils';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // Start cleanup interval (every hour)
    setInterval(() => this.cleanupExports(), 60 * 60 * 1000);
    // Initial cleanup
    this.cleanupExports();
  }

  private async cleanupExports() {
    const exportsDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(exportsDir)) return;

    const files = fs.readdirSync(exportsDir);
    const now = Date.now();
    const expirationTime = 24 * 60 * 60 * 1000; // 24 hours

    files.forEach((file) => {
      const filepath = path.join(exportsDir, file);
      const stats = fs.statSync(filepath);
      if (now - stats.mtimeMs > expirationTime) {
        fs.unlinkSync(filepath);
        this.logger.log(`Deleted expired export file: ${file}`);
      }
    });
  }

  async create(data: CreateUserDto) {
    const passwordHash = await hashPassword(data.password);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        passwordHistory: {
          create: {
            passwordHash,
          },
        },
      },
    });

    return sanitizeUser(user);
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isVerified: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isVerified: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async update(id: string, data: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isVerified: true,
        avatar: true,
        updatedAt: true,
      },
    });
  }

  async remove(id: string) {
    return this.prisma.user.delete({
      where: { id },
    });
  }

  async exportPersonalData(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        properties: true,
        buyerTransactions: {
          include: {
            property: true,
            seller: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        sellerTransactions: {
          include: {
            property: true,
            buyer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        documents: true,
        apiKeys: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
            lastUsedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Sanitize user data
    const { password, twoFactorSecret, twoFactorBackupCodes, ...safeUser } = user;

    return {
      metadata: {
        exportDate: new Date().toISOString(),
        version: '1.0',
        type: 'PERSONAL_DATA_EXPORT',
      },
      data: safeUser,
    };
  }
}
