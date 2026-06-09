import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { databaseConfig } from './database.config';

export function createDynamoDBClient(): DynamoDBClient {
  const endpoint = databaseConfig.endpoint;
  const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const credentials =
    accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : endpoint
        ? { accessKeyId: 'local', secretAccessKey: 'local' }
        : undefined;

  return new DynamoDBClient({
    region: databaseConfig.region,
    ...(endpoint ? { endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  });
}
