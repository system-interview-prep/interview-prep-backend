import { Test, TestingModule } from '@nestjs/testing';
import { UserCvService } from './user-cv.service';
import { BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { S3Util } from '../../utils/s3.util';
import { RabbitMqUtil } from '../../utils/rabbitmq.util';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';

jest.mock('../../utils/s3.util');
jest.mock('../../utils/rabbitmq.util');
jest.mock('../../config/dynamodb-client', () => ({
  createDynamoDBClient: jest.fn(() => ({
    send: jest.fn(),
  })),
}));

describe('UserCvService', () => {
  let service: UserCvService;
  let dynamoClientMock: { send: jest.Mock };

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'resume.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('mock pdf content'),
    size: 16,
  } as Express.Multer.File;

  const mockUserCvItem = {
    id: { S: 'cv-123' },
    user_id: { S: 'user-456' },
    checksum: { S: 'checksum-hash' },
    filename: { S: 'resume.pdf' },
    content_type: { S: 'application/pdf' },
    size: { N: '16' },
    s3_key: { S: 'cvs/user-456/cv-123/resume.pdf' },
    url: { S: 'https://s3.example.com/cv.pdf' },
    created_at: { S: '2026-08-02T10:00:00.000Z' },
    status: { S: 'PENDING' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    (S3Util as jest.Mock).mockImplementation(() => ({
      buildCvKey: jest.fn().mockReturnValue('cvs/user-456/cv-123/resume.pdf'),
      uploadBuffer: jest.fn().mockResolvedValue({
        key: 'cvs/user-456/cv-123/resume.pdf',
        url: 'https://s3.example.com/cv.pdf',
      }),
      deleteObject: jest.fn().mockResolvedValue(true),
      getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('s3 buffer content')),
    }));

    (RabbitMqUtil as jest.Mock).mockImplementation(() => ({
      sendJson: jest.fn().mockResolvedValue(true),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserCvService],
    }).compile();

    service = module.get<UserCvService>(UserCvService);
    dynamoClientMock = (service as any).client;
  });

  describe('upload', () => {
    it('should throw BadRequestException if userId or file is missing', async () => {
      await expect(service.upload('', mockFile)).rejects.toThrow(BadRequestException);
      await expect(service.upload('user-456', null as any)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for unsupported file MIME type', async () => {
      const invalidFile = { ...mockFile, originalname: 'script.sh', mimetype: 'text/x-shellscript' };
      await expect(service.upload('user-456', invalidFile)).rejects.toThrow(BadRequestException);
    });

    it('should return existing CV if file checksum already exists for user', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Items: [mockUserCvItem] });

      const result = await service.upload('user-456', mockFile);
      expect(result.id).toBe('cv-123');
      expect(result.userId).toBe('user-456');
    });

    it('should upload to S3 and save to DynamoDB successfully', async () => {
      // 1. findByChecksum -> null
      dynamoClientMock.send.mockResolvedValueOnce({ Items: [] });
      // 2. PutItem or TransactWrite -> success
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.upload('user-456', mockFile);

      expect(result.filename).toBe('resume.pdf');
      expect(result.status).toBe('PENDING');
    });

    it('should handle transaction rollback on duplicate checksum race condition', async () => {
      (service as any).dedupeEnabled = true;
      (service as any).dedupeTableName = 'UserCvDedupe';

      // 1. findByChecksum -> null
      dynamoClientMock.send.mockResolvedValueOnce({ Items: [] });

      // 2. TransactWrite -> TransactionCanceledException
      const txError = Object.create(TransactionCanceledException.prototype);
      txError.name = 'TransactionCanceledException';
      txError.message = 'Transaction cancelled';
      txError.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }];
      dynamoClientMock.send.mockRejectedValueOnce(txError);

      // 3. getDedupeCvId -> { Item: { cv_id: { S: 'cv-123' } } }
      dynamoClientMock.send.mockResolvedValueOnce({ Item: { cv_id: { S: 'cv-123' } } });
      // 4. get(userId, 'cv-123') -> { Item: mockUserCvItem }
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockUserCvItem });

      const result = await service.upload('user-456', mockFile);
      expect(result.id).toBe('cv-123');
    });
  });

  describe('list', () => {
    it('should query user CVs with pagination cursor support', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({
        Items: [mockUserCvItem],
        LastEvaluatedKey: { user_id: { S: 'user-456' }, id: { S: 'cv-123' } },
      });

      const result = await service.list('user-456', 10);
      expect(result.items).toHaveLength(1);
      expect(result.nextToken).toBeDefined();
    });

    it('should throw BadRequestException if pagination cursor is invalid base64', async () => {
      await expect(service.list('user-456', 10, 'invalid-cursor!!!')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('get', () => {
    it('should return UserCv when item exists', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockUserCvItem });

      const result = await service.get('user-456', 'cv-123');
      expect(result.id).toBe('cv-123');
    });

    it('should throw NotFoundException when item does not exist', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: null });

      await expect(service.get('user-456', 'non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete CV from S3 and DynamoDB', async () => {
      // 1. get -> mockUserCvItem
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockUserCvItem });
      // 2. DeleteItem -> success
      dynamoClientMock.send.mockResolvedValueOnce({});
      // 3. Dedupe DeleteItem -> success
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.remove('user-456', 'cv-123');
      expect(result).toEqual({ message: 'Deleted' });
    });
  });

  describe('downloadCvBuffer', () => {
    it('should return file buffer from S3', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockUserCvItem });

      const result = await service.downloadCvBuffer('user-456', 'cv-123');
      expect(result.filename).toBe('resume.pdf');
      expect(result.buffer.toString()).toBe('s3 buffer content');
    });
  });
});
