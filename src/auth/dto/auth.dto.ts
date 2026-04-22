import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  totpCode?: string;

  @IsOptional()
  @IsString()
  backupCode?: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class VerifyTwoFactorDto {
  @IsString()
  code: string;
}

export class DisableTwoFactorDto {
  @IsString()
  password: string;
}

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
