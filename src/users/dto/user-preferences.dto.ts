import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateUserPreferencesDto {
  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  smsNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  propertyAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  marketUpdates?: boolean;

  @IsOptional()
  @IsString()
  theme?: string;
}

export class UpdateUserPreferencesDto {
  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  smsNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  propertyAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  marketUpdates?: boolean;

  @IsOptional()
  @IsString()
  theme?: string;
}
