import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { UserCvService } from './user-cv.service';

@Controller('users/me/cvs')
@UseGuards(AuthGuard)
export class UserCvController {
  constructor(private readonly userCvService: UserCvService) {}

  /** POST /users/me/cvs (multipart/form-data field: "file") */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    const userId = req.user?.sub;
    return this.userCvService.upload(userId, file);
  }

  /** GET /users/me/cvs */
  @Get()
  async list(@Request() req: any, @Query('limit') limit?: string) {
    const userId = req.user?.sub;
    return this.userCvService.list(userId, limit ? Number(limit) : 50);
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
}

