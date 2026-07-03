import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserCvController } from './user-cv.controller';
import { UserCvService } from './user-cv.service';
import { UserCvWorkerController } from './user-cv.worker.controller';
import { CvStatusGateway } from './cv-status.gateway';

@Module({
  imports: [AuthModule],
  controllers: [UserCvController, UserCvWorkerController],
  providers: [UserCvService, CvStatusGateway],
})
export class UserCvModule {}
