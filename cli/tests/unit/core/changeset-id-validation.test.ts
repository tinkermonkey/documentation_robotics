import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { StagingAreaManager } from '../../../src/core/staging-area.js';
import { Model } from '../../../src/core/model.js';
import { rm, mkdir, cp, mkdtemp } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const BASELINE_DIR = fileURLToPath(new URL('../../../../cli-validation/test-project/baseline', import.meta.url));

describe('Changeset ID Validation', () => {
  let model: Model;
  let manager: StagingAreaManager;
  let TEST_DIR: string;

  beforeEach(async () => {
    // Create unique temporary directory for this test
    TEST_DIR = await mkdtemp(path.join(tmpdir(), 'changeset-id-validation-'));

    await mkdir(TEST_DIR, { recursive: true });

    // Copy baseline project
    await cp(BASELINE_DIR, TEST_DIR, { recursive: true });

    // Load model with explicit path
    model = await Model.load(TEST_DIR, { lazyLoad: false });
    manager = new StagingAreaManager(TEST_DIR, model);
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('stage operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.stage('', {
          type: 'add',
          elementId: 'test-elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: { name: 'Test' }
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject whitespace-only changeset ID', async () => {
      try {
        await manager.stage('   ', {
          type: 'add',
          elementId: 'test-elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: { name: 'Test' }
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('empty or whitespace-only');
      }
    });

    it('should reject changeset ID with path separators', async () => {
      try {
        await manager.stage('../../malicious', {
          type: 'add',
          elementId: 'test-elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: { name: 'Test' }
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('path separators');
      }
    });

    it('should reject changeset ID with parent directory traversal', async () => {
      try {
        await manager.stage('..\\windows\\path', {
          type: 'add',
          elementId: 'test-elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: { name: 'Test' }
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('path separators');
      }
    });

    it('should reject changeset ID with invalid special characters', async () => {
      const invalidIds = ['test<id>', 'test>id', 'test:id', 'test"id', 'test|id', 'test?id', 'test*id'];

      for (const invalidId of invalidIds) {
        try {
          await manager.stage(invalidId, {
            type: 'add',
            elementId: 'test-elem',
            layerName: 'api',
            timestamp: new Date().toISOString(),
            after: { name: 'Test' }
          });
          expect(true).toBe(false); // Should not reach
        } catch (error) {
          expect(error instanceof Error).toBe(true);
          expect((error as Error).message).toContain('invalid special characters');
        }
      }
    });

    it('should accept valid alphanumeric changeset ID', async () => {
      // Should not throw
      try {
        // We're testing validation passes, so we'll just catch the "not found" error
        // since this ID is just for validation testing
        await manager.stage('valid-test-id-999', {
          type: 'add',
          elementId: 'test-elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: { name: 'Test' }
        });
      } catch (error) {
        // Expected: "not found" error, not validation error
        expect((error as Error).message).toContain('not found');
      }
    });

    it('should accept valid changeset ID with hyphens and underscores', async () => {
      try {
        await manager.stage('valid-test_id-999', {
          type: 'add',
          elementId: 'test-elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: { name: 'Test' }
        });
      } catch (error) {
        // Expected: "not found" error, not validation error
        expect((error as Error).message).toContain('not found');
      }
    });
  });

  describe('unstage operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.unstage('', 'test-elem');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject changeset ID with path traversal', async () => {
      try {
        await manager.unstage('../../../etc/passwd', 'test-elem');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('path separators');
      }
    });

    it('should reject changeset ID with special characters', async () => {
      try {
        await manager.unstage('test<malicious>id', 'test-elem');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('invalid special characters');
      }
    });
  });

  describe('discard operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.discard('');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject changeset ID with path traversal', async () => {
      try {
        await manager.discard('..\\..\\windows');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('path separators');
      }
    });
  });

  describe('captureBaseSnapshot operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.captureBaseSnapshot('');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject changeset ID with invalid characters', async () => {
      try {
        await manager.captureBaseSnapshot('test|invalid:id');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('invalid special characters');
      }
    });
  });

  describe('detectDrift operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.detectDrift('');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject changeset ID with path traversal', async () => {
      try {
        await manager.detectDrift('../../sensitive');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('path separators');
      }
    });
  });

  describe('commit operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.commit(model, '');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject changeset ID with special characters', async () => {
      try {
        await manager.commit(model, 'test"dangerous"id');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('invalid special characters');
      }
    });
  });

  describe('isActive operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.isActive('');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject changeset ID with path traversal', async () => {
      try {
        await manager.isActive('..\\..\\sensitive\\data');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('path separators');
      }
    });
  });

  describe('setActive operation validation', () => {
    it('should reject empty changeset ID', async () => {
      try {
        await manager.setActive('');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject changeset ID with special characters', async () => {
      try {
        await manager.setActive('test:invalid:id');
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('invalid special characters');
      }
    });
  });

  describe('validation error messages', () => {
    it('should provide clear error message for path traversal attempts', async () => {
      try {
        await manager.stage('../../../dangerous', {
          type: 'add',
          elementId: 'elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: {}
        });
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('path separators');
        expect(message).toContain('..');
      }
    });

    it('should provide clear error message for special characters', async () => {
      try {
        await manager.stage('test<script>alert()', {
          type: 'add',
          elementId: 'elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: {}
        });
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('invalid special characters');
        expect(message).toContain('<>');
      }
    });
  });

  describe('edge cases', () => {
    it('should reject null changeset ID', async () => {
      try {
        await manager.stage(null as any, {
          type: 'add',
          elementId: 'elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: {}
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject undefined changeset ID', async () => {
      try {
        await manager.stage(undefined as any, {
          type: 'add',
          elementId: 'elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: {}
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should reject numeric changeset ID', async () => {
      try {
        await manager.stage(12345 as any, {
          type: 'add',
          elementId: 'elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: {}
        });
        expect(true).toBe(false); // Should not reach
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('non-empty string');
      }
    });

    it('should normalize mixed case in changeset ID (sanitizeId handles)', async () => {
      // After sanitization, uppercase gets lowercased
      // So validation should pass as the storage layer handles this
      try {
        await manager.stage('ValidID', {
          type: 'add',
          elementId: 'elem',
          layerName: 'api',
          timestamp: new Date().toISOString(),
          after: {}
        });
      } catch (error) {
        // Expected: "not found" error, not validation error
        expect((error as Error).message).toContain('not found');
      }
    });
  });
});
