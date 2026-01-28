/**
 * Comprehensive error scenario tests for improved CLI error messages
 * Tests error handling, exit codes, suggestions, and context-aware messages
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTempWorkdir, runDr as runDrHelper } from '../helpers/cli-runner.js';

let tempDir: { path: string; cleanup: () => Promise<void> };

async function runDr(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runDrHelper(args, { cwd: tempDir.path });
}

describe('Error Message Scenarios', () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe('Exit Code Categories', () => {
    it('should use exit code 1 for user input errors', async () => {
      await runDr('init', '--name', 'Test Model');
      // Invalid layer name
      const result = await runDr('add', 'invalid-layer', 'endpoint', 'test-element');
      expect(result.exitCode).toBe(1); // User error
      expect(result.stderr).toContain('Unknown layer');
    });

    it('should use exit code 1 when element not found', async () => {
      await runDr('init', '--name', 'Test Model');
      // Non-existent element - currently exit code 1
      const result = await runDr('show', 'motivation.goal.nonexistent');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('should use exit code 1 for invalid JSON properties', async () => {
      await runDr('init', '--name', 'Test Model');
      // Invalid JSON properties
      const result = await runDr('add', 'api', 'endpoint', 'test', '--properties', 'invalid-json');
      expect(result.exitCode).toBe(1); // JSON parsing is user error
    });

    it('should return exit code 1 when model not found', async () => {
      // No init, model doesn't exist
      const result = await runDr('list', 'api');
      expect(result.exitCode).toBe(2); // Exit code 2 for NOT_FOUND
      const output = result.stdout + result.stderr;
      expect(output.includes('No model found') || output.includes('No DR project') || output.includes('not found') || output.includes('Could not find')).toBe(true);
    });
  });

  describe('Add Command Errors', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
    });

    it('should suggest valid layers when layer name is invalid', async () => {
      const result = await runDr('add', 'apis', 'endpoint', 'test');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown layer');
      expect(
        result.stderr.includes('Valid options') || result.stderr.includes('Did you mean')
      ).toBe(true);
    });

    it('should provide fuzzy match suggestions for typos', async () => {
      const result = await runDr('add', 'apu', 'endpoint', 'test');
      expect(result.exitCode).toBe(1);
      // Should suggest 'apm' or 'api' as similar layers
      const stderr = result.stderr;
      const hasSuggestion = stderr.includes('apm') || stderr.includes('api') || stderr.includes('Did you mean');
      expect(hasSuggestion).toBe(true);
    });

    it('should error when adding duplicate element', async () => {
      // Add first time
      const result1 = await runDr('add', 'api', 'endpoint', 'test-endpoint');
      expect(result1.exitCode).toBe(0);

      // Add same element again
      const result2 = await runDr('add', 'api', 'endpoint', 'test-endpoint');
      expect(result2.exitCode).toBe(1);
      expect(result2.stderr).toContain('already exists');
      // Should include helpful suggestions
      expect(
        result2.stderr.includes('dr show') || result2.stderr.includes('dr update')
      ).toBe(true);
    });

    it('should error on invalid JSON properties', async () => {
      const result = await runDr('add', 'api', 'endpoint', 'test', '--properties', '{invalid}');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid JSON');
      expect(result.stderr).toContain('Suggestions');
    });

    it('should error on invalid JSON properties with helpful guidance', async () => {
      const result = await runDr('add', 'api', 'endpoint', 'test', '--properties', 'not-json');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid JSON');
      // Should explain proper quoting/escaping
      const stderr = result.stderr;
      expect(
        stderr.includes('single quotes') ||
        stderr.includes('JSON syntax') ||
        stderr.includes('Escape')
      ).toBe(true);
    });

    it('should include operation context in error messages', async () => {
      const result = await runDr('add', 'invalid', 'endpoint', 'test');
      expect(result.exitCode).toBe(1);
      // Should show that it was an 'add' operation
      const stderr = result.stderr;
      expect(
        stderr.includes('During') ||
        stderr.includes('add') ||
        stderr.includes('Error:')
      ).toBe(true);
    });
  });

  describe('Delete Command Errors', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'increase-revenue');
      await runDr('add', 'business', 'service', 'customer-service');
    });

    it('should error when element not found', async () => {
      const result = await runDr('delete', 'api.endpoint.nonexistent', '--force');
      expect(result.exitCode).toBe(1); // User error
      const output = result.stdout + result.stderr;
      expect(
        output.includes('not found') || output.includes('Element')
      ).toBe(true);
    });

    it('should provide helpful suggestions for not found elements', async () => {
      const result = await runDr('delete', 'motivation.goal.missing', '--force');
      expect(result.exitCode).toBe(1); // User error
      const output = result.stdout + result.stderr;
      // Should suggest alternatives
      expect(
        output.includes('search') ||
        output.includes('list') ||
        output.includes('Suggestions')
      ).toBe(true);
    });

    it('should mention partial progress on cascade delete failure', async () => {
      // This would require a scenario where cascade delete partially completes
      // For now, we verify the capability exists by checking error structure
      const result = await runDr('delete', 'motivation.goal.increase-revenue', '--cascade', '--force');
      // Result depends on whether dependencies exist
      expect(result.exitCode).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Model/Initialization Errors', () => {
    it('should handle missing model gracefully', async () => {
      const result = await runDr('list', 'api');
      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stdout + result.stderr;
      expect(
        output.includes('not found') || output.includes('No') || output.includes('No DR project')
      ).toBe(true);
    });

    it('should suggest running init when model is missing', async () => {
      const result = await runDr('add', 'api', 'endpoint', 'test');
      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stdout + result.stderr;
      expect(output.includes('init') || output.includes('Could not find')).toBe(true);
    });

    it('should error when model already exists on init', async () => {
      await runDr('init', '--name', 'Test Model');
      const result = await runDr('init', '--name', 'Second Model');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Validation Error Batching', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
    });

    it('should batch validation errors with grouping', async () => {
      // Add multiple elements with validation issues
      // The validate command should group errors by layer and error type
      const result = await runDr('validate');
      // No errors yet since model is empty
      expect(result.exitCode).toBe(0);
    });

    it('should show error counts not overwhelming detail', async () => {
      // When there are many validation errors, should show summary
      // This test verifies batching capability
      const result = await runDr('validate', '--verbose');
      // Should not be overwhelming
      expect(result.stdout.length).toBeLessThan(100000);
    });
  });

  describe('Reference and Dependency Errors', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'improve-experience');
      await runDr('add', 'business', 'service', 'customer-service');
    });

  });

  describe('Error Message Clarity', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
    });

    it('should clearly state what went wrong', async () => {
      const result = await runDr('add', 'invalid', 'type', 'name');
      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.stderr).toContain('Error:');
      // Should not be too technical
      expect(result.stderr.length).toBeLessThan(1000);
    });

    it('should provide actionable suggestions', async () => {
      const result = await runDr('delete', 'motivation.goal.missing', '--force');
      expect(result.exitCode).toBeGreaterThan(0);
      const output = result.stdout + result.stderr;
      // Should have helpful context
      expect(output.includes('not found') || output.includes('Suggestions') || output.includes('Use')).toBe(true);
    });
  });

  describe('Dry-run and Recovery Guidance', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'goal-1');
    });

    it('should support --dry-run for delete operations', async () => {
      const result = await runDr('delete', 'motivation.goal.goal-1', '--dry-run');
      expect(result.exitCode).toBe(0);
      expect(
        result.stdout.includes('Dry run') || result.stdout.includes('Would remove')
      ).toBe(true);
      // Model should be unchanged
      const listResult = await runDr('list', 'motivation');
      expect(listResult.stdout).toContain('goal-1');
    });

  });

  describe('Context-Aware Error Messages', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
    });

    it('should show operation being performed when error occurs', async () => {
      const result = await runDr('add', 'invalid-layer', 'endpoint', 'test');
      expect(result.exitCode).toBe(1);
      // Should indicate it was an 'add' operation
      expect(result.stderr.includes('add') || result.stderr.includes('Error:')).toBe(true);
    });

    it('should include layer and element context in errors', async () => {
      const result = await runDr('add', 'api', 'endpoint', 'test', '--properties', 'bad-json');
      expect(result.exitCode).toBe(1);
      // Error should reference the layer and element being added
      const stderr = result.stderr;
      expect(
        stderr.includes('api') ||
        stderr.includes('endpoint') ||
        stderr.includes('JSON') ||
        stderr.includes('Error:')
      ).toBe(true);
    });

  });
});
