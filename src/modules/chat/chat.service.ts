import { Injectable } from '@nestjs/common';
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { nowISO } from '../../utils';
import { AiProviderService } from '../ai/ai-provider.service';
import { ConversationRole } from '@aws-sdk/client-bedrock-runtime';
import { InterviewQuestionsService } from '../interview-questions/interview-questions.service';
import { CHAT_QUESTION_ADVANCE_SYSTEM_PROMPT } from './chat-question-advance.prompt';
import { NEXT_QUESTION_TRANSITION_SYSTEM_PROMPT } from './chat-next-question-transition.prompt';

function safeParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonCandidate(raw: string): string {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) return candidate.slice(start, end + 1).trim();
  return candidate;
}

function buildAckAndAskNext(params: {
  language: string;
  nextQuestionText: string;
}): string {
  const q = (params.nextQuestionText || '').trim();
  const lang = (params.language || 'english').toLowerCase();
  if (lang.includes('viet')) {
    return `Cảm ơn em. Tiếp theo anh muốn hỏi: ${q}`;
  }
  return `Thanks. Next question: ${q}`;
}

function buildClosingMessage(language: string): string {
  const lang = (language || 'english').toLowerCase();
  if (lang.includes('viet')) {
    return 'Cảm ơn em đã chia sẻ. Phần phỏng vấn theo kịch bản kết thúc ở đây. Chúc em một ngày tốt lành!';
  }
  return 'Thank you for your time. This concludes the scripted interview portion. All the best!';
}

function buildInQuestionAnchor(params: {
  order: number;
  questionText: string;
  expectedSignals: string[];
}): string {
  const signals =
    params.expectedSignals?.length > 0
      ? params.expectedSignals.map((s) => `- ${s}`).join('\n')
      : '(none listed)';
  return [
    `CURRENT BANK QUESTION (order ${params.order}):`,
    params.questionText.trim(),
    '',
    'EXPECTED_SIGNALS (cover these before moving on when possible):',
    signals,
    '',
    'You are the INTERVIEWER for THIS question only. Ask follow-ups, clarifications, or short acknowledgements that stay strictly within this topic. Do NOT ask the next bank question yourself; the system will inject it when appropriate. Keep ONE clear focus per reply unless acknowledging briefly.',
  ].join('\n');
}

type HistoryRow = {
  role: ConversationRole;
  content: string;
  timestamp: string;
  question_order?: number;
  kind?: string;
};

@Injectable()
export class ChatService {
  private client: DynamoDBClient;
  private chatTextTableName: string;
  private chatVoiceTableName: string;

  constructor(
    private readonly ai: AiProviderService,
    private readonly interviewQuestions: InterviewQuestionsService,
  ) {
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
    this.chatTextTableName =
      process.env.DYNAMO_CHAT_TEXT_TABLE || 'InterviewChatText';
    this.chatVoiceTableName =
      process.env.DYNAMO_CHAT_VOICE_TABLE || 'InterviewChatVoice';
  }

  async saveTextTurn(params: {
    sessionId: string;
    sender: 'user' | 'assistant';
    content: string;
    createdAt?: string;
    questionOrder?: number;
    kind?: 'opening' | 'question' | 'reply' | 'answer';
    metadata?: Record<string, any>;
  }) {
    const id = uuidv4();
    const createdAt = params.createdAt || nowISO();
    const questionOrder =
      typeof params.questionOrder === 'number' && Number.isFinite(params.questionOrder)
        ? Math.max(1, Math.floor(params.questionOrder))
        : undefined;
    await this.client.send(
      new PutItemCommand({
        TableName: this.chatTextTableName,
        Item: {
          id: { S: id },
          session_id: { S: params.sessionId },
          sender: { S: params.sender },
          type: { S: 'text' },
          content: { S: params.content },
          created_at: { S: createdAt },
          ...(questionOrder !== undefined ? { question_order: { N: String(questionOrder) } } : {}),
          ...(params.kind ? { kind: { S: params.kind } } : {}),
          ...(params.metadata ? { metadata_json: { S: JSON.stringify(params.metadata) } } : {}),
        },
      }),
    );
  }

  async getHistoryMerged(sessionId: string) {
    const query = (tableName: string) =>
      this.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'session_id-index',
          KeyConditionExpression: 'session_id = :sid',
          ExpressionAttributeValues: { ':sid': { S: sessionId } },
        }),
      );

    const [textData, voiceData] = await Promise.all([
      query(this.chatTextTableName),
      query(this.chatVoiceTableName),
    ]);

    const items = [...(textData.Items || []), ...(voiceData.Items || [])].sort(
      (a, b) => a.created_at.S.localeCompare(b.created_at.S),
    );

    return items.map((item) => ({
      role: item.sender.S as ConversationRole,
      content: item.content.S,
      audio_url: item.audio_url?.S || null,
      timestamp: item.created_at.S,
      question_order: item.question_order?.N ? Number(item.question_order.N) : undefined,
      kind: item.kind?.S || undefined,
      metadata: item.metadata_json?.S ? safeParseJson(item.metadata_json.S) : undefined,
    }));
  }

  /**
   * Ensure the chat has an opening interviewer message (contextualized + question #1).
   * If no history exists and a question plan exists, we create & persist the opening as an assistant text turn.
   */
  async ensureOpeningIfEmpty(params: { userId: string; sessionId: string }): Promise<void> {
    const history = await this.getHistoryMerged(params.sessionId);
    if (history.length > 0) return;

    try {
      const opening = await this.interviewQuestions.getOpeningMessage({
        userId: params.userId,
        sessionId: params.sessionId,
      });
      const text = opening?.openingText?.trim();
      if (!text) return;
      await this.saveTextTurn({
        sessionId: params.sessionId,
        sender: 'assistant',
        content: text,
        createdAt: nowISO(),
        kind: 'opening',
        questionOrder: 1,
      });
      await this.interviewQuestions.ensureActiveQuestionOrderDefault({
        userId: params.userId,
        sessionId: params.sessionId,
      });
    } catch {
      // ignore: if questions were not generated, fallback stays on FE side
    }
  }

  private filterThreadForOrder(
    full: HistoryRow[],
    active: number,
  ): HistoryRow[] {
    return full.filter((h) => (h.question_order ?? 0) === active);
  }

  private countUserTurnsInThread(thread: HistoryRow[]): number {
    return thread.filter((h) => h.role === 'user').length;
  }

  private formatThreadForClassifier(thread: HistoryRow[]): string {
    return thread
      .map((h) => {
        const who = h.role === 'assistant' ? 'Interviewer' : 'Candidate';
        return `${who}: ${h.content}`;
      })
      .join('\n');
  }

  private async buildTransitionToNextQuestion(params: {
    language: string;
    thread: HistoryRow[];
    previousQ: {
      question_text: string;
      stage?: string;
      category?: string;
    } | null;
    nextQ: {
      question_text: string;
      stage: string;
      category: string;
      difficulty: string;
    };
  }): Promise<string> {
    const lang = (params.language || 'english').toLowerCase();
    const outputLanguage = lang.includes('viet') ? 'Vietnamese' : 'English';
    const payload = {
      outputLanguage,
      priorThread: this.formatThreadForClassifier(params.thread),
      previousBankQuestion: params.previousQ?.question_text?.trim() || '',
      nextBankQuestion: params.nextQ.question_text.trim(),
      nextMeta: {
        stage: params.nextQ.stage || '',
        category: params.nextQ.category || '',
        difficulty: params.nextQ.difficulty || '',
      },
    };
    try {
      const raw = await this.ai.converseWithSystem({
        systemPrompts: [NEXT_QUESTION_TRANSITION_SYSTEM_PROMPT],
        userText: JSON.stringify(payload),
        maxTokens: 768,
      });
      const text = (raw || '').trim();
      if (text.length > 0) return text;
    } catch {
      /* fallback below */
    }
    return buildAckAndAskNext({
      language: params.language || 'english',
      nextQuestionText: params.nextQ.question_text.trim(),
    });
  }

  private async classifyAdvance(params: {
    language: string;
    activeOrder: number;
    scriptedQuestion: {
      question_text: string;
      expected_signals: string[];
    } | null;
    thread: HistoryRow[];
  }): Promise<boolean> {
    if (!params.scriptedQuestion?.question_text?.trim()) return false;

    const userTurns = this.countUserTurnsInThread(params.thread);
    const payload = {
      activeQuestionOrder: params.activeOrder,
      userTurnsInQuestion: userTurns,
      scriptedQuestion: params.scriptedQuestion.question_text.trim(),
      expectedSignals: params.scriptedQuestion.expected_signals || [],
      transcript: this.formatThreadForClassifier(params.thread),
    };

    try {
      const raw = await this.ai.converseWithSystem({
        systemPrompts: [CHAT_QUESTION_ADVANCE_SYSTEM_PROMPT],
        userText: JSON.stringify(payload),
        maxTokens: 400,
      });
      const parsed = safeParseJson(extractJsonCandidate(raw));
      if (!parsed || typeof parsed !== 'object') return false;
      return Boolean(parsed.advance);
    } catch {
      return false;
    }
  }

  async chat(params: {
    userId: string;
    sessionId: string;
    prompt: string;
    language: string;
  }) {
    const plan = await this.interviewQuestions.getExistingPlan({
      userId: params.userId,
      sessionId: params.sessionId,
    });

    if (!plan) {
      const now = nowISO();
      await this.saveTextTurn({
        sessionId: params.sessionId,
        sender: 'user',
        content: params.prompt,
        createdAt: now,
        kind: 'answer',
      });
      const history = await this.getHistoryMerged(params.sessionId);
      const reply = await this.ai.converse({
        language: params.language || 'english',
        history: history.map((h) => ({
          role: h.role as ConversationRole,
          content: h.content,
        })),
      });
      await this.saveTextTurn({
        sessionId: params.sessionId,
        sender: 'assistant',
        content: reply,
        createdAt: nowISO(),
        kind: 'reply',
      });
      return reply;
    }

    let active = await this.interviewQuestions.getActiveQuestionOrder({
      userId: params.userId,
      sessionId: params.sessionId,
    });

    const now = nowISO();
    await this.saveTextTurn({
      sessionId: params.sessionId,
      sender: 'user',
      content: params.prompt,
      createdAt: now,
      questionOrder: active,
      kind: 'answer',
    });

    const fullHistory = (await this.getHistoryMerged(
      params.sessionId,
    )) as HistoryRow[];
    const thread = this.filterThreadForOrder(fullHistory, active);
    const currentQ = await this.interviewQuestions.getQuestionByOrder({
      sessionId: params.sessionId,
      order: active,
    });

    const shouldAdvance = await this.classifyAdvance({
      language: params.language || 'english',
      activeOrder: active,
      scriptedQuestion: currentQ
        ? {
            question_text: currentQ.question_text,
            expected_signals: currentQ.expected_signals || [],
          }
        : null,
      thread,
    });

    if (shouldAdvance) {
      const newOrder = active + 1;
      const nextQ = await this.interviewQuestions.getQuestionByOrder({
        sessionId: params.sessionId,
        order: newOrder,
      });

      if (nextQ?.question_text?.trim()) {
        await this.interviewQuestions.setActiveQuestionOrder({
          userId: params.userId,
          sessionId: params.sessionId,
          order: newOrder,
        });
        const text = await this.buildTransitionToNextQuestion({
          language: params.language || 'english',
          thread,
          previousQ: currentQ
            ? {
                question_text: currentQ.question_text,
                stage: currentQ.stage,
                category: currentQ.category,
              }
            : null,
          nextQ: {
            question_text: nextQ.question_text.trim(),
            stage: nextQ.stage,
            category: nextQ.category,
            difficulty: nextQ.difficulty,
          },
        });
        await this.saveTextTurn({
          sessionId: params.sessionId,
          sender: 'assistant',
          content: text,
          createdAt: nowISO(),
          kind: 'question',
          questionOrder: newOrder,
          metadata: {
            stage: nextQ.stage,
            category: nextQ.category,
            difficulty: nextQ.difficulty,
          },
        });
        return text;
      }

      const closing = buildClosingMessage(params.language || 'english');
      await this.saveTextTurn({
        sessionId: params.sessionId,
        sender: 'assistant',
        content: closing,
        createdAt: nowISO(),
        kind: 'reply',
        questionOrder: active,
      });
      return closing;
    }

    const anchor = currentQ?.question_text?.trim()
      ? buildInQuestionAnchor({
          order: active,
          questionText: currentQ.question_text,
          expectedSignals: currentQ.expected_signals || [],
        })
      : '';

    const threadForLlm = thread.map((h) => ({
      role: h.role as ConversationRole,
      content: h.content,
    }));

    const reply = await this.ai.converse({
      language: params.language || 'english',
      history: threadForLlm,
      extraSystemContext: anchor || undefined,
    });

    await this.saveTextTurn({
      sessionId: params.sessionId,
      sender: 'assistant',
      content: reply,
      createdAt: nowISO(),
      kind: 'reply',
      questionOrder: active,
    });

    return reply;
  }
}
