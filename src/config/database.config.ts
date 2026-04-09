/**
 * database.config.ts
 * Centralizes DynamoDB configuration values.
 * Import this wherever DynamoDB client initialization is needed.
 */
export const databaseConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  tables: {
    /** Interview session metadata (user_id, type, language, status, …) */
    sessions: process.env.DYNAMO_SESSIONS_TABLE || 'InterviewSessions',
    /** Text-only chat turns (REST /chat, Socket text-only) */
    chatText: process.env.DYNAMO_CHAT_TEXT_TABLE || 'InterviewChatText',
    /** Voice/TTS turns (có audio_url / type audio) */
    chatVoice: process.env.DYNAMO_CHAT_VOICE_TABLE || 'InterviewChatVoice',
    /** Metadata phiên gọi video (WebRTC room); signaling vẫn qua Socket */
    videoCalls: process.env.DYNAMO_VIDEO_CALL_TABLE || 'InterviewVideoCalls',
    users: process.env.DYNAMO_USERS_TABLE || 'InterviewUsers',
    jobProfiles: process.env.DYNAMO_JOB_PROFILE_TABLE || 'JobProfiles',
    jobCategories: process.env.DYNAMO_JOB_CATEGORY_TABLE || 'JobCategories',
    userCvs: process.env.DYNAMO_USER_CV_TABLE || 'UserCvs',
    /** CV↔JP scoring history (each scoring run = 1 item) */
    scoringHistory: process.env.DYNAMO_SCORING_HISTORY_TABLE || 'InterviewScoringHistory',
    /** Interview question plan (1 per session) */
    interviewQuestionPlans: process.env.DYNAMO_INTERVIEW_QUESTION_PLANS_TABLE || 'InterviewQuestionPlans',
    /** Interview questions (many per session) */
    interviewQuestions: process.env.DYNAMO_INTERVIEW_QUESTIONS_TABLE || 'InterviewQuestions',
    /** Empty = atomic dedupe off; set to table name (e.g. UserCvDedupe) when table exists. */
    userCvDedupe: (process.env.DYNAMO_USER_CV_DEDUPE_TABLE || '').trim(),
  },
};
