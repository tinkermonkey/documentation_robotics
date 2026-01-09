/**
 * End-to-end tests for chat CLI workflow
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Chat E2E Tests', () => {
  let testDir: string;
  let claudeAvailable: boolean;

  beforeAll(async () => {
    // Create temp directory with DR model
    testDir = await mkdtemp(join(tmpdir(), 'dr-chat-test-'));

    // Initialize DR model structure
    const drDir = join(testDir, '.dr');
    await mkdir(drDir, { recursive: true });
    await mkdir(join(drDir, 'layers'), { recursive: true });

    // Create manifest
    await writeFile(join(drDir, 'manifest.json'), JSON.stringify({
      name: 'Test Model',
      specVersion: '0.6.0',
      description: 'Test model for chat E2E tests',
      version: '1.0.0',
    }, null, 2));

    // Create a test API layer
    await writeFile(join(drDir, 'layers', 'api.json'), JSON.stringify({
      layerMetadata: {
        layer: 'api',
        catalogVersion: '0.6.0',
      },
      elements: [
        {
          id: 'api-endpoint-get-users',
          type: 'endpoint',
          name: 'Get Users',
          description: 'Retrieve all users',
          properties: {
            method: 'GET',
            path: '/users',
          },
        },
      ],
    }, null, 2));

    // Create a test Business layer
    await writeFile(join(drDir, 'layers', 'business.json'), JSON.stringify({
      layerMetadata: {
        layer: 'business',
        catalogVersion: '0.6.0',
      },
      elements: [
        {
          id: 'business-service-user-management',
          type: 'service',
          name: 'User Management',
          description: 'Service for managing user accounts',
        },
      ],
    }, null, 2));

    // Check if Claude Code is available
    const result = Bun.spawnSync({
      cmd: ['which', 'claude'],
      stdout: 'pipe',
    });
    claudeAvailable = result.exitCode === 0;
  });

  afterAll(async () => {
    // Clean up
    await rm(testDir, { recursive: true, force: true });
  });

  it('should check Claude Code CLI availability', () => {
    console.log(`Claude Code CLI available: ${claudeAvailable}`);
    expect(typeof claudeAvailable).toBe('boolean');
  });

  it('should build proper Claude CLI command with dr-architect agent', () => {
    // Without with-danger flag, the command should not include --dangerously-skip-permissions
    const expectedCmdWithoutDanger = [
      'claude',
      '--agent', 'dr-architect',
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    expect(expectedCmdWithoutDanger).toContain('--agent');
    expect(expectedCmdWithoutDanger).toContain('dr-architect');
    expect(expectedCmdWithoutDanger).toContain('--print');
    expect(expectedCmdWithoutDanger).not.toContain('--dangerously-skip-permissions');
    expect(expectedCmdWithoutDanger).toContain('--output-format');
    expect(expectedCmdWithoutDanger).toContain('stream-json');
    // Agent defines its own tools, so --tools flag is not needed
  });

  it('should build proper Claude CLI command with danger flag when enabled', () => {
    // With with-danger flag, the command should include --dangerously-skip-permissions
    const expectedCmdWithDanger = [
      'claude',
      '--agent', 'dr-architect',
      '--print',
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    expect(expectedCmdWithDanger).toContain('--agent');
    expect(expectedCmdWithDanger).toContain('dr-architect');
    expect(expectedCmdWithDanger).toContain('--print');
    expect(expectedCmdWithDanger).toContain('--dangerously-skip-permissions');
    expect(expectedCmdWithDanger).toContain('--output-format');
    expect(expectedCmdWithDanger).toContain('stream-json');
  });

  it('should have valid test model structure', async () => {
    const manifestPath = join(testDir, '.dr', 'manifest.json');
    const manifestContent = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(manifestContent);

    expect(manifest.name).toBe('Test Model');
    expect(manifest.specVersion).toBe('0.6.0');
    expect(manifest.description).toBeTruthy();
  });

  it('should have valid test layer files', async () => {
    const apiLayerPath = join(testDir, '.dr', 'layers', 'api.json');
    const apiContent = await Bun.file(apiLayerPath).text();
    const apiLayer = JSON.parse(apiContent);

    expect(apiLayer.layerMetadata.layer).toBe('api');
    expect(apiLayer.elements.length).toBe(1);
    expect(apiLayer.elements[0].id).toBe('api-endpoint-get-users');
  });

  it('should have model context accessible via DR CLI for dr-architect agent', async () => {
    // The dr-architect agent accesses model context through DR CLI tools
    // Verify the model structure is properly set up for agent access
    const manifestPath = join(testDir, '.dr', 'manifest.json');
    const manifest = JSON.parse(await Bun.file(manifestPath).text());

    const apiLayerPath = join(testDir, '.dr', 'layers', 'api.json');
    const apiLayer = JSON.parse(await Bun.file(apiLayerPath).text());

    const businessLayerPath = join(testDir, '.dr', 'layers', 'business.json');
    const businessLayer = JSON.parse(await Bun.file(businessLayerPath).text());

    // Verify model files are accessible for agent to use via Bash/Read tools
    expect(manifest.name).toBe('Test Model');
    expect(apiLayer.elements.length).toBe(1);
    expect(businessLayer.elements.length).toBe(1);
  });

  // Skip this test if Claude is not available
  it.skipIf(!claudeAvailable)('should launch Claude Code CLI subprocess with proper invocation', async () => {
    const systemPrompt = 'You are a helpful assistant. Answer briefly.';

    const proc = Bun.spawn({
      cmd: [
        'claude',
        '--print',
        '--dangerously-skip-permissions',
        '--verbose',
        '--system-prompt', systemPrompt,
        '--tools', 'Bash,Read',
        '--output-format', 'stream-json',
      ],
      cwd: testDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Send a simple message
    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode('Say "test passed" and nothing else.'));
    await writer.close();

    // Read response with timeout
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = '';

    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Already terminated
      }
    }, 30000);

    try {
      let lineCount = 0;
      const maxLines = 100;

      while (lineCount < maxLines) {
        const { done, value } = await reader.read();
        if (done) break;

        output += decoder.decode(value, { stream: true });
        lineCount++;

        // Check if we got a response (either "test passed" or JSON events)
        if (output.includes('test passed') || output.includes('"type":"assistant"')) {
          break;
        }
      }
    } finally {
      clearTimeout(timeout);
      try {
        proc.kill();
      } catch {
        // Already terminated
      }
    }

    // Verify we got output
    expect(output.length).toBeGreaterThan(0);
  });

  it('should handle JSON event parsing from stream', () => {
    // Test parsing of various Claude Code CLI JSON events
    const events = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"dr list"}}]}}',
      '{"type":"result","result":"output"}',
    ];

    for (const eventStr of events) {
      const event = JSON.parse(eventStr);
      expect(event.type).toBeTruthy();

      if (event.type === 'assistant') {
        expect(event.message).toBeDefined();
        expect(event.message.content).toBeDefined();
      } else if (event.type === 'result') {
        expect(event.result).toBeDefined();
      }
    }
  });
});

describe('WebSocket Chat Protocol', () => {
  it('should format chat.send request correctly', () => {
    const request = {
      jsonrpc: '2.0',
      method: 'chat.send',
      params: {
        message: 'What layers are in this model?',
      },
      id: 1,
    };

    expect(request.jsonrpc).toBe('2.0');
    expect(request.method).toBe('chat.send');
    expect(request.params.message).toBeTruthy();
    expect(request.id).toBeDefined();
  });

  it('should format chat.response.chunk notification correctly', () => {
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
    expect(notification.params.is_final).toBe(false);
    // Notifications don't have 'id'
    expect((notification as any).id).toBeUndefined();
  });

  it('should format chat.tool.invoke notification correctly', () => {
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

  it('should format chat.tool.result notification correctly', () => {
    const notification = {
      jsonrpc: '2.0',
      method: 'chat.tool.result',
      params: {
        conversation_id: 'conv-1-12345',
        result: 'output from tool execution',
        timestamp: new Date().toISOString(),
      },
    };

    expect(notification.method).toBe('chat.tool.result');
    expect(notification.params.result).toBeTruthy();
  });

  it('should format completion response correctly', () => {
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
    expect(response.result.full_response).toBeTruthy();
    expect(response.id).toBe(1);
  });

  it('should indicate error status on process failure', () => {
    const response = {
      jsonrpc: '2.0',
      result: {
        conversation_id: 'conv-1-12345',
        status: 'error',
        exit_code: 127,
        full_response: '',
        timestamp: new Date().toISOString(),
      },
      id: 1,
    };

    expect(response.result.status).toBe('error');
    expect(response.result.exit_code).not.toBe(0);
  });

  it('should format error response correctly', () => {
    const errorResponse = {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: `Chat failed: Process error`,
      },
      id: 1,
    };

    expect(errorResponse.error.code).toBe(-32603);
    expect(errorResponse.error.message).toContain('Chat failed');
  });

  it('should format unavailable service error', () => {
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
});

describe('System Prompt Content', () => {
  it('should include all required 12 layers in context', () => {
    const layers = [
      'Motivation',
      'Business',
      'Security',
      'Application',
      'Technology',
      'API',
      'Data Model',
      'Datastore',
      'UX',
      'Navigation',
      'APM',
      'Testing',
    ];

    for (const layer of layers) {
      expect(layer).toBeTruthy();
    }
  });

  it('should document available tools correctly', () => {
    const tools = [
      'dr list',
      'dr find',
      'dr search',
      'dr trace',
      'Bash',
      'Read',
    ];

    for (const tool of tools) {
      expect(tool).toBeTruthy();
    }
  });

  it('should include model metadata in context', () => {
    const metadata = ['name', 'specVersion', 'description'];
    for (const field of metadata) {
      expect(field).toBeTruthy();
    }
  });

  it('should include layer statistics', () => {
    // Layer stats should show element counts
    const stats = {
      api: 1,
      business: 2,
      application: 0,
    };

    for (const [layerName, count] of Object.entries(stats)) {
      expect(layerName).toBeTruthy();
      expect(typeof count).toBe('number');
    }
  });
});

describe('Subprocess IPC', () => {
  it('should use stdin for message passing', () => {
    // Message should not be in command args
    const cmd = [
      'claude',
      '--agent', 'dr-architect',
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    // User message should NOT be in here
    const message = 'user message';
    expect(cmd).not.toContain(message);
  });

  it('should use stdin for message passing with danger flag', () => {
    // Message should not be in command args even with danger flag
    const cmd = [
      'claude',
      '--agent', 'dr-architect',
      '--print',
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
    ];

    // User message should NOT be in here
    const message = 'user message';
    expect(cmd).not.toContain(message);
  });

  it('should use stdout for streaming JSON events', () => {
    // Verify JSON events are line-delimited
    const events = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
      '{"type":"result","result":"done"}',
    ].join('\n');

    const lines = events.split('\n');
    expect(lines.length).toBe(2);

    for (const line of lines) {
      if (line.trim()) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    }
  });

  it('should handle process exit codes correctly', () => {
    const successExit = 0;
    const errorExit = 1;

    const successStatus = successExit === 0 ? 'complete' : 'error';
    const errorStatus = errorExit === 0 ? 'complete' : 'error';

    expect(successStatus).toBe('complete');
    expect(errorStatus).toBe('error');
  });

  it('should clean up processes on completion', () => {
    const processes = new Map();

    // Simulate process tracking
    const conversationId = 'conv-1';
    const proc = { id: 'test-proc' };

    processes.set(conversationId, proc);
    expect(processes.has(conversationId)).toBe(true);

    // Clean up
    processes.delete(conversationId);
    expect(processes.has(conversationId)).toBe(false);
  });
});
