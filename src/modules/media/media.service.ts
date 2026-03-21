import { Injectable } from '@nestjs/common';

/**
 * MediaService – handles video/audio recording uploads.
 * TODO: Upload to S3 / Cloudflare R2 via @aws-sdk/client-s3.
 */
@Injectable()
export class MediaService {
  async handleUpload(file: Express.Multer.File): Promise<{ url: string; filename: string }> {
    // TODO: upload file.buffer to cloud storage and return URL
    console.log('Received file:', file?.originalname, file?.size);
    return {
      url: `https://placeholder-storage.example.com/${file?.originalname}`,
      filename: file?.originalname,
    };
  }
}
