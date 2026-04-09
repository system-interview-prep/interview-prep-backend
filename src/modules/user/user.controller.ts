import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/** Payload từ JWT (AuthService.signAsync) */
interface JwtUserPayload {
  sub: string;
  email: string;
  role: string;
}

@Controller('user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  /** GET /user/profile */
  @Get('profile')
  @UseGuards(AuthGuard)
  async getProfile(@CurrentUser() user: JwtUserPayload) {
    return this.userService.getProfile(user.email, user.sub);
  }

  /** PATCH /user/profile — cho phép: name, dob (ảnh dùng POST /user/profile/picture) */
  @Patch('profile')
  @UseGuards(AuthGuard)
  async updateProfile(
    @CurrentUser() user: JwtUserPayload,
    @Body() updateDto: Record<string, any>,
  ) {
    return this.userService.updateProfile(user.email, user.sub, updateDto);
  }

  /** POST /user/profile/picture — multipart: `file` hoặc `picture` (jpeg/png/gif/webp, tối đa 5MB) */
  @Post('profile/picture')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'picture', maxCount: 1 },
      ],
      { limits: { fileSize: 5 * 1024 * 1024 } },
    ),
  )
  async uploadProfilePicture(
    @CurrentUser() user: JwtUserPayload,
    @UploadedFiles()
    files: { file?: Express.Multer.File[]; picture?: Express.Multer.File[] },
  ) {
    const file = files?.file?.[0] ?? files?.picture?.[0];
    this.logger.log(
      `uploadProfilePicture: email=${user?.email} hasFile=${!!file?.buffer?.length}`,
    );
    return this.userService.uploadProfilePicture(user.email, user.sub, file);
  }
}
