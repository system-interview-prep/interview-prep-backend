import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { JobProfileService } from './job-profile.service';

@Controller('admin/job-profiles')
@UseGuards(AuthGuard)
export class JobProfileController {
  constructor(private readonly jobProfileService: JobProfileService) {}

  /** POST /admin/job-profiles/uploads (multipart/form-data field: "file") */
  @Post('uploads')
  @UseInterceptors(FileInterceptor('file'))
  async uploadJd(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    const userId = String(req.user?.sub || '').trim();
    return this.jobProfileService.uploadJpFile(userId, file);
  }
 
  @Get('uploads/:id')
  async getUpload(@Request() req: any, @Param('id') id: string) {
    const userId = String(req.user?.sub || '').trim();
    return this.jobProfileService.getJpUpload(userId, id);
  }

  /**
   * PATCH /admin/job-profiles/uploads/:id
   * Body: { aiProfileUiJson?, aiExtrasJson? } (objects)
   * Allows admin to review/edit AI parsed results before finalize.
   */
  @Patch('uploads/:id')
  async patchUpload(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      aiProfileUiJson?: Record<string, any> | null;
      aiExtrasJson?: Record<string, any> | null;
    },
  ) {
    const userId = String(req.user?.sub || '').trim();
    await this.jobProfileService.updateJpUploadProcessing({
      userId,
      uploadId: id,
      aiProfileUiJson: body?.aiProfileUiJson,
      aiExtrasJson: body?.aiExtrasJson,
    });
    return this.jobProfileService.getJpUpload(userId, id);
  }

  /** POST /admin/job-profiles/uploads/:id/finalize */
  @Post('uploads/:id/finalize')
  async finalizeUpload(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      title: string;
      categoryId: string;
      keywords?: string[];
      status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
      description?: string;
    },
  ) {
    const userId = String(req.user?.sub || '').trim();
    return this.jobProfileService.finalizeUploadToJobProfile({
      userId,
      uploadId: id,
      title: body?.title,
      categoryId: body?.categoryId,
      keywords: body?.keywords,
      status: body?.status,
      description: body?.description,
    });
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

  /**
   * PATCH /admin/job-profiles/:id
   * Body: { description }
   */
  @Patch(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { description?: string | null },
  ) {
    const userId = String(req.user?.sub || '').trim();
    await this.jobProfileService.updateDescription({
      userId,
      jobId: id,
      description: String(body?.description || ''),
    });
    return this.jobProfileService.getById(id);
  }

  /** DELETE /admin/job-profiles/:id */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.jobProfileService.remove(id);
  }
}

