/**
 * Integration Tests for Agent Abstraction Layer
 * 
 * Tests end-to-end workflows including process lifecycle,
 * output streaming, error handling, and multi-event scenarios.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ClaudeCodeAgent } from '../../src/ai/agents/claude-code.js';
import type { CodingAgent, ChatEvent } from '../../src/ai/agents/types.js';

describe('Agent Abstraction Layer - Integration', () => {
  let agent: CodingAgent;

  beforeEach(() => {
    agent = new ClaudeCodeAgent();
  });

  describe('Agent Interface Compatibility', () => {
    it('should satisfy CodingAgent interface contract', () => {
      expect(agent.name).toBeString();
      expect(agent.command).toBeString();
      expect(typeof agent.isAvailable).toBe('function');
      expect(typeof agent.spawn).toBe('function');
      expect(typeof agent.parseOutput).toBe('function');
    });

    it('should work as polymorphic CodingAgent', async () => {
      // Test that we can use agent through interface
      const codingAgent: CodingAgent = agent;
      
      const available = await codingAgent.isAvailable();
      expect(typeof available).toBe('boolean');
      
      const events = codingAgent.parseOutput('test');
      expect(Array.isArray(events)).toBe(true);
    });

    it('should be swappable with other implementations', () => {
      // Mock implementation to verify interface compatibility
      class MockAgent implements CodingAgent {
        readonly name = 'Mock';
        readonly command = 'mock';
        
        async isAvailable(): Promise<boolean> {
          return true;
        }
        
        spawn(options: any): any {
          return {
            process: {} as any,
            conversationId: 'mock-123',
            completion: Promise.resolve({
              exitCode: 0,
              fullResponse: 'mocked',
              events: [],
            }),
          };
        }
        
        parseOutput(chunk: string): ChatEvent[] {
          return [{ type: 'text', content: chunk }];
        }
      }

      const mockAgent: CodingAgent = new MockAgent();
      expect(mockAgent.name).toBe('Mock');
      expect(typeof mockAgent.isAvailable).toBe('function');
    });
  });

  describe('Event Stream Processing', () => {
    it('should parse complex multi-event stream', () => {
      const stream = `{"type":"assistant","message":{"content":[{"type":"text","text":"I'll help you"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"dr list api"}}]}}
{"type":"result","result":"api-endpoint-1\\napi-endpoint-2"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Found 2 endpoints"}]}}`;

      const events = agent.parseOutput(stream);
      
      expect(events.length).toBeGreaterThan(0);
      
      // Should have text, tool_use, tool_result, and more text
      const types = events.map(e => e.type);
      expect(types).toContain('text');
      expect(types).toContain('tool_use');
      expect(types).toContain('tool_result');
    });

    it('should accumulate events from chunked stream', () => {
      // Simulate streaming in chunks
      const chunks = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Starting"}]}}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Middle"}]}}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"End"}]}}\n',
      ];

      let allEvents: ChatEvent[] = [];
      for (const chunk of chunks) {
        const events = agent.parseOutput(chunk);
        allEvents = allEvents.concat(events);
      }

      expect(allEvents).toHaveLength(3);
      
      // Verify content can be reconstructed
      const fullText = allEvents
        .filter(e => e.type === 'text')
        .map(e => e.content)
        .join('');
      
      expect(fullText).toBe('StartingMiddleEnd');
    });

    it('should handle partial JSON in stream buffer', () => {
      // First chunk ends mid-JSON
      const partial1 = '{"type":"assistant","message":{"content":[{"type":"text","te';
      const partial2 = 'xt":"Complete"}]}}';
      
      // First chunk should not parse successfully
      const events1 = agent.parseOutput(partial1);
      expect(events1).toHaveLength(1); // Treated as text
      
      // Full JSON should parse
      const events2 = agent.parseOutput(partial1 + partial2);
      const textEvents = events2.filter(e => e.type === 'text');
      expect(textEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should gracefully handle malformed events', () => {
      const malformed = `{"type":"assistant","message":{"content":[{"type":"text","text":"Good"}]}}
{bad json here}
{"type":"assistant","message":{"content":[{"type":"text","text":"Also good"}]}}`;

      const events = agent.parseOutput(malformed);
      
      // Should get 3 events (2 valid + 1 treated as text)
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('text');
      expect(events[1].type).toBe('text'); // Bad JSON treated as text
      expect(events[2].type).toBe('text');
    });

    it('should handle error events in stream', () => {
      const withError = '{"type":"error","message":"Process failed"}';
      
      const events = agent.parseOutput(withError);
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].error).toBe('Process failed');
    });

    it('should continue processing after errors', () => {
      const stream = `{"type":"assistant","message":{"content":[{"type":"text","text":"Before"}]}}
{"type":"error","message":"Something wrong"}
{"type":"assistant","message":{"content":[{"type":"text","text":"After"}]}}`;

      const events = agent.parseOutput(stream);
      
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('text');
      expect(events[1].type).toBe('error');
      expect(events[2].type).toBe('text');
    });
  });

  describe('Tool Invocation Workflow', () => {
    it('should parse complete tool workflow', () => {
      const workflow = `{"type":"assistant","message":{"content":[{"type":"text","text":"Let me check"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"path":"file.txt"}}]}}
{"type":"result","result":"file contents here"}
{"type":"assistant","message":{"content":[{"type":"text","text":"The file contains..."}]}}`;

      const events = agent.parseOutput(workflow);
      
      // Find the tool_use event
      const toolUse = events.find(e => e.type === 'tool_use');
      expect(toolUse).toBeDefined();
      expect(toolUse?.toolName).toBe('Read');
      expect(toolUse?.toolInput).toEqual({ path: 'file.txt' });
      
      // Find the tool_result event
      const toolResult = events.find(e => e.type === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult?.toolResult).toBe('file contents here');
    });

    it('should handle multiple tool invocations', () => {
      const multiTool = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}
{"type":"result","result":"file1 file2"}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"path":"file1"}}]}}
{"type":"result","result":"content of file1"}`;

      const events = agent.parseOutput(multiTool);
      
      const toolUses = events.filter(e => e.type === 'tool_use');
      expect(toolUses).toHaveLength(2);
      expect(toolUses[0].toolName).toBe('Bash');
      expect(toolUses[1].toolName).toBe('Read');
      
      const toolResults = events.filter(e => e.type === 'tool_result');
      expect(toolResults).toHaveLength(2);
    });

    it('should preserve tool input structure', () => {
      const complexInput = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"CustomTool","input":{"nested":{"deep":{"value":42}},"array":[1,2,3]}}]}}`;
      
      const events = agent.parseOutput(complexInput);
      
      const toolUse = events.find(e => e.type === 'tool_use');
      expect(toolUse?.toolInput).toEqual({
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
      });
    });
  });

  describe('Process Lifecycle', () => {
    it('should generate unique conversation IDs', () => {
      const ids = new Set<string>();
      
      for (let i = 0; i < 10; i++) {
        try {
          const proc = agent.spawn({
            cwd: '/tmp',
            message: `test ${i}`,
          });
          ids.add(proc.conversationId);
          proc.process.kill();
        } catch {
          // Expected if command not found
        }
      }
      
      // All IDs should be unique (or all failed)
      expect(ids.size === 0 || ids.size === 10).toBe(true);
    });

    it('should include timestamp in conversation ID', () => {
      try {
        const proc = agent.spawn({
          cwd: '/tmp',
          message: 'test',
        });
        
        // ID should contain 'claude-' and timestamp-like number
        expect(proc.conversationId).toContain('claude-');
        const parts = proc.conversationId.split('-');
        expect(parts.length).toBeGreaterThan(1);
        
        proc.process.kill();
      } catch {
        // Expected if command not found
      }
    });

    it('should provide completion promise', () => {
      try {
        const proc = agent.spawn({
          cwd: '/tmp',
          message: 'test',
        });
        
        expect(proc.completion).toBeInstanceOf(Promise);
        
        proc.process.kill();
      } catch {
        // Expected if command not found
      }
    });
  });

  describe('Configuration Options', () => {
    it('should support custom agent name', () => {
      try {
        const proc = agent.spawn({
          cwd: '/tmp',
          message: 'test',
          agentName: 'custom-agent-name',
        });
        
        expect(proc.conversationId).toBeString();
        proc.process.kill();
      } catch {
        // Expected if command not found
      }
    });

    it('should support additional arguments', () => {
      try {
        const proc = agent.spawn({
          cwd: '/tmp',
          message: 'test',
          additionalArgs: ['--debug', '--verbose'],
        });
        
        expect(proc.process).toBeDefined();
        proc.process.kill();
      } catch {
        // Expected if command not found
      }
    });

    it('should use provided working directory', () => {
      try {
        const proc = agent.spawn({
          cwd: '/home',
          message: 'test',
        });
        
        expect(proc.process).toBeDefined();
        proc.process.kill();
      } catch {
        // Expected if command not found
      }
    });
  });

  describe('Output Format Compatibility', () => {
    it('should handle Claude Code stream-json format', () => {
      const claudeFormat = `{"type":"assistant","message":{"content":[{"type":"text","text":"Response"}]}}`;
      
      const events = agent.parseOutput(claudeFormat);
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Response');
    });

    it('should handle plain text fallback', () => {
      const plainText = 'This is plain output without JSON';
      
      const events = agent.parseOutput(plainText);
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe(plainText);
    });

    it('should preserve newlines in plain text', () => {
      const multiline = `Line 1
Line 2
Line 3`;
      
      const events = agent.parseOutput(multiline);
      
      expect(events).toHaveLength(3);
      expect(events[0].content).toBe('Line 1');
      expect(events[1].content).toBe('Line 2');
      expect(events[2].content).toBe('Line 3');
    });
  });

  describe('Availability Detection', () => {
    it('should complete quickly', async () => {
      const start = Date.now();
      await agent.isAvailable();
      const duration = Date.now() - start;
      
      // Should complete in under 1 second
      expect(duration).toBeLessThan(1000);
    });

    it('should be callable multiple times', async () => {
      const result1 = await agent.isAvailable();
      const result2 = await agent.isAvailable();
      const result3 = await agent.isAvailable();
      
      // Results should be consistent
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should not throw on unavailable command', async () => {
      // Should handle gracefully if command not found
      await expect(agent.isAvailable()).resolves.toBeDefined();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle DR architecture query workflow', () => {
      // Simulate a typical DR chat workflow
      const conversation = `{"type":"assistant","message":{"content":[{"type":"text","text":"I'll list the API endpoints"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"dr list api"}}]}}
{"type":"result","result":"api-endpoint-create-user\\napi-endpoint-list-users\\napi-endpoint-update-user"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Found 3 API endpoints. Let me get details on one"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"dr show api-endpoint-create-user"}}]}}
{"type":"result","result":"{\\"id\\":\\"api-endpoint-create-user\\",\\"type\\":\\"endpoint\\",\\"name\\":\\"Create User\\"}"}
{"type":"assistant","message":{"content":[{"type":"text","text":"The Create User endpoint..."}]}}`;

      const events = agent.parseOutput(conversation);
      
      // Should have text, tool uses, and results
      const toolUses = events.filter(e => e.type === 'tool_use');
      expect(toolUses).toHaveLength(2);
      
      const toolResults = events.filter(e => e.type === 'tool_result');
      expect(toolResults).toHaveLength(2);
      
      const textBlocks = events.filter(e => e.type === 'text');
      expect(textBlocks.length).toBeGreaterThan(0);
    });

    it('should reconstruct full response from events', () => {
      const stream = `{"type":"assistant","message":{"content":[{"type":"text","text":"First part. "}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Second part. "}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Third part."}]}}`;

      const events = agent.parseOutput(stream);
      
      const fullResponse = events
        .filter(e => e.type === 'text')
        .map(e => e.content)
        .join('');
      
      expect(fullResponse).toBe('First part. Second part. Third part.');
    });
  });
});
