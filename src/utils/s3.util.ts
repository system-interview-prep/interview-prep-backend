import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

dotenv.config();

export class S3Util {
  private s3Client: S3Client;
  private bucketName: string;
  private baseFolder: string;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    // Lấy tên bucket từ biến môi trường
    this.bucketName = process.env.AWS_S3_BUCKET || 'interview-prep-audio';
    // Backward compatible env naming:
    // - AWS_S3_BUCKET_FOLDER (existing .env)
    // - AWS_S3_FOLDER (new)
    const folder =
      process.env.AWS_S3_BUCKET_FOLDER ||
      process.env.AWS_S3_FOLDER ||
      'chunks';
    this.baseFolder = String(folder).replace(/^\/+|\/+$/g, '');
  }

  /**
   * Upload file base64 audio lên S3 và cấu hình public URL
   */
  async uploadAudioBase64(base64Data: string, mimeType: string): Promise<string> {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const fileKey = `audios/${uuidv4()}.wav`; // Giả sử định dạng wav/pcm

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: mimeType,
      });

      await this.s3Client.send(command);

      // Tạo URL thủ công cấu trúc của S3 để trả về
      const region = process.env.AWS_REGION || 'us-east-1';
      return `https://${this.bucketName}.s3.${region}.amazonaws.com/${fileKey}`;
    } catch (error) {
      console.error('Lỗi quá trình upload lên S3:', error);
      return ''; // Nếu hỏng S3, trả về link rỗng để không crash Chat
    }
  }

  async uploadBuffer(params: {
    key: string;
    buffer: Buffer;
    contentType?: string;
  }): Promise<{ key: string; url: string }> {
    const key = params.key.replace(/^\/+/, '');
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: params.buffer,
      ContentType: params.contentType,
    });
    await this.s3Client.send(command);
    const region = process.env.AWS_REGION || 'us-east-1';
    return {
      key,
      url: `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`,
    };
  }

  /** `{baseFolder}/avatars/{userId}/{uuid}.{ext}` */
  buildAvatarKey(userId: string, mimeType: string): string {
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    const ext = extMap[mimeType] || 'jpg';
    return `${this.baseFolder}/avatars/${userId}/${uuidv4()}.${ext}`;
  }

  buildCvKey(userId: string, cvId: string, filename: string): string {
    const safeFilename = (filename || 'cv')
      .replace(/[/\\]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return `${this.baseFolder}/cvs/${userId}/${cvId}/${safeFilename}`;
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key.replace(/^\/+/, ''),
    });
    await this.s3Client.send(command);
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key.replace(/^\/+/, ''),
      }),
    );
    const body: any = res.Body;
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body?.transformToByteArray) {
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }
    if (body?.[Symbol.asyncIterator]) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    return Buffer.alloc(0);
  }
}

