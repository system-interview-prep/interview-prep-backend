import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiProviderService } from './ai-provider.service';

describe('AiController', () => {
  let controller: AiController;
  let aiService: jest.Mocked<AiProviderService>;

  beforeEach(async () => {
    const mockAiService = {
      createSimliSession: jest.fn(),
      getSimliIceServers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [{ provide: AiProviderService, useValue: mockAiService }],
    }).compile();

    controller = module.get<AiController>(AiController);
    aiService = module.get(AiProviderService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createAvatarSession', () => {
    it('should return session_token on success', async () => {
      aiService.createSimliSession.mockResolvedValue('mock-session-token');

      const result = await controller.createAvatarSession('face-id-123');
      expect(result).toEqual({ session_token: 'mock-session-token' });
      expect(aiService.createSimliSession).toHaveBeenCalledWith('face-id-123');
    });

    it('should return error object on failure', async () => {
      aiService.createSimliSession.mockRejectedValue(new Error('Avatar API Error'));

      const result = await controller.createAvatarSession();
      expect(result).toEqual({ error: 'Avatar API Error' });
    });
  });

  describe('getAvatarIceServers', () => {
    it('should return iceServers on success', async () => {
      const mockIceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
      aiService.getSimliIceServers.mockResolvedValue(mockIceServers);

      const result = await controller.getAvatarIceServers();
      expect(result).toEqual({ iceServers: mockIceServers });
    });

    it('should return fallback stun server on failure', async () => {
      aiService.getSimliIceServers.mockRejectedValue(new Error('ICE Fetch Failed'));

      const result = await controller.getAvatarIceServers();
      expect(result).toEqual({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
    });
  });
});
