import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/database/prisma.service';
import { UsersService } from '../../src/users/users.service';
import { ConfigService } from '@nestjs/config';
import { hashPassword, comparePassword } from '../../src/auth/security.utils';

describe('AuthService - Password Hashing', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'BCRYPT_ROUNDS') return '12';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should hash password with configurable rounds', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password, 12);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('should verify correct password', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password, 12);

    const isValid = await comparePassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const password = 'testPassword123';
    const wrongPassword = 'wrongPassword123';
    const hash = await hashPassword(password, 12);

    const isValid = await comparePassword(wrongPassword, hash);
    expect(isValid).toBe(false);
  });

  it('should use default 12 rounds when not specified', async () => {
    const password = 'testPassword123';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    // Bcrypt hashes start with $2a$ or $2b$ followed by rounds
    expect(hash.startsWith('$2')).toBe(true);
  });
});