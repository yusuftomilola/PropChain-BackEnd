import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, MaxLength, IsDateString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportPropertyDto {
  @ApiProperty({ description: 'Reason for reporting the property', example: 'Inappropriate content' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ description: 'Additional details about the report', example: 'The images are misleading' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  details?: string;
}

export class ResolveReportDto {
  @ApiProperty({ description: 'Resolution status', example: 'RESOLVED' })
  @IsString()
  @IsNotEmpty()
  status!: 'RESOLVED' | 'DISMISSED';

  @ApiPropertyOptional({ description: 'Resolution comments', example: 'Property removed' })
  @IsString()
  @IsOptional()
  comments?: string;
}

export class AvailabilitySlotDto {
  @ApiProperty({ description: 'The start time of the slot', example: '2026-04-01T10:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  startTime!: string;

  @ApiProperty({ description: 'The end time of the slot', example: '2026-04-01T11:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  endTime!: string;
}

export class CreateAvailabilitySlotsDto {
  @ApiProperty({ type: [AvailabilitySlotDto], description: 'List of availability slots to create' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  slots!: AvailabilitySlotDto[];
}
