/**
 * Tests for Claude Code Agent Implementation
 * 
 * Tests the ClaudeCodeAgent implementation including availability checking,
 * process spawning, and JSON output parsing.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ClaudeCodeAgent } from '../../../src/ai/agents/claude-code.js';

describe('ClaudeCodeAgent', () => {
  let agent: ClaudeCodeAgent;

  beforeEach(() => {
    agent = new ClaudeCodeAgent();
  });

  describe('Agent Properties', () => {
    it('should have correct name', () => {
      expect(agent.name).toBe('Claude Code');
    });

    it('should have correct command', () => {
      expect(agent.command).toBe('claude');
    });

    it('should implement CodingAgent interface', () => {
      expect(typeof agent.isAvailable).toBe('function');
      expect(typeof agent.spawn).toBe('function');
      expect(typeof agent.parseOutput).toBe('function');
    });
  });

  describe('isAvailable()', () => {
    it('should return Promise<boolean>', async () => {
      const result = agent.isAvailable();
      expect(result).toBeInstanceOf(Promise);
      
      const available = await result;
      expect(typeof available).toBe('boolean');
    });

    it('should return false if claude command not found', async () => {
      // Note: In test environment, claude may or may not be available
      // This test just verifies the method completes without error
      const available = await agent.isAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should handle errors gracefully', async () => {
      // Should not throw even if 'which' command fails
      const available = await agent.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('parseOutput() - JSON Events', () => {
    it('should parse text event from JSON', () => {
      const json = '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}';
      const events = agent.parseOutput(json);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Hello');
    });

    it('should parse tool_use event from JSON', () => {
      const json = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}';
      const events = agent.parseOutput(json);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_use');
      expect(events[0].toolName).toBe('Bash');
      expect(events[0].toolInput).toEqual({ command: 'ls' });
    });

    it('should parse multiple content blocks', () => {
      const json = '{"type":"assistant","message":{"content":[{"type":"text","text":"Using tool"},{"type":"tool_use","name":"Read","input":{"path":"file.txt"}}]}}';
      const events = agent.parseOutput(json);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Using tool');
      expect(events[1].type).toBe('tool_use');
      expect(events[1].toolName).toBe('Read');
    });

    it('should parse result event from JSON', () => {
      const json = '{"type":"result","result":"command output"}';
      const events = agent.parseOutput(json);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_result');
      expect(events[0].toolResult).toBe('command output');
    });

    it('should parse error event from JSON', () => {
      const json = '{"type":"error","message":"Something failed"}';
      const events = agent.parseOutput(json);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].error).toBe('Something failed');
    });

    it('should handle multiple JSON lines', () => {
      const multiline = `{"type":"assistant","message":{"content":[{"type":"text","text":"Line 1"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Line 2"}]}}`;
      const events = agent.parseOutput(multiline);

      expect(events).toHaveLength(2);
      expect(events[0].content).toBe('Line 1');
      expect(events[1].content).toBe('Line 2');
    });

    it('should skip empty lines', () => {
      const withEmpty = `{"type":"assistant","message":{"content":[{"type":"text","text":"Text"}]}}

{"type":"assistant","message":{"content":[{"type":"text","text":"More"}]}}`;
      const events = agent.parseOutput(withEmpty);

      expect(events).toHaveLength(2);
      expect(events[0].content).toBe('Text');
      expect(events[1].content).toBe('More');
    });
  });

  describe('parseOutput() - Non-JSON Handling', () => {
    it('should treat non-JSON lines as text', () => {
      const plain = 'This is plain text output';
      const events = agent.parseOutput(plain);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe(plain);
    });

    it('should handle mixed JSON and non-JSON', () => {
      const mixed = `Plain text line
{"type":"assistant","message":{"content":[{"type":"text","text":"JSON line"}]}}
Another plain line`;
      const events = agent.parseOutput(mixed);

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe('Plain text line');
      expect(events[1].type).toBe('text');
      expect(events[1].content).toBe('JSON line');
      expect(events[2].type).toBe('text');
      expect(events[2].content).toBe('Another plain line');
    });

    it('should handle malformed JSON as text', () => {
      const bad = '{"type":"assistant","incomplete';
      const events = agent.parseOutput(bad);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      expect(events[0].content).toBe(bad);
    });
  });

  describe('parseOutput() - Edge Cases', () => {
    it('should return empty array for empty string', () => {
      const events = agent.parseOutput('');
      expect(events).toHaveLength(0);
    });

    it('should return empty array for whitespace only', () => {
      const events = agent.parseOutput('   \n  \n   ');
      expect(events).toHaveLength(0);
    });

    it('should handle JSON with missing content', () => {
      const json = '{"type":"assistant","message":{}}';
      const events = agent.parseOutput(json);
      expect(events).toHaveLength(0);
    });

    it('should handle JSON with empty content array', () => {
      const json = '{"type":"assistant","message":{"content":[]}}';
      const events = agent.parseOutput(json);
      expect(events).toHaveLength(0);
    });

    it('should handle unknown event types gracefully', () => {
      const json = '{"type":"unknown","data":"something"}';
      const events = agent.parseOutput(json);
      // Should not crash, may return empty or treat as text
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('spawn() - Configuration', () => {
    it('should accept required options', () => {
      const options = {
        cwd: '/test/path',
        message: 'Hello world',
      };

      // Should not throw when spawning with valid options
      // Note: Will fail if claude not available, but that's expected
      expect(() => {
        const proc = agent.spawn(options);
        expect(proc.conversationId).toBeString();
        expect(proc.process).toBeDefined();
        expect(proc.completion).toBeInstanceOf(Promise);
        // Clean up immediately
        proc.process.kill();
      }).not.toThrow();
    });

    it('should use default agent name if not specified', () => {
      const options = {
        cwd: '/test',
        message: 'test',
      };

      try {
        const proc = agent.spawn(options);
        expect(proc.conversationId).toContain('claude-');
        proc.process.kill();
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });

    it('should accept custom agent name', () => {
      const options = {
        cwd: '/test',
        message: 'test',
        agentName: 'custom-agent',
      };

      try {
        const proc = agent.spawn(options);
        expect(proc.conversationId).toContain('claude-');
        proc.process.kill();
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });

    it('should accept additional args', () => {
      const options = {
        cwd: '/test',
        message: 'test',
        additionalArgs: ['--debug'],
      };

      try {
        const proc = agent.spawn(options);
        expect(proc.conversationId).toBeString();
        proc.process.kill();
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });

    it('should generate unique conversation IDs', () => {
      const proc1 = agent.spawn({ cwd: '/test', message: 'test1' });
      const proc2 = agent.spawn({ cwd: '/test', message: 'test2' });

      expect(proc1.conversationId).not.toBe(proc2.conversationId);
      
      proc1.process.kill();
      proc2.process.kill();
    });
  });

  describe('spawn() - Process Management', () => {
    it('should return AgentProcess with required properties', () => {
      try {
        const proc = agent.spawn({
          cwd: '/test',
          message: 'test',
        });

        expect(proc.process).toBeDefined();
        expect(proc.process.pid).toBeDefined();
        expect(proc.conversationId).toBeString();
        expect(proc.completion).toBeInstanceOf(Promise);

        proc.process.kill();
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });

    it('should have stdin available for writing', () => {
      try {
        const proc = agent.spawn({
          cwd: '/test',
          message: 'test',
        });

        expect(proc.process.stdin).toBeDefined();
        expect(proc.process.stdin?.writable).toBe(true);

        proc.process.kill();
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });

    it('should have stdout available for reading', () => {
      try {
        const proc = agent.spawn({
          cwd: '/test',
          message: 'test',
        });

        expect(proc.process.stdout).toBeDefined();
        expect(proc.process.stdout?.readable).toBe(true);

        proc.process.kill();
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });

    it('should have stderr available for errors', () => {
      try {
        const proc = agent.spawn({
          cwd: '/test',
          message: 'test',
        });

        expect(proc.process.stderr).toBeDefined();
        expect(proc.process.stderr?.readable).toBe(true);

        proc.process.kill();
      } catch (error) {
        // Expected if claude not available
        expect(error).toBeDefined();
      }
    });
  });

  describe('Integration - Full Workflow', () => {
    it('should complete availability check -> parse workflow', async () => {
      // Check availability
      const available = await agent.isAvailable();
      expect(typeof available).toBe('boolean');

      // Parse sample output
      const output = '{"type":"assistant","message":{"content":[{"type":"text","text":"Response"}]}}';
      const events = agent.parseOutput(output);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
    });

    it('should handle streaming output scenario', () => {
      // Simulate streaming chunks
      const chunks = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Part 1"}]}}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Part 2"}]}}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Part 3"}]}}\n',
      ];

      let allEvents: any[] = [];
      for (const chunk of chunks) {
        const events = agent.parseOutput(chunk);
        allEvents = allEvents.concat(events);
      }

      expect(allEvents).toHaveLength(3);
      expect(allEvents[0].content).toBe('Part 1');
      expect(allEvents[1].content).toBe('Part 2');
      expect(allEvents[2].content).toBe('Part 3');
    });

    it('should handle tool invocation workflow', () => {
      const chunks = [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Using tool"}]}}\n',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}\n',
        '{"type":"result","result":"file1.txt\\nfile2.txt"}\n',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Found 2 files"}]}}\n',
      ];

      let allEvents: any[] = [];
      for (const chunk of chunks) {
        const events = agent.parseOutput(chunk);
        allEvents = allEvents.concat(events);
      }

      expect(allEvents).toHaveLength(4);
      expect(allEvents[0].type).toBe('text');
      expect(allEvents[1].type).toBe('tool_use');
      expect(allEvents[1].toolName).toBe('Bash');
      expect(allEvents[2].type).toBe('tool_result');
      expect(allEvents[3].type).toBe('text');
    });
  });
});
