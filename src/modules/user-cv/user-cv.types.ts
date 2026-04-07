export type CvProcessingStatus =
  | 'PENDING'
  | 'PARSING'
  | 'AI_PROCESSING'
  | 'DONE'
  | 'FAILED';

export interface UserCv {
  id: string;
  userId: string;
  checksum: string;
  filename: string;
  contentType: string;
  size: number;
  s3Key: string;
  url: string;
  createdAt: string;
  status: CvProcessingStatus;
  score: number | null;
  updatedAt: string;
  error?: string | null;
  parseSource?: string | null;
  rawText?: string | null;
}

