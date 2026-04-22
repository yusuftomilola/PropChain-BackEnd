import { Test, TestingModule } from '@nestjs/testing';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthUserPayload } from '../../src/auth/types/auth-user.type';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should allow access when no roles are required', () => {
    const mockExecutionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const result = guard.canActivate(mockExecutionContext);
    expect(result).toBe(true);
  });

  it('should allow access when user has required role', () => {
    const mockExecutionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          authUser: {
            sub: 'user-id',
            email: 'user@example.com',
            role: UserRole.ADMIN,
            type: 'access',
          } as AuthUserPayload,
        }),
      }),
    } as any;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);

    const result = guard.canActivate(mockExecutionContext);
    expect(result).toBe(true);
  });

  it('should deny access when user does not have required role', () => {
    const mockExecutionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          authUser: {
            sub: 'user-id',
            email: 'user@example.com',
            role: UserRole.USER,
            type: 'access',
          } as AuthUserPayload,
        }),
      }),
    } as any;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(mockExecutionContext)).toThrow(ForbiddenException);
  });

  it('should deny access when user role is not found', () => {
    const mockExecutionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          authUser: {
            sub: 'user-id',
            email: 'user@example.com',
            type: 'access',
          } as AuthUserPayload,
        }),
      }),
    } as any;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(mockExecutionContext)).toThrow(ForbiddenException);
  });

  it('should deny access when authUser is not found', () => {
    const mockExecutionContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({}),
      }),
    } as any;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(mockExecutionContext)).toThrow(ForbiddenException);
  });
});