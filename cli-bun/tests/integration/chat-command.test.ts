/**
 * Integration tests for Chat Command
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Model } from '../../src/core/model';
import { Manifest } from '../../src/core/manifest';
import { Layer } from '../../src/core/layer';
import { Element } from '../../src/core/element';
import { ClaudeClient } from '../../src/ai/claude-client';
import { ModelContextProvider } from '../../src/ai/context-provider';
import { getModelTools } from '../../src/ai/tools';

describe('Chat Integration', () => {
  let testDir: string;
  let model: Model;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = join(tmpdir(), `dr-chat-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create a test model
    const manifest = new Manifest('Integration Test Model', '1.0.0', 'Integration test model');
    model = new Model(testDir, manifest);

    // Add test data
    const layer = new Layer('api');
    layer.addElement(
      new Element('api-endpoint-list-users', 'endpoint', 'List Users', 'Returns a list of users')
    );
    layer.addElement(
      new Element('api-endpoint-create-user', 'endpoint', 'Create User', 'Creates a new user')
    );
    model.addLayer(layer);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors
    }
  });

  describe('ClaudeClient', () => {
    it('should initialize without errors', () => {
      const client = new ClaudeClient('test-api-key');
      expect(client).toBeDefined();
    });

    it('should maintain conversation history', () => {
      const client = new ClaudeClient('test-api-key');

      // Start with empty history
      expect(client.getHistoryLength()).toBe(0);

      // Clear history should not raise errors
      client.clearHistory();
      expect(client.getHistoryLength()).toBe(0);
    });

    it('should provide conversation history copy', () => {
      const client = new ClaudeClient('test-api-key');
      const history1 = client.getHistory();
      const history2 = client.getHistory();

      expect(history1).toEqual(history2);
      expect(history1).not.toBe(history2); // Verify it's a copy
    });
  });

  describe('ModelContextProvider', () => {
    it('should generate context successfully', async () => {
      const provider = new ModelContextProvider(model);
      const context = await provider.generateContext();

      expect(context).toContain('Integration Test Model');
      expect(context).toContain('1.0.0');
      expect(context).toBeString();
      expect(context.length).toBeGreaterThan(100);
    });

    it('should include element information in context', async () => {
      const provider = new ModelContextProvider(model);
      const context = await provider.generateContext();

      expect(context).toContain('List Users');
      expect(context).toContain('Create User');
    });

    it('should provide available layers', () => {
      const provider = new ModelContextProvider(model);
      const layers = provider.getAvailableLayers();

      expect(layers).toContain('api');
      expect(layers).toContain('motivation');
      expect(layers.length).toBe(12);
    });

    it('should get layer element counts', async () => {
      const provider = new ModelContextProvider(model);
      const count = await provider.getLayerElementCount('api');

      expect(count).toBe(2);
    });

    it('should get total element count', async () => {
      const provider = new ModelContextProvider(model);
      const count = await provider.getTotalElementCount();

      expect(count).toBe(2);
    });
  });

  describe('Tool Integration', () => {
    it('should get valid tool definitions', () => {
      const tools = getModelTools();

      expect(tools).toBeArray();
      expect(tools.length).toBe(4);

      // Verify all tools are defined
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('dr_list');
      expect(toolNames).toContain('dr_find');
      expect(toolNames).toContain('dr_search');
      expect(toolNames).toContain('dr_trace');
    });

    it('should have proper tool schemas', () => {
      const tools = getModelTools();

      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('input_schema');

        const schema = tool.input_schema;
        expect(schema.type).toBe('object');
        expect(schema.properties).toBeDefined();
        expect(schema.required).toBeArray();
        expect(schema.required.length).toBeGreaterThan(0);
      }
    });
  });

  describe('End-to-end Chat Setup', () => {
    it('should set up chat with model context', async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        // Skip if API key not available
        return;
      }

      const client = new ClaudeClient(apiKey);
      const contextProvider = new ModelContextProvider(model);
      const tools = getModelTools();

      expect(client).toBeDefined();
      expect(tools.length).toBe(4);

      const context = await contextProvider.generateContext();
      expect(context.length).toBeGreaterThan(0);
    });

    it('should support system prompt with context', async () => {
      const provider = new ModelContextProvider(model);
      const context = await provider.generateContext();

      const systemPrompt = `You are an assistant analyzing an architecture model.

${context}

Use tools to query the model.`;

      expect(systemPrompt).toContain('Integration Test Model');
      expect(systemPrompt).toContain('You are an assistant');
    });
  });
});
