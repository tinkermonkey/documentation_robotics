/**
 * API Mocking Utilities for Tests
 * Provides infrastructure for mocking external API dependencies (Anthropic API, etc.)
 */

/**
 * Mock the Anthropic API key for testing
 * Returns an object with a restore function to revert to the original state
 *
 * @returns Object with restore method to revert the mock
 */
export function mockAnthropicAPI(): { restore: () => void } {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  // Set a mock API key for testing
  process.env.ANTHROPIC_API_KEY = 'mock-api-key-for-testing-' + Date.now();

  return {
    restore: () => {
      if (originalKey) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    },
  };
}

/**
 * Mock response for Claude API streaming
 * This matches the structure of @anthropic-ai/sdk MessageStreamEvent
 */
export const mockClaudeStreamingResponse = {
  type: 'message_start',
  message: {
    id: 'msg_test_123',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'Mock Claude response for testing',
      },
    ],
    model: 'claude-3-5-sonnet-20241022',
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
  },
};

/**
 * Mock response for Claude API text content
 */
export const mockClaudeTextMessage = {
  id: 'msg_test_123',
  type: 'message' as const,
  role: 'assistant' as const,
  content: [
    {
      type: 'text' as const,
      text: 'Mock Claude response for testing',
    },
  ],
  model: 'claude-3-5-sonnet-20241022',
  stop_reason: 'end_turn' as const,
  stop_sequence: null,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
  },
};

/**
 * Mock response for Claude API with tool use
 */
export const mockClaudeToolUseMessage = {
  id: 'msg_test_123',
  type: 'message' as const,
  role: 'assistant' as const,
  content: [
    {
      type: 'tool_use' as const,
      id: 'tool_use_123',
      name: 'dr_list',
      input: { layer: 'motivation' },
    },
  ],
  model: 'claude-3-5-sonnet-20241022',
  stop_reason: 'tool_use' as const,
  stop_sequence: null,
  usage: {
    input_tokens: 10,
    output_tokens: 5,
  },
};

/**
 * Mock error response from Claude API
 */
export const mockClaudeErrorResponse = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Invalid API key',
  },
};

/**
 * TypeScript interface for Anthropic API message parameters
 */
export interface AnthropicMessageParams {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  system?: string;
  tools?: unknown;
  temperature?: number;
}

/**
 * Create a mock function for the Anthropic client
 * Useful for stubbing the Claude SDK in unit tests
 */
export function createMockAnthropicClient() {
  return {
    messages: {
      create: async (params: AnthropicMessageParams) => mockClaudeTextMessage,
      stream: async function* (params: AnthropicMessageParams) {
        yield mockClaudeStreamingResponse;
        yield {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: ' ',
          },
        };
        yield {
          type: 'message_delta',
          delta: {
            stop_reason: 'end_turn',
            stop_sequence: null,
          },
        };
      },
    },
  };
}
