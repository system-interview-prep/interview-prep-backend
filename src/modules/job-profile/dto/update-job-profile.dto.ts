import { JobProfileStatus } from './create-job-profile.dto';

export interface UpdateJobProfileDto {
  title?: string;
  categoryId?: string;
  keywords?: string[];
  description?: string;
  requirements?: string;
  status?: JobProfileStatus;
}

