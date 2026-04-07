import { Injectable } from '@nestjs/common';
import { ConversationRole } from '@aws-sdk/client-bedrock-runtime';
import { nowISO } from '../../utils';
import { AiProviderService } from '../ai/ai-provider.service';
import { VideoCallService } from './video-call.service';

@Injectable()
export class VideoCallAiService {
  constructor(
    private readonly ai: AiProviderService,
    private readonly videoCalls: VideoCallService,
  ) {}

  async chatVoiceOnCall(params: {
    userId: string;
    callId: string;
    prompt: string;
    language: string;
  }) {
    const createdAt = nowISO();
    const sessionId = await this.videoCalls.getCallSessionId({
      userId: params.userId,
      callId: params.callId,
    });

    // Load turns by session_id so the model has conversational context.
    const history = await this.videoCalls.listTurnsBySessionId({
      sessionId,
      limit: 60,
    });

    const modelHistory = history.map((x) => ({
      role: (x.role === 'assistant'
        ? ('assistant' as ConversationRole)
        : ('user' as ConversationRole)),
      content: x.content,
    }));

    const replyText = await this.ai.converse({
      language: params.language || 'english',
      history: [
        ...modelHistory,
        { role: 'user' as ConversationRole, content: params.prompt },
      ],
    });

    const { audioBase64, mimeType, audioUrl } =
      await this.ai.textToSpeechAndUpload(replyText);

    // Save 2 turns into InterviewVideoCalls as separate items (sorted by started_at).
    await this.videoCalls.saveTurn({
      userId: params.userId,
      callId: params.callId,
      sessionId,
      role: 'user',
      type: 'text',
      content: params.prompt,
      startedAt: createdAt,
    });
    await this.videoCalls.saveTurn({
      userId: params.userId,
      callId: params.callId,
      sessionId,
      role: 'assistant',
      type: 'audio',
      content: replyText,
      audioUrl,
      startedAt: nowISO(),
    });

    return { reply: replyText, audioBase64, mimeType, audioUrl };
  }
}

