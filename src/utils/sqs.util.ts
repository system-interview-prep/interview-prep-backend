import { ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import 'dotenv/config';

export class SqsUtil {
  private client: SQSClient;

  constructor() {
    this.client = new SQSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async sendJson(queueUrl: string, body: any): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(body),
      }),
    );
  }

  async receive(queueUrl: string, waitSeconds = 20, visibilityTimeout = 120) {
    return this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        WaitTimeSeconds: waitSeconds,
        VisibilityTimeout: visibilityTimeout,
        MaxNumberOfMessages: 1,
        // request message system attributes (includes ApproximateReceiveCount)
        AttributeNames: ['All'],
      }),
    );
  }

  async delete(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}

