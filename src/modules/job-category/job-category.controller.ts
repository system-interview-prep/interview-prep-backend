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
import { CreateJobCategoryDto } from './dto/create-job-category.dto';
import { UpdateJobCategoryDto } from './dto/update-job-category.dto';
import { JobCategoryService } from './job-category.service';

@Controller('admin/job-categories')
@UseGuards(JwtAuthGuard)
export class JobCategoryController {
  constructor(private readonly jobCategoryService: JobCategoryService) {}

  /** POST /admin/job-categories */
  @Post()
  async create(@Body() dto: CreateJobCategoryDto) {
    return this.jobCategoryService.create(dto);
  }

  /** GET /admin/job-categories?limit=&cursor=&q= */
  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
  ) {
    return this.jobCategoryService.list({
      limit: limit ? Number(limit) : undefined,
      cursor,
      q,
    });
  }

  /** GET /admin/job-categories/:id */
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.jobCategoryService.getById(id);
  }

  /** PATCH /admin/job-categories/:id */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateJobCategoryDto) {
    return this.jobCategoryService.update(id, dto);
  }

  /** DELETE /admin/job-categories/:id */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.jobCategoryService.remove(id);
  }
}

