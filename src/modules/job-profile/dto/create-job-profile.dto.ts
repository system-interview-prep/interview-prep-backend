export type JobProfileStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

export interface CreateJobProfileDto {
  title: string;
  categoryId: string;
  keywords?: string[];
  description?: string;
  requirements?: string;
  status?: JobProfileStatus;
}

