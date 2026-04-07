import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateJobProfileDto } from './dto/create-job-profile.dto';
import { UpdateJobProfileDto } from './dto/update-job-profile.dto';
import { JobProfileService } from './job-profile.service';

@Controller('admin/job-profiles')
@UseGuards(JwtAuthGuard)
export class JobProfileController {
  constructor(private readonly jobProfileService: JobProfileService) {}

  /** POST /admin/job-profiles */
  @Post()
  async create(@Body() dto: CreateJobProfileDto) {
    return this.jobProfileService.create(dto);
  }

  /** GET /admin/job-profiles?limit=&cursor=&category=&q=&order= */
  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    // preferred param: categoryId. keep `category` as alias for backward compatibility
    @Query('categoryId') categoryId?: string,
    @Query('category') category?: string,
    @Query('q') q?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.jobProfileService.list({
      limit: limit ? Number(limit) : undefined,
      cursor,
      categoryId: categoryId || category,
      q,
      order,
    });
  }

  /** GET /admin/job-profiles/:id */
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.jobProfileService.getById(id);
  }

  /** PATCH /admin/job-profiles/:id */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateJobProfileDto) {
    return this.jobProfileService.update(id, dto);
  }

  /** DELETE /admin/job-profiles/:id */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.jobProfileService.remove(id);
  }
}

