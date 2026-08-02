import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { UserCvService } from './user-cv.service';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
];

const ALLOWED_EXTENSIONS = /\.(pdf|doc|docx|png|jpg|jpeg|webp)$/i;

@Controller('users/me/cvs')
@UseGuards(AuthGuard)
export class UserCvController {
  constructor(private readonly userCvService: UserCvService) {}

  /** POST /users/me/cvs (multipart/form-data field: "file", max 10MB) */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req, file, callback) => {
        const extMatch = ALLOWED_EXTENSIONS.test(file.originalname);
        const mimeMatch = ALLOWED_MIME_TYPES.includes(file.mimetype);
        if (!extMatch && !mimeMatch) {
          return callback(
            new BadRequestException(
              'Invalid file type. Only PDF, DOC, DOCX, PNG, JPEG, and WEBP are allowed.',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async upload(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    const userId = req.user?.sub;
    return this.userCvService.upload(userId, file);
  }

  /** GET /users/me/cvs?limit=50&cursor=... */
  @Get()
  async list(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const userId = req.user?.sub;
    return this.userCvService.list(
      userId,
      limit ? Number(limit) : 50,
      cursor,
    );
  }

  /** GET /users/me/cvs/:id */
  @Get(':id')
  async get(@Request() req: any, @Param('id') id: string) {
    const userId = req.user?.sub;
    return this.userCvService.get(userId, id);
  }

  /** DELETE /users/me/cvs/:id */
  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    const userId = req.user?.sub;
    return this.userCvService.remove(userId, id);
  }

  /** GET /users/me/cvs/:id/download */
  @Get(':id/download')
  async download(
    @Request() req: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const userId = req.user?.sub;
    const fileData = await this.userCvService.downloadCvBuffer(userId, id);
    res.set({
      'Content-Type': fileData.contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileData.filename)}"`,
    });
    res.send(fileData.buffer);
  }
}
