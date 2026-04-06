import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

dotenv.config();

export class S3Util {
  private s3Client: S3Client;
  private bucketName: string;

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
}
