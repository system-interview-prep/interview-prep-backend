import { Module } from '@nestjs/common';
import { JobProfileController } from './job-profile.controller';
import { JobProfileService } from './job-profile.service';
import { JobCategoryModule } from '../job-category/job-category.module';
import { JobProfileWorkerController } from './job-profile.worker.controller';
import { JpStatusGateway } from '../../gateways/jp-status.gateway';

@Module({
  imports: [JobCategoryModule],
  controllers: [JobProfileController, JobProfileWorkerController],
  providers: [JobProfileService, JpStatusGateway],
})
export class JobProfileModule {}

