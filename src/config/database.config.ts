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
  },
};
