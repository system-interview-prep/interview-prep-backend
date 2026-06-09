import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export function createDynamoDBClient(): DynamoDBClient {
  const endpoint = (process.env.DYNAMODB_ENDPOINT || '').trim();
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const credentials =
    accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : endpoint
        ? { accessKeyId: 'local', secretAccessKey: 'local' }
        : undefined;

  return new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(endpoint ? { endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  });
}
