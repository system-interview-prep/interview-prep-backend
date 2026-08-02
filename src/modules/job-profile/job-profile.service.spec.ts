import { Test, TestingModule } from '@nestjs/testing';
import { JobProfileService } from './job-profile.service';
import { JobCategoryService } from '../job-category/job-category.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { S3Util } from '../../utils/s3.util';
import { RabbitMqUtil } from '../../utils/rabbitmq.util';

jest.mock('../../utils/s3.util');
jest.mock('../../utils/rabbitmq.util');
jest.mock('../../config/dynamodb-client', () => ({
  createDynamoDBClient: jest.fn(() => ({
    send: jest.fn(),
  })),
}));

describe('JobProfileService', () => {
  let service: JobProfileService;
  let jobCategoryServiceMock: jest.Mocked<JobCategoryService>;
  let dynamoClientMock: { send: jest.Mock };

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'jd.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('mock jd pdf content'),
    size: 19,
  } as Express.Multer.File;

  const mockUploadItem = {
    id: { S: 'upload-123' },
    item_type: { S: 'JP_UPLOAD' },
    owner_user_id: { S: 'admin-123' },
    filename: { S: 'jd.pdf' },
    content_type: { S: 'application/pdf' },
    size: { N: '19' },
    s3_key: { S: 'jps/admin-123/upload-123/jd.pdf' },
    url: { S: 'https://s3.example.com/jd.pdf' },
    status: { S: 'DONE' },
    created_at: { S: '2026-08-02T10:00:00.000Z' },
    ai_profile_ui_json: { S: JSON.stringify({ level: { label: 'Level', value: 'Senior' } }) },
  };

  const mockJobProfileItem = {
    id: { S: 'jp-123' },
    title: { S: 'Senior Backend Engineer' },
    category_id: { S: 'cat-123' },
    description: { S: 'Job description text' },
    status: { S: 'ACTIVE' },
    created_at: { S: '2026-08-02T10:00:00.000Z' },
    updated_at: { S: '2026-08-02T10:00:00.000Z' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    (S3Util as jest.Mock).mockImplementation(() => ({
      buildJpKey: jest.fn().mockReturnValue('jps/admin-123/upload-123/jd.pdf'),
      uploadBuffer: jest.fn().mockResolvedValue({
        key: 'jps/admin-123/upload-123/jd.pdf',
        url: 'https://s3.example.com/jd.pdf',
      }),
    }));

    (RabbitMqUtil as jest.Mock).mockImplementation(() => ({
      sendJson: jest.fn().mockResolvedValue(true),
    }));

    const mockCategoryService = {
      getById: jest.fn().mockResolvedValue({ id: 'cat-123', name: 'Backend' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobProfileService,
        { provide: JobCategoryService, useValue: mockCategoryService },
      ],
    }).compile();

    service = module.get<JobProfileService>(JobProfileService);
    jobCategoryServiceMock = module.get(JobCategoryService);
    dynamoClientMock = (service as any).client;
  });

  describe('uploadJpFile', () => {
    it('should throw BadRequestException if userId or file is missing', async () => {
      await expect(service.uploadJpFile('', mockFile)).rejects.toThrow(BadRequestException);
      await expect(service.uploadJpFile('admin-123', null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should upload file to S3 and save to DynamoDB successfully', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.uploadJpFile('admin-123', mockFile);
      expect(result.filename).toBe('jd.pdf');
      expect(result.status).toBe('PENDING');
    });
  });

  describe('getJpUpload', () => {
    it('should return upload domain when item exists and belongs to user', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockUploadItem });

      const result = await service.getJpUpload('admin-123', 'upload-123');
      expect(result.id).toBe('upload-123');
      expect(result.status).toBe('DONE');
    });

    it('should throw NotFoundException when item does not exist or user mismatch', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: null });

      await expect(service.getJpUpload('admin-123', 'non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('finalizeUploadToJobProfile', () => {
    it('should throw BadRequestException if title or categoryId is missing', async () => {
      await expect(
        service.finalizeUploadToJobProfile({
          userId: 'admin-123',
          uploadId: 'upload-123',
          title: '',
          categoryId: 'cat-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should finalize upload into JobProfile successfully', async () => {
      // 1. getJpUpload -> mockUploadItem
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockUploadItem });
      // 2. category getById -> resolved by mock
      // 3. UpdateItemCommand -> success
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.finalizeUploadToJobProfile({
        userId: 'admin-123',
        uploadId: 'upload-123',
        title: 'Senior Backend Engineer',
        categoryId: 'cat-123',
      });

      expect(result.id).toBe('upload-123');
    });
  });

  describe('getById', () => {
    it('should return JobProfile when item exists', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockJobProfileItem });

      const result = await service.getById('jp-123');
      expect(result.id).toBe('jp-123');
      expect(result.title).toBe('Senior Backend Engineer');
    });

    it('should throw NotFoundException when item missing', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: null });

      await expect(service.getById('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete JobProfile from DynamoDB', async () => {
      // 1. getById -> mockJobProfileItem
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockJobProfileItem });
      // 2. DeleteItem -> success
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.remove('jp-123');
      expect(result).toEqual({ message: 'Deleted' });
    });
  });
});
