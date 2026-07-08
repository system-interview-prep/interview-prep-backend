import * as amqp from 'amqplib';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { rabbitMqConfig } from '../config/rabbitmq.config';

export type RabbitMessageContext = {
  raw: ConsumeMessage;
  receiveCount: number;
};

export class RabbitMqUtil {
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: ConfirmChannel | null = null;

  constructor(private readonly queueName: string) {}

  private get retryQueueName(): string {
    return `${this.queueName}.retry`;
  }

  private get deadLetterQueueName(): string {
    return `${this.queueName}.dlq`;
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;

    this.connection = await amqp.connect(rabbitMqConfig.url);
    this.connection.on('error', (error) => {
      console.error('[RabbitMQ] connection error', error.message);
    });
    this.connection.on('close', () => {
      this.connection = null;
      this.channel = null;
    });

    const channel = await this.connection.createConfirmChannel();
    channel.on('error', (error) => {
      console.error('[RabbitMQ] channel error', error.message);
    });
    channel.on('close', () => {
      this.channel = null;
    });

    await channel.assertQueue(this.queueName, { durable: true });
    await channel.assertQueue(this.retryQueueName, {
      durable: true,
      arguments: {
        'x-message-ttl': rabbitMqConfig.retryDelayMs,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': this.queueName,
      },
    });
    await channel.assertQueue(this.deadLetterQueueName, { durable: true });

    this.channel = channel;
    return channel;
  }

  private async sendBuffer(
    queueName: string,
    body: Buffer,
    headers: Record<string, unknown> = {},
  ): Promise<void> {
    const channel = await this.getChannel();
    channel.sendToQueue(queueName, body, {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
      headers,
    });
    await channel.waitForConfirms();
  }

  async sendJson(body: unknown): Promise<void> {
    await this.sendBuffer(this.queueName, Buffer.from(JSON.stringify(body)));
  }

  async retry(message: ConsumeMessage, receiveCount: number, error: string): Promise<void> {
    await this.sendBuffer(this.retryQueueName, message.content, {
      ...message.properties.headers,
      'x-retry-count': receiveCount,
      'x-last-error': error.slice(0, 1_000),
    });
  }

  async deadLetter(
    message: ConsumeMessage,
    receiveCount: number,
    error: string,
  ): Promise<void> {
    await this.sendBuffer(this.deadLetterQueueName, message.content, {
      ...message.properties.headers,
      'x-retry-count': Math.max(0, receiveCount - 1),
      'x-final-error': error.slice(0, 1_000),
      'x-failed-at': new Date().toISOString(),
    });
  }

  async consumeJson<T>(
    handler: (body: T, context: RabbitMessageContext) => Promise<void>,
  ): Promise<void> {
    const channel = await this.getChannel();
    await channel.prefetch(rabbitMqConfig.prefetch);
    await channel.consume(
      this.queueName,
      async (message) => {
        if (!message) return;

        const retryCount = Number(message.properties.headers?.['x-retry-count'] || 0);
        const receiveCount = Number.isFinite(retryCount) ? retryCount + 1 : 1;

        let body: T;
        try {
          body = JSON.parse(message.content.toString('utf8')) as T;
        } catch (error) {
          const reason = `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
          await this.deadLetter(message, receiveCount, reason);
          channel.ack(message);
          return;
        }

        try {
          await handler(body, { raw: message, receiveCount });
        } catch (error) {
          channel.nack(message, false, true);
          console.error('[RabbitMQ] unhandled consumer error', error);
          return;
        }

        channel.ack(message);
      },
      { noAck: false },
    );
  }
}
