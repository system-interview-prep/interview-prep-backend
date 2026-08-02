import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from './sessions.service';

jest.mock('../../config/dynamodb-client', () => ({
  createDynamoDBClient: jest.fn(() => ({
    send: jest.fn(),
  })),
}));

describe('SessionsService', () => {
  let service: SessionsService;
  let dynamoClientMock: { send: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionsService],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
    dynamoClientMock = (service as any).client;
  });

  describe('create', () => {
    it('should create an interview session successfully', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.create({
        userId: 'user-123',
        type: 'Chat',
        language: 'Vietnamese',
      });

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
    });
  });

  describe('listByUser', () => {
    it('should list sessions by userId', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({
        Items: [
          {
            id: { S: 'sess-123' },
            type: { S: 'Chat' },
            language: { S: 'Vietnamese' },
            status: { S: 'Open' },
            started_at: { S: '2026-08-02T10:00:00.000Z' },
          },
        ],
      });

      const list = await service.listByUser('user-123');
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('sess-123');
      expect(list[0].type).toBe('Chat');
    });
  });

  describe('getType', () => {
    it('should return session type when user owns the session', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({
        Item: {
          user_id: { S: 'user-123' },
          type: { S: 'Chat' },
        },
      });

      const type = await service.getType({ userId: 'user-123', sessionId: 'sess-123' });
      expect(type).toBe('Chat');
    });

    it('should return null if user does not own session or session missing', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: null });

      const type = await service.getType({ userId: 'user-123', sessionId: 'invalid' });
      expect(type).toBeNull();
    });
  });

  describe('close', () => {
    it('should close an interview session successfully', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({});

      const result = await service.close({ userId: 'user-123', sessionId: 'sess-123' });
      expect(result.sessionId).toBe('sess-123');
      expect(result.status).toBe('Closed');
    });
  });
});
