export interface TTSProvider {
  convertTextToSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }>;
}

