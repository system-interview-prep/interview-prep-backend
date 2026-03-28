export interface TTSProvider {
  /**
   * Converts text to speech and returns the audio as a Base64 string and its MIME type.
   * @param text The input text to convert.
   * @returns An object containing the base64 encoded audio and the corresponding mimeType.
   */
  convertTextToSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }>;
}
