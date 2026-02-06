/**
 * Claude Client for Anthropic SDK Integration
 * Handles streaming message responses and conversation history management
 *
 * IMPORTANT: This is legacy SDK-based chat infrastructure maintained for programmatic usage.
 * The `dr chat` CLI command uses Claude Code CLI subprocess instead (see commands/chat.ts).
 * Use this class only for direct Anthropic SDK integration in other contexts.
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * Chat message in conversation history
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Claude client for managing conversations with the Anthropic API
 */
export class ClaudeClient {
  private client: Anthropic;
  private conversationHistory: ChatMessage[] = [];

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Send a chat message and stream the response
   * @param userMessage The message from the user
   * @param options Configuration options for the API call
   * @returns An async iterable of response text chunks
   */
  async chat(
    userMessage: string,
    options: {
      model?: string;
      maxTokens?: number;
      systemPrompt?: string;
      tools?: any[];
    } = {}
  ): Promise<AsyncIterable<string>> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    // Create API request parameters
    const messages = this.conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const params: any = {
      model: options.model || 'claude-sonnet-4-5-20250929',
      max_tokens: options.maxTokens || 4096,
      messages,
    };

    if (options.systemPrompt) {
      params.system = options.systemPrompt;
    }

    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools;
    }

    // Create the stream
    const stream = await this.client.messages.stream(params);

    // Return async iterable that accumulates and yields response text
    return this.streamResponse(stream);
  }

  /**
   * Stream response from Claude API and accumulate to conversation history
   * @param stream The stream from Claude API
   * @returns An async iterable of text chunks
   */
  private async *streamResponse(stream: any): AsyncIterable<string> {
    let assistantMessage = '';

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        const text = chunk.delta.text || '';
        assistantMessage += text;
        yield text;
      }
    }

    // Add complete assistant message to history
    this.conversationHistory.push({
      role: 'assistant',
      content: assistantMessage,
    });
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history
   * @returns Copy of conversation history
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Get the number of messages in history
   */
  getHistoryLength(): number {
    return this.conversationHistory.length;
  }
}
