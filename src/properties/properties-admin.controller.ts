import { Controller, Get, Post, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin.guard';
import { ApiStandardErrorResponse } from '../common/errors/api-standard-error-response.decorator';

@ApiTags('admin-properties')
@Controller('admin/properties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
export class PropertiesAdminController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a property listing' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Property approved successfully.' })
  @ApiStandardErrorResponse([400, 401, 403, 404])
  approve(@Param('id') id: string, @Request() req: any) {
    return this.propertiesService.approve(id, req.user?.id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a property listing' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Property rejected successfully.' })
  @ApiStandardErrorResponse([400, 401, 403, 404])
  reject(@Param('id') id: string, @Body('reason') reason: string, @Request() req: any) {
    return this.propertiesService.reject(id, reason, req.user?.id);
  }

  @Get('reports')
  @ApiOperation({ summary: 'Get all property reports' })
  @ApiResponse({ status: 200, description: 'List of property reports.' })
  @ApiStandardErrorResponse([400, 401, 403])
  getReports(@Query('status') status?: string, @Query('propertyId') propertyId?: string) {
    return this.propertiesService.getReports({ 
      ...(status && { status }), 
      ...(propertyId && { propertyId }) 
    });
  }
}
