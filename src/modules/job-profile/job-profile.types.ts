import { JobProfileStatus } from './dto/create-job-profile.dto';

export interface JobProfile {
  id: string;
  title: string;
  categoryId: string;
  keywords: string[];
  description: string;
  requirements: string;
  status: JobProfileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListJobProfilesResult {
  items: JobProfile[];
  nextCursor?: string;
}

