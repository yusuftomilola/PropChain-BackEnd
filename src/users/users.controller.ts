import { Controller, Get, Post, Body, Param, Put, Delete, Res, HttpStatus, NotFoundException, UseGuards, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUserPayload } from '../auth/types/auth-user.type';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/export')
  async exportData(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    // Check authorization: User can only export their own data, or must be an ADMIN
    if (user.sub !== id && user.role !== 'ADMIN') {
      throw new ForbiddenException('You are not authorized to export this user\'s data');
    }

    try {
      const exportData = await this.usersService.exportPersonalData(id);
      
      // Ensure exports directory exists
      const exportsDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir);
      }

      const filename = `export-${id}-${crypto.randomUUID()}.json`;
      const filepath = path.join(exportsDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));

      return {
        message: 'Export generated successfully',
        downloadLink: `/users/export/download/${filename}`,
        expiresIn: '24 hours',
      };
    } catch (error) {
      if (error.message === 'User not found') {
        throw new NotFoundException(error.message);
      }
      throw new InternalServerErrorException('Failed to generate export');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('export/download/:filename')
  async downloadExport(
    @Param('filename') filename: string,
    @Res() res: Response,
    @CurrentUser() user: AuthUserPayload,
  ) {
    const filepath = path.join(process.cwd(), 'exports', filename);

    if (!fs.existsSync(filepath)) {
      throw new NotFoundException('Export file not found');
    }

    // Authorization check for the filename: export-{userId}-{uuid}.json
    const filenameParts = filename.split('-');
    const ownerId = filenameParts[1];

    if (user.sub !== ownerId && user.role !== 'ADMIN') {
      throw new ForbiddenException('You are not authorized to download this export');
    }

    res.download(filepath, (err) => {
      if (err) {
        if (!res.headersSent) {
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
            message: 'Error downloading file',
            error: err.message,
          });
        }
      }
    });
  }
}
