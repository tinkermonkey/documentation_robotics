/**
 * Compatibility tests for edge cases
 * Verifies error handling and edge case behavior matches between CLIs
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CLIHarness } from './harness.js';

const harness = new CLIHarness();
let testDir: string;

describe('Edge Cases Compatibility', () => {
  beforeEach(async () => {
    testDir = `/tmp/dr-compat-edge-${Date.now()}`;
    await harness.createTestDirectory(testDir);
  });

  afterEach(async () => {
    await harness.cleanupTestDirectory(testDir);
  });

  describe('missing arguments', () => {
    it('should fail equivalently with missing model name', async () => {
      const result = await harness.compareOutputs(['init'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should fail equivalently with missing layer in add', async () => {
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }

      const result = await harness.compareOutputs(
        ['add', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should fail equivalently with missing element type in add', async () => {
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }

      const result = await harness.compareOutputs(
        ['add', 'motivation', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should fail equivalently with missing element id in add', async () => {
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }

      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });
  });

  describe('invalid arguments', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should fail equivalently with unknown command', async () => {
      const result = await harness.compareOutputs(['unknown-command'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should fail equivalently with invalid layer name', async () => {
      const result = await harness.compareOutputs(
        ['add', 'nonexistent-layer', 'goal', 'id', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should fail equivalently with empty element name', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', ''],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      // Either both succeed with empty name or both fail
      expect(result.pythonResult.exitCode).toBe(result.bunResult.exitCode);
    });
  });

  describe('special characters', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should handle unicode in element names', async () => {
      const result = await harness.compareOutputs(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-unicode',
          '--name',
          'Test with unicode: 你好',
        ],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(result.bunResult.exitCode);
    });

    it('should handle special chars in names', async () => {
      const result = await harness.compareOutputs(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-special',
          '--name',
          'Test with special: @#$%',
        ],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(result.bunResult.exitCode);
    });

    it('should handle quotes in names', async () => {
      const result = await harness.compareOutputs(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-quotes',
          '--name',
          'Test with "quotes"',
        ],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(result.bunResult.exitCode);
    });
  });

  describe('duplicate operations', () => {
    beforeEach(async () => {
      // Initialize models and add element for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
          testDir
        );
      }
    });

    it('should fail equivalently when adding duplicate element', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Duplicate'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should fail equivalently when initializing twice', async () => {
      const result = await harness.compareOutputs(['init', '--name', 'Second'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });
  });

  describe('case sensitivity', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should handle lowercase layer names', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should fail equivalently with uppercase layer names', async () => {
      const result = await harness.compareOutputs(
        ['add', 'MOTIVATION', 'goal', 'MOTIVATION-goal-test', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });
  });

  describe('command variations', () => {
    it('should handle --help flag', async () => {
      const result = await harness.compareOutputs(['--help']);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should handle -h shorthand', async () => {
      const result = await harness.compareOutputs(['-h']);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should handle --version flag', async () => {
      const result = await harness.compareOutputs(['--version']);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should handle -v shorthand', async () => {
      const result = await harness.compareOutputs(['-v']);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });
  });

  describe('state consistency', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should have consistent state after add', async () => {
      // Add element
      await harness.runPython(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
        testDir
      );
      await harness.runBun(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
        testDir
      );

      // Verify with list
      const result = await harness.compareOutputs(['list', 'motivation'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should have consistent state after delete', async () => {
      // Add element
      await harness.runPython(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
        testDir
      );
      await harness.runBun(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
        testDir
      );

      // Delete element
      await harness.runPython(['delete', 'motivation-goal-test', '--force'], testDir);
      await harness.runBun(['delete', 'motivation-goal-test', '--force'], testDir);

      // Verify with show
      const result = await harness.compareOutputs(['show', 'motivation-goal-test'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should have consistent state after update', async () => {
      // Add element
      await harness.runPython(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Original'],
        testDir
      );
      await harness.runBun(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Original'],
        testDir
      );

      // Update element
      await harness.runPython(
        ['update', 'motivation-goal-test', '--name', 'Updated'],
        testDir
      );
      await harness.runBun(['update', 'motivation-goal-test', '--name', 'Updated'], testDir);

      // Verify with show
      const result = await harness.compareOutputs(['show', 'motivation-goal-test'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });
  });
});
