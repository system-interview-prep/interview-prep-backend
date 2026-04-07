export interface JobCategory {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListJobCategoriesResult {
  items: JobCategory[];
  nextCursor?: string;
}

