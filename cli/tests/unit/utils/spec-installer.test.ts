import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, access, readFile } from 'fs/promises';
import path from 'path';
import { installSpecReference, needsSpecReferenceInstall } from '../../../src/utils/spec-installer.js';

describe('spec-installer', () => {
  describe('needsSpecReferenceInstall', () => {
    it('should return true if .dr/manifest.json does not exist', async () => {
      // Create a unique test directory for this test
      const testDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      await mkdir(testDir, { recursive: true });

      try {
        const result = await needsSpecReferenceInstall(testDir);
        expect(result).toBe(true);
      } finally {
        try {
          await rm(testDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle non-existent project root gracefully', async () => {
      const nonExistentDir = path.join('/tmp', `spec-installer-test-${Date.now()}-${Math.random().toString(36).substring(7)}`, 'does-not-exist');
      const result = await needsSpecReferenceInstall(nonExistentDir);
      expect(result).toBe(true);
    });
  });
});
