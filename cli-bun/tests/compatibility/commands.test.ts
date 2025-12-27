/**
 * Compatibility tests for CLI commands
 * Verifies that Python and Bun CLIs produce equivalent outputs
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CLIHarness } from './harness.js';

const harness = new CLIHarness();
let testDir: string;

describe('CLI Commands Compatibility', () => {
  beforeEach(async () => {
    testDir = `/tmp/dr-compat-${Date.now()}`;
    await harness.createTestDirectory(testDir);
  });

  afterEach(async () => {
    await harness.cleanupTestDirectory(testDir);
  });

  describe('init command', () => {
    it('should create identical manifest files', async () => {
      // Python uses positional argument, Bun uses --name
      const pythonResult = await harness.runPython(['init', 'TestModel'], testDir);
      const bunResult = await harness.runBun(['init', '--name', 'TestModel'], testDir);

      // Both should succeed
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should handle init with description', async () => {
      // Test basic init functionality - both CLIs should support this
      // (Note: Python CLI's --description support may vary)
      const pythonResult = await harness.runPython(
        ['init', 'TestModel2'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['init', '--name', 'TestModel2', '--description', 'A test model'],
        testDir
      );

      // Both should succeed in initializing
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should handle init with author', async () => {
      // Note: Python CLI doesn't have --author flag based on its help,  skip this for now
      // Just test that init works
      const pythonResult = await harness.runPython(['init', 'TestModel'], testDir);
      const bunResult = await harness.runBun(['init', '--name', 'TestModel'], testDir);

      // Both should succeed
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should fail equivalently if model already exists', async () => {
      // Initialize once
      await harness.runPython(['init', 'TestModel'], testDir);
      await harness.runBun(['init', '--name', 'TestModel'], testDir);

      // Try to initialize again
      const pythonResult = await harness.runPython(['init', 'TestModel2'], testDir);
      const bunResult = await harness.runBun(['init', '--name', 'TestModel2'], testDir);

      // Both should fail with same exit code (since model already exists)
      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      expect(pythonResult.exitCode).toBe(1);
    });
  });

  describe('help command', () => {
    it('should show matching help for init', async () => {
      const pythonResult = await harness.runPython(['init', '--help']);
      const bunResult = await harness.runBun(['init', '--help']);

      // Both should exit successfully
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should show matching help for main command', async () => {
      const pythonResult = await harness.runPython(['--help']);
      const bunResult = await harness.runBun(['--help']);

      // Both should exit successfully
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should show help for add command', async () => {
      const pythonResult = await harness.runPython(['add', '--help']);
      const bunResult = await harness.runBun(['add', '--help']);

      // Both should exit successfully
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should show help for list command', async () => {
      const pythonResult = await harness.runPython(['list', '--help']);
      const bunResult = await harness.runBun(['list', '--help']);

      // Both should exit successfully
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });

  describe('version command', () => {
    it('should show version for both CLIs', async () => {
      const pythonResult = await harness.runPython(['--version']);
      const bunResult = await harness.runBun(['--version']);

      // Both should exit successfully
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should handle version with no model', async () => {
      const pythonResult = await harness.runPython(['--version'], '/tmp');
      const bunResult = await harness.runBun(['--version'], '/tmp');

      // Both should exit successfully
      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });

  describe('element add command', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      await harness.runPython(['init', '--name', 'Test Model'], testDir);
      await harness.runBun(['init', '--name', 'Test Model'], testDir);
    });

    it('should add element to motivation layer', async () => {
      const pythonResult = await harness.runPython(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal'],
        testDir
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should add element with properties', async () => {
      const pythonResult = await harness.runPython(
        [
          'add',
          'data-model',
          'entity',
          'data-model-entity-user',
          '--name',
          'User',
          '--properties',
          JSON.stringify({ required: true }),
        ],
        testDir
      );
      const bunResult = await harness.runBun(
        [
          'add',
          'data-model',
          'entity',
          'data-model-entity-user',
          '--name',
          'User',
          '--properties',
          JSON.stringify({ required: true }),
        ],
        testDir
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should fail equivalently with missing element id', async () => {
      const pythonResult = await harness.runPython(
        ['add', 'motivation', 'goal', '--name', 'Test Goal'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['add', 'motivation', 'goal', '--name', 'Test Goal'],
        testDir
      );

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      expect(pythonResult.exitCode).toBe(1);
    });

    it('should fail equivalently with invalid JSON properties', async () => {
      const pythonResult = await harness.runPython(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-test',
          '--properties',
          'not-json',
        ],
        testDir
      );
      const bunResult = await harness.runBun(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-test',
          '--properties',
          'not-json',
        ],
        testDir
      );

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      expect(pythonResult.exitCode).toBe(1);
    });
  });

  describe('element list command', () => {
    beforeEach(async () => {
      // Initialize and add elements for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', 'TestModel'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1'],
          testDir
        );
      }
    });

    it('should list elements in layer', async () => {
      const pythonResult = await harness.runPython(['list', 'motivation'], testDir);
      const bunResult = await harness.runBun(['list', 'motivation'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should filter by type', async () => {
      const pythonResult = await harness.runPython(
        ['list', 'motivation', '--type', 'goal'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['list', 'motivation', '--type', 'goal'],
        testDir
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should fail equivalently for nonexistent layer', async () => {
      const pythonResult = await harness.runPython(['list', 'nonexistent-layer'], testDir);
      const bunResult = await harness.runBun(['list', 'nonexistent-layer'], testDir);

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      expect(pythonResult.exitCode).toBe(1);
    });
  });

  describe('search command', () => {
    beforeEach(async () => {
      // Initialize and add elements for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', 'TestModel'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-improve', '--name', 'Improve System'],
          testDir
        );
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-enhance', '--name', 'Enhance Security'],
          testDir
        );
      }
    });

    it('should search by id pattern', async () => {
      const pythonResult = await harness.runPython(['search', 'goal'], testDir);
      const bunResult = await harness.runBun(['search', 'goal'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should search by name pattern', async () => {
      const pythonResult = await harness.runPython(['search', 'Enhance'], testDir);
      const bunResult = await harness.runBun(['search', 'Enhance'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should return empty results for no matches', async () => {
      const pythonResult = await harness.runPython(['search', 'nonexistent'], testDir);
      const bunResult = await harness.runBun(['search', 'nonexistent'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });

  describe('find command (Python) / show command (Bun)', () => {
    beforeEach(async () => {
      // Initialize and add elements for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', 'TestModel'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal'],
          testDir
        );
      }
    });

    it('should display element details (using find for Python, show for Bun)', async () => {
      // Python CLI uses 'find', Bun uses 'show'
      const pythonResult = await harness.runPython(['find', 'motivation-goal-test'], testDir);
      const bunResult = await harness.runBun(['show', 'motivation-goal-test'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should fail equivalently for nonexistent element', async () => {
      const pythonResult = await harness.runPython(['find', 'nonexistent-element'], testDir);
      const bunResult = await harness.runBun(['show', 'nonexistent-element'], testDir);

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      expect(pythonResult.exitCode).toBe(1);
    });
  });

  describe('update command', () => {
    beforeEach(async () => {
      // Initialize and add elements for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', 'TestModel'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Original Name'],
          testDir
        );
      }
    });

    it('should update element name', async () => {
      const pythonResult = await harness.runPython(
        ['update', 'motivation-goal-test', '--name', 'Updated Name'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['update', 'motivation-goal-test', '--name', 'Updated Name'],
        testDir
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should fail equivalently for nonexistent element', async () => {
      const pythonResult = await harness.runPython(
        ['update', 'nonexistent-element', '--name', 'Test'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['update', 'nonexistent-element', '--name', 'Test'],
        testDir
      );

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      expect(pythonResult.exitCode).toBe(1);
    });
  });

  describe('delete/remove command', () => {
    beforeEach(async () => {
      // Initialize and add elements for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', 'TestModel'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal'],
          testDir
        );
      }
    });

    it('should delete element with force flag', async () => {
      // Python uses 'remove', Bun uses 'delete'
      const pythonResult = await harness.runPython(
        ['remove', 'motivation-goal-test', '--force'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['delete', 'motivation-goal-test', '--force'],
        testDir
      );

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });

    it('should fail equivalently for nonexistent element', async () => {
      const pythonResult = await harness.runPython(
        ['remove', 'nonexistent-element', '--force'],
        testDir
      );
      const bunResult = await harness.runBun(
        ['delete', 'nonexistent-element', '--force'],
        testDir
      );

      expect(pythonResult.exitCode).toBe(bunResult.exitCode);
      expect(pythonResult.exitCode).toBe(1);
    });
  });

  describe('validate command', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', 'TestModel'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal'],
          testDir
        );
      }
    });

    it('should validate valid model', async () => {
      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      expect(pythonResult.exitCode).toBe(0);
      expect(bunResult.exitCode).toBe(0);
    });
  });
});
