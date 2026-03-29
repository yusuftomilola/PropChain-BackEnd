import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, UpdatePropertyDto, PropertyQueryDto, PropertyResponseDto, PropertyStatus, ReportPropertyDto, CreateAvailabilitySlotsDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PropertySearchService } from './search/property-search.service';
import { PropertySearchDto } from './dto/property-search.dto';
import { ApiStandardErrorResponse } from '../common/errors/api-standard-error-response.decorator';

@ApiTags('properties')
@Controller('properties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly propertySearchService: PropertySearchService,
  ) {}
  @Post()
  @ApiOperation({ summary: 'Create a new property' })
  @ApiResponse({ status: 201, description: 'Property created successfully.', type: PropertyResponseDto })
  @ApiStandardErrorResponse([400, 401, 404])
  create(@Body() createPropertyDto: CreatePropertyDto, @Request() req) {
    return this.propertiesService.create(createPropertyDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all properties with optional filters' })
  @ApiResponse({ status: 200, description: 'List of properties.' })
  @ApiStandardErrorResponse([400, 401])
  findAll(@Query() query: PropertyQueryDto) {
    return this.propertiesService.findAll(query);
  }

  @Get('search')
  @ApiOperation({ summary: 'Advanced property search (geospatial + filters)' })
  @ApiResponse({ status: 200, description: 'Search results.' })
  @ApiStandardErrorResponse([400, 401])
  search(@Query() dto: PropertySearchDto, @Request() req) {
    return this.propertySearchService.search(dto, req.user.id);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get property statistics' })
  @ApiResponse({ status: 200, description: 'Property statistics.' })
  @ApiStandardErrorResponse([400, 401])
  getStatistics() {
    return this.propertiesService.getStatistics();
  }

  @Get('owner/:ownerId')
  @ApiOperation({ summary: 'Get properties by owner' })
  @ApiParam({ name: 'ownerId', description: 'Owner ID' })
  @ApiResponse({ status: 200, description: 'Properties by owner.' })
  @ApiStandardErrorResponse([400, 401])
  findByOwner(@Param('ownerId') ownerId: string, @Query() query: PropertyQueryDto) {
    return this.propertiesService.findByOwner(ownerId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a property by ID' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Property found.', type: PropertyResponseDto })
  @ApiStandardErrorResponse([400, 401, 404])
  findOne(@Param('id') id: string) {
    return this.propertiesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a property' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Property updated successfully.', type: PropertyResponseDto })
  @ApiStandardErrorResponse([400, 401, 404])
  update(@Param('id') id: string, @Body() updatePropertyDto: UpdatePropertyDto) {
    return this.propertiesService.update(id, updatePropertyDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update property status' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Property status updated successfully.' })
  @ApiStandardErrorResponse([400, 401, 404, 409])
  updateStatus(@Param('id') id: string, @Body('status') status: PropertyStatus, @Request() req) {
    return this.propertiesService.updateStatus(id, status, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a property' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Property deleted successfully.' })
  @ApiStandardErrorResponse([400, 401, 404])
  remove(@Param('id') id: string) {
    return this.propertiesService.remove(id);
  }

  // --- Listing Report System (#262) ---

  @Post(':id/report')
  @ApiOperation({ summary: 'Report a property listing' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 201, description: 'Report submitted successfully.' })
  @ApiStandardErrorResponse([400, 401, 404])
  report(@Param('id') id: string, @Body() reportDto: ReportPropertyDto, @Request() req) {
    return this.propertiesService.reportProperty(id, req.user.id, reportDto);
  }

  // --- Listing Versioning System (#263) ---

  @Get(':id/versions')
  @ApiOperation({ summary: 'Get history of property changes' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'List of property versions.' })
  @ApiStandardErrorResponse([400, 401, 404])
  getVersions(@Param('id') id: string) {
    return this.propertiesService.getVersions(id);
  }

  // --- Listing Availability Scheduling (#264) ---

  @Post(':id/availability')
  @ApiOperation({ summary: 'Define available slots for a property' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 201, description: 'Availability slots created.' })
  @ApiStandardErrorResponse([400, 401, 404])
  createAvailability(@Param('id') id: string, @Body() dto: CreateAvailabilitySlotsDto) {
    return this.propertiesService.createAvailabilitySlots(id, dto.slots.map(s => ({
      startTime: new Date(s.startTime),
      endTime: new Date(s.endTime),
    })));
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Get available slots for a property' })
  @ApiParam({ name: 'id', description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'List of available slots.' })
  @ApiStandardErrorResponse([400, 401, 404])
  getAvailability(@Param('id') id: string) {
    return this.propertiesService.getAvailability(id);
  }

  @Post('availability/:slotId/reserve')
  @ApiOperation({ summary: 'Reserve an availability slot' })
  @ApiParam({ name: 'slotId', description: 'Slot ID' })
  @ApiResponse({ status: 200, description: 'Slot reserved successfully.' })
  @ApiStandardErrorResponse([400, 401, 404, 409])
  reserveSlot(@Param('slotId') slotId: string, @Request() req) {
    return this.propertiesService.reserveSlot(slotId, req.user.id);
  }
}
