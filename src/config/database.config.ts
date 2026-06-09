const env = (name: string, fallback: string): string =>
  (process.env[name] || '').trim() || fallback;

export const databaseConfig = {
  region: env('AWS_REGION', 'us-east-1'),
  endpoint: (process.env.DYNAMODB_ENDPOINT || '').trim(),
  tables: {
    sessions: env('DYNAMO_SESSIONS_TABLE', 'InterviewSessions'),
    chatText: env('DYNAMO_CHAT_TEXT_TABLE', 'InterviewChatText'),
    chatVoice: env('DYNAMO_CHAT_VOICE_TABLE', 'InterviewChatVoice'),
    videoCalls: env('DYNAMO_VIDEO_CALL_TABLE', 'InterviewVideoCalls'),
    users: env(
      'DYNAMO_USER_TABLE',
      env('DYNAMO_USERS_TABLE', 'Users'),
    ),
    jobProfiles: env('DYNAMO_JOB_PROFILE_TABLE', 'JobProfiles'),
    jobCategories: env('DYNAMO_JOB_CATEGORY_TABLE', 'JobCategories'),
    userCvs: env('DYNAMO_USER_CV_TABLE', 'UserCvs'),
    scoringHistory: env(
      'DYNAMO_SCORING_HISTORY_TABLE',
      'InterviewScoringHistory',
    ),
    interviewQuestionPlans: env(
      'DYNAMO_INTERVIEW_QUESTION_PLANS_TABLE',
      'InterviewQuestionPlans',
    ),
    interviewQuestions: env(
      'DYNAMO_INTERVIEW_QUESTIONS_TABLE',
      'InterviewQuestions',
    ),
    userCvDedupe: (process.env.DYNAMO_USER_CV_DEDUPE_TABLE || '').trim(),
  },
} as const;
