import { Injectable } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

@Injectable()
export class AiService {
  private client: BedrockRuntimeClient;

  constructor() {
    this.client = new BedrockRuntimeClient({
      region: 'ap-southeast-1', 
    });
  }

  async chat(prompt: string) {
    const command = new ConverseCommand({
      modelId: 'arn:aws:bedrock:ap-southeast-1:060473539828:inference-profile/apac.amazon.nova-lite-v1:0',
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
