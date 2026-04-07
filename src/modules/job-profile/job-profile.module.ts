import { Module } from '@nestjs/common';
import { JobProfileController } from './job-profile.controller';
import { JobProfileService } from './job-profile.service';
import { JobCategoryModule } from '../job-category/job-category.module';

@Module({
  imports: [JobCategoryModule],
  controllers: [JobProfileController],
  providers: [JobProfileService],
})
export class JobProfileModule {}

