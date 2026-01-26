import { Injectable } from '@nestjs/common';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import * as dotenv from 'dotenv';

@Injectable()
export class AiService {
  private client: BedrockRuntimeClient;

  constructor() {
    dotenv.config();
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
      // If you need to use a bearer token, you may need to set it in the request headers or use a custom middleware.
    });
  }

  async chat(prompt: string) {
    const command = new ConverseCommand({
      modelId: process.env.MODELID || '',
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 400,
        temperature: 0.7,
        topP: 0.9,
      },
    });

    const response = await this.client.send(command);

    return response.output.message.content[0].text;
  }
}
