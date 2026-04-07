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
    chat: process.env.DYNAMO_CHAT_TABLE || 'InterviewChats',
    sessions: process.env.DYNAMO_SESSIONS_TABLE || 'InterviewSessions',
    users: process.env.DYNAMO_USERS_TABLE || 'InterviewUsers',
    jobProfiles: process.env.DYNAMO_JOB_PROFILE_TABLE || 'JobProfiles',
    jobCategories: process.env.DYNAMO_JOB_CATEGORY_TABLE || 'JobCategories',
    userCvs: process.env.DYNAMO_USER_CV_TABLE || 'UserCvs',
    /** Empty = atomic dedupe off; set to table name (e.g. UserCvDedupe) when table exists. */
    userCvDedupe: (process.env.DYNAMO_USER_CV_DEDUPE_TABLE || '').trim(),
  },
};
