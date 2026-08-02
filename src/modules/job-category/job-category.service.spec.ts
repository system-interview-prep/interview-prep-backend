import { Test, TestingModule } from '@nestjs/testing';
import { JobCategoryService } from './job-category.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

jest.mock('../../config/dynamodb-client', () => ({
  createDynamoDBClient: jest.fn(() => ({
    send: jest.fn(),
  })),
}));

describe('JobCategoryService', () => {
  let service: JobCategoryService;
  let dynamoClientMock: { send: jest.Mock };

  const mockCategoryItem = {
    id: { S: 'cat-123' },
    name: { S: 'Backend Engineering' },
    description: { S: 'Node.js, Go, Java' },
    created_at: { S: '2026-08-02T10:00:00.000Z' },
    updated_at: { S: '2026-08-02T10:00:00.000Z' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobCategoryService],
    }).compile();

    service = module.get<JobCategoryService>(JobCategoryService);
    dynamoClientMock = (service as any).client;
  });

  describe('create', () => {
    it('should throw BadRequestException if name is missing', async () => {
      await expect(service.create({ name: '' })).rejects.toThrow(BadRequestException);
    });

    it('should create a new job category successfully', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.create({
        name: 'Backend Engineering',
        description: 'Node.js, Go, Java',
      });

      expect(result.name).toBe('Backend Engineering');
      expect(result.id).toBeDefined();
    });
  });

  describe('getById', () => {
    it('should return category when item exists', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockCategoryItem });

      const result = await service.getById('cat-123');
      expect(result.id).toBe('cat-123');
      expect(result.name).toBe('Backend Engineering');
    });

    it('should throw NotFoundException when item does not exist', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: null });

      await expect(service.getById('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update job category successfully', async () => {
      // 1. getById -> mockCategoryItem
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockCategoryItem });
      // 2. UpdateItemCommand -> success
      dynamoClientMock.send.mockResolvedValueOnce({});
      // 3. getById after update -> updated item
      dynamoClientMock.send.mockResolvedValueOnce({
        Item: { ...mockCategoryItem, name: { S: 'Updated Category' } },
      });

      const result = await service.update('cat-123', { name: 'Updated Category' });
      expect(result.name).toBe('Updated Category');
    });
  });

  describe('remove', () => {
    it('should remove category when not in use by any job profiles', async () => {
      // 1. getById -> mockCategoryItem
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockCategoryItem });
      // 2. isCategoryInUse -> query returns []
      dynamoClientMock.send.mockResolvedValueOnce({ Items: [] });
      // 3. DeleteItem -> success
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.remove('cat-123');
      expect(result).toEqual({ message: 'Deleted' });
    });

    it('should throw BadRequestException if category is currently in use', async () => {
      // 1. getById -> mockCategoryItem
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockCategoryItem });
      // 2. isCategoryInUse -> query returns existing job profile
      dynamoClientMock.send.mockResolvedValueOnce({ Items: [{ id: { S: 'job-1' } }] });

      await expect(service.remove('cat-123')).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('should return list of job categories with pagination nextCursor', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({
        Items: [mockCategoryItem],
        LastEvaluatedKey: { id: { S: 'cat-123' } },
      });

      const result = await service.list({ limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeDefined();
    });
  });
});
