import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { InterviewQuestionsService } from '../interview-questions/interview-questions.service';

jest.mock('../../config/dynamodb-client', () => ({
  createDynamoDBClient: jest.fn(() => ({
    send: jest.fn(),
  })),
}));

describe('ChatService', () => {
  let service: ChatService;
  let dynamoClientMock: { send: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockAi = { converse: jest.fn() };
    const mockIQ = {
      getExistingPlan: jest.fn(),
      getActiveQuestionOrder: jest.fn().mockResolvedValue(1),
      setActiveQuestionOrder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: AiProviderService, useValue: mockAi },
        { provide: InterviewQuestionsService, useValue: mockIQ },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    dynamoClientMock = (service as any).client;
  });

  describe('saveTextTurn', () => {
    it('should save a text chat turn successfully', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({});

      await service.saveTextTurn({
        sessionId: 'sess-123',
        sender: 'user',
        content: 'Dạ em xin chào anh.',
        questionOrder: 1,
      });

      expect(dynamoClientMock.send).toHaveBeenCalled();
    });
  });

  describe('getHistoryMerged', () => {
    it('should return merged history from chat text and voice tables', async () => {
      // 1. chatText query
      dynamoClientMock.send.mockResolvedValueOnce({
        Items: [
          {
            sender: { S: 'user' },
            content: { S: 'Xin chào anh' },
            created_at: { S: '2026-08-02T10:00:00.000Z' },
          },
        ],
      });
      // 2. chatVoice query
      dynamoClientMock.send.mockResolvedValueOnce({ Items: [] });

      const history = await service.getHistoryMerged('sess-123');
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Xin chào anh');
    });
  });
});
