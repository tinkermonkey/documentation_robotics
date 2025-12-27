/**
 * Compatibility tests for validation
 * Verifies that Python and Bun CLIs produce equivalent validation results
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { CLIHarness } from './harness.js';

const harness = new CLIHarness();
let testDir: string;

describe('Validation Compatibility', () => {
  beforeEach(async () => {
    testDir = `/tmp/dr-compat-validation-${Date.now()}`;
    await harness.createTestDirectory(testDir);
  });

  afterEach(async () => {
    await harness.cleanupTestDirectory(testDir);
  });

  describe('schema validation', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should validate valid model', async () => {
      const result = await harness.compareOutputs(['validate'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should produce same error count for invalid model', async () => {
      // Both CLIs need to produce the same error count
      const pythonResult = await harness.runPython(['validate'], testDir);
      const bunResult = await harness.runBun(['validate'], testDir);

      const pythonErrors = harness.parseErrorCount(pythonResult.stdout + pythonResult.stderr);
      const bunErrors = harness.parseErrorCount(bunResult.stdout + bunResult.stderr);

      expect(pythonErrors).toBe(bunErrors);
    });
  });

  describe('naming validation', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should accept valid element IDs', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should reject invalid element IDs equivalently', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', 'invalid_ID_123!', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should reject wrong layer prefix equivalently', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', 'business-goal-test', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });
  });

  describe('reference validation', () => {
    beforeEach(async () => {
      // Initialize models and add elements for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
        await runner.call(
          harness,
          ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal'],
          testDir
        );
      }
    });

    it('should accept valid element references', async () => {
      const result = await harness.compareOutputs(['show', 'motivation-goal-test'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should reject nonexistent element references equivalently', async () => {
      const result = await harness.compareOutputs(['show', 'nonexistent-element'], testDir);

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });
  });

  describe('layer validation', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should accept valid layers', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should reject invalid layers equivalently', async () => {
      const result = await harness.compareOutputs(
        ['add', 'invalid-layer', 'goal', 'invalid-layer-goal-test', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should reject invalid element types equivalently', async () => {
      const result = await harness.compareOutputs(
        ['add', 'motivation', 'invalid-type', 'motivation-invalid-test', '--name', 'Test'],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });
  });

  describe('property validation', () => {
    beforeEach(async () => {
      // Initialize models for both CLIs
      for (const cli of ['python', 'bun']) {
        const runner = cli === 'python' ? harness.runPython : harness.runBun;
        await runner.call(harness, ['init', '--name', 'Test Model'], testDir);
      }
    });

    it('should accept valid JSON properties', async () => {
      const result = await harness.compareOutputs(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-test',
          '--name',
          'Test',
          '--properties',
          JSON.stringify({ priority: 'high' }),
        ],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(0);
      expect(result.bunResult.exitCode).toBe(0);
    });

    it('should reject invalid JSON properties equivalently', async () => {
      const result = await harness.compareOutputs(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-test',
          '--name',
          'Test',
          '--properties',
          'not-json',
        ],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });

    it('should reject malformed JSON properties equivalently', async () => {
      const result = await harness.compareOutputs(
        [
          'add',
          'motivation',
          'goal',
          'motivation-goal-test',
          '--name',
          'Test',
          '--properties',
          '{invalid json}',
        ],
        testDir
      );

      expect(result.exitCodesMatch).toBe(true);
      expect(result.pythonResult.exitCode).toBe(1);
      expect(result.bunResult.exitCode).toBe(1);
    });
  });
});
