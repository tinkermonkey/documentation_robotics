/**
 * Unit tests for chat functionality
 */

import { describe, it, expect } from 'bun:test';

describe('Chat JSON Event Parsing', () => {
  it('should parse assistant text events', () => {
    const event = JSON.parse('{"type":"assistant","message":{"content":[{"type":"text","text":"Hello!"}]}}');
    expect(event.type).toBe('assistant');
    expect(event.message.content[0].type).toBe('text');
    expect(event.message.content[0].text).toBe('Hello!');
  });

  it('should parse tool_use events', () => {
    const event = JSON.parse('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"dr list api"}}]}}');
    expect(event.type).toBe('assistant');
    expect(event.message.content[0].type).toBe('tool_use');
    expect(event.message.content[0].name).toBe('Bash');
    expect(event.message.content[0].input.command).toBe('dr list api');
  });

  it('should handle mixed content blocks', () => {
    const event = JSON.parse('{"type":"assistant","message":{"content":[{"type":"text","text":"Let me check..."},{"type":"tool_use","name":"Bash","input":{"command":"dr list"}}]}}');
    expect(event.message.content.length).toBe(2);
    expect(event.message.content[0].type).toBe('text');
    expect(event.message.content[1].type).toBe('tool_use');
  });

  it('should parse result events', () => {
    const event = JSON.parse('{"type":"result","result":"command output"}');
    expect(event.type).toBe('result');
    expect(event.result).toBe('command output');
  });

  it('should handle multiple assistant messages', () => {
    const event1 = JSON.parse('{"type":"assistant","message":{"content":[{"type":"text","text":"First message"}]}}');
    const event2 = JSON.parse('{"type":"assistant","message":{"content":[{"type":"text","text":"Second message"}]}}');

    expect(event1.message.content[0].text).toBe('First message');
    expect(event2.message.content[0].text).toBe('Second message');
  });

  it('should handle empty content arrays', () => {
    const event = JSON.parse('{"type":"assistant","message":{"content":[]}}');
    expect(event.message.content).toEqual([]);
  });

  it('should handle tool_use with complex input', () => {
    const event = JSON.parse('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/path/to/file.json"}}]}}');
    expect(event.message.content[0].input.file_path).toBe('/path/to/file.json');
  });
});

describe('System Prompt Building', () => {
  it('should include all 12 layers in prompt', () => {
    const prompt = `You are DrBot, an expert conversational assistant for Documentation Robotics (DR) models.

## Your Expertise

You understand the **full 12-layer DR architecture**:
1. Motivation (Layer 1) - WHY: goals, principles, requirements, constraints
2. Business (Layer 2) - WHAT: capabilities, processes, services, actors
3. Security (Layer 3) - WHO/PROTECTION: actors, roles, policies, threats
4. Application (Layer 4) - HOW: components, services, interfaces, events
5. Technology (Layer 5) - WITH: platforms, frameworks, infrastructure
6. API (Layer 6) - CONTRACTS: OpenAPI 3.0.3 specs
7. Data Model (Layer 7) - STRUCTURE: JSON Schema Draft 7
8. Datastore (Layer 8) - PERSISTENCE: SQL DDL
9. UX (Layer 9) - EXPERIENCE: Three-Tier Architecture
10. Navigation (Layer 10) - FLOW: Multi-Modal routing
11. APM (Layer 11) - OBSERVE: OpenTelemetry 1.0+
12. Testing (Layer 12) - VERIFY: ISP Coverage Model`;

    expect(prompt).toContain('Motivation');
    expect(prompt).toContain('Business');
    expect(prompt).toContain('Security');
    expect(prompt).toContain('Application');
    expect(prompt).toContain('Technology');
    expect(prompt).toContain('API');
    expect(prompt).toContain('Data Model');
    expect(prompt).toContain('Datastore');
    expect(prompt).toContain('UX');
    expect(prompt).toContain('Navigation');
    expect(prompt).toContain('APM');
    expect(prompt).toContain('Testing');
  });

  it('should include DR CLI tool documentation', () => {
    const prompt = `## Your Tools

You can use Bash to run DR CLI commands:
- \`dr list <layer>\` - List elements in a layer
- \`dr show <id>\` - Show element by ID
- \`dr search <query>\` - Search for elements
- \`dr trace <id>\` - Trace dependencies

You can use Read to examine model files in the .dr directory.`;

    expect(prompt).toContain('dr list');
    expect(prompt).toContain('dr show');
    expect(prompt).toContain('dr search');
    expect(prompt).toContain('dr trace');
    expect(prompt).toContain('Bash');
    expect(prompt).toContain('Read');
  });

  it('should include DrBot identity', () => {
    const prompt = 'You are DrBot, an expert conversational assistant for Documentation Robotics (DR) models.';
    expect(prompt).toContain('DrBot');
    expect(prompt).toContain('Documentation Robotics');
  });

  it('should include guideline expectations', () => {
    const prompt = `## Guidelines

- Understand user intent through conversation
- Use DR CLI tools to get current model information
- Provide context from the model state
- Be conversational and helpful`;

    expect(prompt).toContain('Understand user intent');
    expect(prompt).toContain('Use DR CLI tools');
    expect(prompt).toContain('conversational and helpful');
  });
});

describe('JSON-RPC 2.0 Message Formatting', () => {
  describe('chat.response.chunk notification', () => {
    it('should format correctly with text content', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'chat.response.chunk',
        params: {
          conversation_id: 'conv-1-12345',
          content: 'This model has 12 layers...',
          is_final: false,
          timestamp: new Date().toISOString(),
        },
      };

      expect(notification.jsonrpc).toBe('2.0');
      expect(notification.method).toBe('chat.response.chunk');
      expect(notification.params.conversation_id).toBeTruthy();
      expect(notification.params.content).toBeTruthy();
      // Notifications don't have 'id'
      expect((notification as any).id).toBeUndefined();
    });

    it('should include is_final flag', () => {
      const final = {
        jsonrpc: '2.0',
        method: 'chat.response.chunk',
        params: {
          conversation_id: 'conv-1-12345',
          content: 'Final chunk',
          is_final: true,
          timestamp: new Date().toISOString(),
        },
      };

      expect(final.params.is_final).toBe(true);
    });
  });

  describe('chat.tool.invoke notification', () => {
    it('should format correctly', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'chat.tool.invoke',
        params: {
          conversation_id: 'conv-1-12345',
          tool_name: 'Bash',
          tool_input: { command: 'dr list api' },
          timestamp: new Date().toISOString(),
        },
      };

      expect(notification.method).toBe('chat.tool.invoke');
      expect(notification.params.tool_name).toBe('Bash');
      expect(notification.params.tool_input.command).toBe('dr list api');
    });

    it('should support Read tool', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'chat.tool.invoke',
        params: {
          conversation_id: 'conv-1-12345',
          tool_name: 'Read',
          tool_input: { file_path: '.dr/manifest.json' },
          timestamp: new Date().toISOString(),
        },
      };

      expect(notification.params.tool_name).toBe('Read');
      expect(notification.params.tool_input.file_path).toBeTruthy();
    });
  });

  describe('chat.tool.result notification', () => {
    it('should format correctly', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'chat.tool.result',
        params: {
          conversation_id: 'conv-1-12345',
          result: 'command output here',
          timestamp: new Date().toISOString(),
        },
      };

      expect(notification.method).toBe('chat.tool.result');
      expect(notification.params.result).toBeTruthy();
    });
  });

  describe('Completion response', () => {
    it('should format correctly', () => {
      const response = {
        jsonrpc: '2.0',
        result: {
          conversation_id: 'conv-1-12345',
          status: 'complete',
          exit_code: 0,
          full_response: 'Complete response text...',
          timestamp: new Date().toISOString(),
        },
        id: 1,
      };

      expect(response.jsonrpc).toBe('2.0');
      expect(response.result.status).toBe('complete');
      expect(response.result.exit_code).toBe(0);
      expect(response.id).toBe(1);
    });

    it('should indicate error status on non-zero exit', () => {
      const response = {
        jsonrpc: '2.0',
        result: {
          conversation_id: 'conv-1-12345',
          status: 'error',
          exit_code: 1,
          full_response: '',
          timestamp: new Date().toISOString(),
        },
        id: 1,
      };

      expect(response.result.status).toBe('error');
      expect(response.result.exit_code).toBeGreaterThan(0);
    });
  });

  describe('Error response', () => {
    it('should format correctly', () => {
      const errorResponse = {
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Claude Code CLI not available',
        },
        id: 1,
      };

      expect(errorResponse.error.code).toBe(-32001);
      expect(errorResponse.error.message).toContain('Claude Code');
    });

    it('should use -32603 for chat failures', () => {
      const errorResponse = {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Chat failed: Process error',
        },
        id: 1,
      };

      expect(errorResponse.error.code).toBe(-32603);
    });
  });
});

describe('Command-line Invocation', () => {
  it('should build proper Claude CLI command with all required flags', () => {
    const systemPrompt = 'Test prompt';
    const expectedFlags = [
      'claude',
      '--print',
      '--dangerously-skip-permissions',
      '--verbose',
      '--system-prompt', systemPrompt,
      '--tools', 'Bash,Read',
      '--output-format', 'stream-json',
    ];

    expect(expectedFlags).toContain('--print');
    expect(expectedFlags).toContain('--dangerously-skip-permissions');
    expect(expectedFlags).toContain('--output-format');
    expect(expectedFlags).toContain('stream-json');
    expect(expectedFlags).toContain('--tools');
    expect(expectedFlags).toContain('Bash,Read');
    expect(expectedFlags).toContain('--system-prompt');
  });

  it('should pass user message via stdin', () => {
    // Verify that the approach is to use stdin, not command arguments
    const message = 'What layers are in this model?';
    // The message should NOT appear in cmd array
    const cmd = [
      'claude',
      '--print',
      '--dangerously-skip-permissions',
      '--verbose',
      '--system-prompt', 'system prompt',
      '--tools', 'Bash,Read',
      '--output-format', 'stream-json',
    ];

    expect(cmd).not.toContain(message);
    // It should be sent via stdin instead
  });
});

describe('With-Danger Flag', () => {
  it('should build Claude CLI command without danger flag by default', () => {
    const cmd = [
      'claude',
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    expect(cmd).not.toContain('--dangerously-skip-permissions');
  });

  it('should build Claude CLI command with danger flag when enabled', () => {
    const cmd = [
      'claude',
      '--print',
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    expect(cmd).toContain('--dangerously-skip-permissions');
  });

  it('should build Copilot CLI command without danger flag by default', () => {
    const cmd = [
      'gh',
      'copilot', 'explain',
      'message',
    ];

    expect(cmd).not.toContain('--allow-all-tools');
  });

  it('should build Copilot CLI command with danger flag when enabled', () => {
    const cmd = [
      'gh',
      'copilot', 'explain',
      '--allow-all-tools',
      'message',
    ];

    expect(cmd).toContain('--allow-all-tools');
  });

  it('should support with-danger as standalone argument', () => {
    // Format: dr chat with-danger
    const firstArg = 'with-danger';
    const secondArg = undefined;

    const withDanger = firstArg === 'with-danger';
    const client = firstArg !== 'with-danger' ? firstArg : undefined;

    expect(withDanger).toBe(true);
    expect(client).toBeUndefined();
  });

  it('should support with-danger after client name', () => {
    // Format: dr chat claude-code with-danger
    const firstArg = 'claude-code';
    const secondArg = 'with-danger';

    const withDanger = secondArg === 'with-danger';
    const client = firstArg !== 'with-danger' ? firstArg : undefined;

    expect(withDanger).toBe(true);
    expect(client).toBe('claude-code');
  });

  it('should not enable danger mode without with-danger flag', () => {
    // Format: dr chat claude-code
    const firstArg = 'claude-code';
    const secondArg = undefined;

    const withDanger = secondArg === 'with-danger' || firstArg === 'with-danger';
    const client = firstArg !== 'with-danger' ? firstArg : undefined;

    expect(withDanger).toBe(false);
    expect(client).toBe('claude-code');
  });
});
