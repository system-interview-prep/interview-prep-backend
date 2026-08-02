import { Test, TestingModule } from '@nestjs/testing';
import { InterviewQuestionsService } from './interview-questions.service';
import { AiProviderService } from '../ai/ai-provider.service';
import { SessionsService } from '../sessions/sessions.service';

jest.mock('../../config/dynamodb-client', () => ({
  createDynamoDBClient: jest.fn(() => ({
    send: jest.fn(),
  })),
}));

describe('InterviewQuestionsService', () => {
  let service: InterviewQuestionsService;
  let dynamoClientMock: { send: jest.Mock };

  const mockPlanItem = {
    session_id: { S: 'sess-123' },
    user_id: { S: 'user-123' },
    candidate_id: { S: 'cv-123' },
    job_id: { S: 'job-123' },
    language: { S: 'Vietnamese' },
    created_at: { S: '2026-08-02T10:00:00.000Z' },
    version: { S: '1.0' },
    opening_text: { S: 'Chào em, hôm nay anh sẽ phỏng vấn em.' },
    active_question_order: { N: '1' },
    plan_json: {
      S: JSON.stringify([
        {
          order: 1,
          topic: 'Architecture',
          question_text: 'Em hãy trình bày kiến thức về Microservices.',
          expected_signals: ['Decoupled', 'Event-driven'],
        },
      ]),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockAi = { converse: jest.fn() };
    const mockSessions = { getType: jest.fn().mockResolvedValue('Chat') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterviewQuestionsService,
        { provide: AiProviderService, useValue: mockAi },
        { provide: SessionsService, useValue: mockSessions },
      ],
    }).compile();

    service = module.get<InterviewQuestionsService>(InterviewQuestionsService);
    dynamoClientMock = (service as any).client;
  });

  describe('getExistingPlan', () => {
    it('should return plan object when plan exists in DynamoDB', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockPlanItem });

      const plan = await service.getExistingPlan({ userId: 'user-123', sessionId: 'sess-123' });
      expect(plan).not.toBeNull();
      expect(plan?.sessionId).toBe('sess-123');
      expect(plan?.openingText).toBe('Chào em, hôm nay anh sẽ phỏng vấn em.');
    });

    it('should return null if user does not match or plan missing', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: null });

      const plan = await service.getExistingPlan({ userId: 'user-123', sessionId: 'invalid' });
      expect(plan).toBeNull();
    });
  });

  describe('getActiveQuestionOrder', () => {
    it('should return active question order', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({ Item: mockPlanItem });

      const order = await service.getActiveQuestionOrder({
        userId: 'user-123',
        sessionId: 'sess-123',
      });
      expect(order).toBe(1);
    });
  });

  describe('setActiveQuestionOrder', () => {
    it('should update active question order in DynamoDB', async () => {
      dynamoClientMock.send.mockResolvedValueOnce({});

      await service.setActiveQuestionOrder({
        userId: 'user-123',
        sessionId: 'sess-123',
        order: 2,
      });
      expect(dynamoClientMock.send).toHaveBeenCalled();
    });
  });
});
