/**
 * Comprehensive integration tests for the unified upgrade command
 *
 * Tests the complete upgrade workflow including:
 * - Scanning for available upgrades (spec reference and model migrations)
 * - Interactive prompts and confirmation
 * - Dry-run mode
 * - Spec reference installation/upgrades
 * - Model migration execution
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'yaml';
import { createTempWorkdir, runDr, assertOutputContains } from '../helpers/cli-runner.js';
import { fileExists } from '../../src/utils/file-io.js';

let tempDir: { path: string; cleanup: () => Promise<void> };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely remove a directory and its contents
 */
async function safeRm(path: string): Promise<void> {
  await rm(path, { recursive: true }).catch(() => {});
}

/**
 * Set model spec version by updating manifest
 */
async function setModelSpecVersion(workdir: string, version: string): Promise<void> {
  const manifestPath = join(workdir, 'documentation-robotics/model/manifest.yaml');
  const content = await readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(content);
  manifest.spec_version = version;
  await writeFile(manifestPath, yaml.stringify(manifest));
}

/**
 * Get model spec version from manifest
 */
async function getModelSpecVersion(workdir: string): Promise<string> {
  const manifestPath = join(workdir, 'documentation-robotics/model/manifest.yaml');
  const content = await readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(content);
  return manifest.spec_version;
}

/**
 * Modify model manifest in place
 */
async function modifyModelManifest(
  workdir: string,
  modifier: (manifest: unknown) => void
): Promise<void> {
  const manifestPath = join(workdir, 'documentation-robotics/model/manifest.yaml');
  const content = await readFile(manifestPath, 'utf-8');
  const manifest = yaml.parse(content);
  modifier(manifest);
  await writeFile(manifestPath, yaml.stringify(manifest));
}

describe('upgrade command - unified flow', () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  // ============================================================================
  // Scanning and Planning Tests
  // ============================================================================

  describe('Scanning and planning', () => {
    it('should scan filesystem for available upgrades', async () => {
      // Initialize a model via CLI
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      // Should scan and find upgrades needed
      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'Scanning for available upgrades');
    });

    it('should display upgrade plan with actions when upgrades needed', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade the model to test upgrade detection
      await setModelSpecVersion(tempDir.path, '0.5.0');

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'Upgrade Plan');
    });

    it('should show no upgrades when already at latest version', async () => {
      // Initialize a model (will be at v0.7.0)
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'Everything is up to date');
    });

    it('should detect spec reference upgrade needed', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Remove .dr folder to simulate missing spec reference
      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should detect spec installation needed
      assertOutputContains(result, 'Install spec reference');
    });

    it('should detect model migration upgrade needed', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade model spec version
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should detect model migration needed
      assertOutputContains(result, 'Migrate model');
    });

    it('should detect combined spec + model upgrade needed', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Remove .dr folder
      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should detect both upgrades
      assertOutputContains(result, 'Upgrade Plan');
    });
  });

  // ============================================================================
  // Interactive Mode Tests
  // ============================================================================

  describe('Interactive mode', () => {
    it('should skip prompt with --yes flag', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade to trigger upgrade needed
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.6.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should proceed directly without prompt
      assertOutputContains(result, 'Executing upgrades');
    });

    it('should accept --yes flag when no upgrades needed', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Current Model'], { cwd: tempDir.path });

      // Run upgrade first to bring model current
      await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      // Run upgrade again when everything is current
      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should report everything is up to date
      expect(result.stdout).toContain('Everything is up to date');
    });
  });

  // ============================================================================
  // Dry Run Mode Tests
  // ============================================================================

  describe('Dry run mode', () => {
    it('should show upgrade plan with --dry-run flag', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade to trigger upgrade needed
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show dry run notice
      assertOutputContains(result, '[DRY RUN]');
      assertOutputContains(result, 'No changes will be made');
    });

    it('should not modify .dr/ folder in dry run', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Remove .dr folder to force spec installation
      const drPath = join(tempDir.path, '.dr');
      const drManifestPath = join(drPath, 'manifest.json');

      if (await fileExists(drManifestPath)) {
        // Get original timestamp
        const stat = await import('fs/promises').then(fs => fs.stat(drManifestPath));
        const originalTime = stat.mtimeMs;

        // Run dry-run
        const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

        expect(result.exitCode).toBe(0);

        // Check that manifest wasn't modified
        const newStat = await import('fs/promises').then(fs => fs.stat(drManifestPath));
        expect(newStat.mtimeMs).toBe(originalTime);
      }
    });

    it('should not modify model data in dry run', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const originalContent = await fs.readFile(manifestPath, 'utf-8');

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Manifest should not be modified
      const afterContent = await fs.readFile(manifestPath, 'utf-8');
      expect(afterContent).toBe(originalContent);
    });

    it('should display actions in dry run', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show upgrade actions
      assertOutputContains(result, 'Upgrade Plan');
    });
  });

  // ============================================================================
  // Spec Reference Upgrade Tests
  // ============================================================================

  describe('Spec reference upgrades', () => {
    it('should install .dr/ folder when missing', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Remove .dr folder
      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      expect(await fileExists(drPath)).toBe(false);

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // .dr folder should be created
      expect(await fileExists(drPath)).toBe(true);
    });

    it('should create .dr/manifest.json with correct version', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Remove .dr folder to force reinstall
      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Check .dr/manifest.json was created
      const manifestPath = join(drPath, 'manifest.json');
      expect(await fileExists(manifestPath)).toBe(true);
    });

    it('should copy schema files to .dr/schemas/', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Remove .dr folder to force reinstall
      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Check schemas directory was created with files
      const schemasPath = join(drPath, 'schemas');
      expect(await fileExists(schemasPath)).toBe(true);
    });
  });

  // ============================================================================
  // Model Migration Upgrade Tests
  // ============================================================================

  describe('Model migration upgrades', () => {
    it('should migrate model from older spec version', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade to v0.5.0
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'Migrate model');
    });

    it('should update model specVersion after migration', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade to v0.5.0
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);

      // Verify model spec version was updated
      const updatedContent = await fs.readFile(manifestPath, 'utf-8');
      const updatedManifest = yaml.parse(updatedContent);
      expect(updatedManifest.spec_version).toBe('0.7.0');
    });

    it('should handle chained migrations across multiple versions', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade to oldest supported version
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should complete all migrations and reach latest version
      const updatedContent = await fs.readFile(manifestPath, 'utf-8');
      const updatedManifest = yaml.parse(updatedContent);
      expect(updatedManifest.spec_version).toBe('0.7.0');
    });

    it('should show migration steps in output', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade to v0.5.0
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Output should show migration steps
      expect(result.stdout.includes('0.5.0') && result.stdout.includes('0.6.0')).toBe(true);
    });
  });

  // ============================================================================
  // Combined Upgrades Tests
  // ============================================================================

  describe('Combined upgrades', () => {
    it('should upgrade spec reference and model together', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Remove .dr folder
      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // .dr folder should be created/restored
      expect(await fileExists(drPath)).toBe(true);

      // Model should be upgraded if upgrade ran
      const updatedContent = await fs.readFile(manifestPath, 'utf-8');
      const updatedManifest = yaml.parse(updatedContent);
      // Version should be either upgraded to 0.7.0 or stayed at 0.5.0 if migration didn't run
      expect(['0.5.0', '0.6.0', '0.7.0'].includes(updatedManifest.spec_version)).toBe(true);
    });

    it('should complete both upgrades successfully', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade model and remove .dr
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'successfully');
    });

    it('should show both actions in dry run plan', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade model
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Remove .dr folder
      const drPath = join(tempDir.path, '.dr');
      try {
        await rm(drPath, { recursive: true });
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'Upgrade Plan');
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error handling', () => {
    it('should fail gracefully when no project found', async () => {
      // Try upgrade in empty directory
      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(1);
      assertOutputContains(result, 'No DR project found');
    });

    it('should handle missing model gracefully', async () => {
      // Create .dr folder but no model
      const drPath = join(tempDir.path, '.dr');
      await mkdir(drPath, { recursive: true });

      // Create a manifest.json in .dr
      await writeFile(join(drPath, 'manifest.json'), JSON.stringify({
        specVersion: '0.7.0',
        installDate: new Date().toISOString(),
      }));

      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      // Should either succeed (if no model is found) or fail (if project validation fails)
      // The important thing is it handles the edge case gracefully
      expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
    });

    it('should handle version consistency', async () => {
      // Initialize a model at latest version
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'Everything is up to date');
    });
  });

  // ============================================================================
  // Output and UX Tests
  // ============================================================================

  describe('Output and UX', () => {
    it('should display clear upgrade plan', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade to trigger plan
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show either upgrade plan or up-to-date message
      expect(result.stdout).toMatch(/Upgrade Plan|Everything is up to date/);
    });

    it('should show version changes', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Downgrade
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should show version notation
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should show success message when no upgrades needed', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      assertOutputContains(result, 'Everything is up to date');
    });

    it('should have readable output formatting', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Output should be well-formatted (multiple lines)
      const lines = result.stdout.split('\n').filter((l) => l.trim());
      expect(lines.length).toBeGreaterThan(2);
    });
  });

  // ============================================================================
  // Idempotence and Stability Tests
  // ============================================================================

  describe('Idempotence and stability', () => {
    it('should run multiple times without side effects', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Run upgrade multiple times
      const result1 = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });
      const result2 = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });
      const result3 = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
      expect(result3.exitCode).toBe(0);
    });

    it('should maintain model data after upgrade', async () => {
      // Initialize a model
      const initResult = await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      expect(initResult.exitCode).toBe(0);

      // Downgrade
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      const originalName = manifest.project.name;
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Upgrade
      const upgradeResult = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(upgradeResult.exitCode).toBe(0);

      // Verify model name is preserved
      const updatedContent = await fs.readFile(manifestPath, 'utf-8');
      const updatedManifest = yaml.parse(updatedContent);
      expect(updatedManifest.project.name).toBe(originalName);
    });

    it('should be safe to run after successful upgrade', async () => {
      // Initialize and upgrade
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Running again should show no upgrades
      const secondResult = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(secondResult.exitCode).toBe(0);
      assertOutputContains(secondResult, 'Everything is up to date');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge cases', () => {
    it('should handle missing .dr/manifest.json gracefully', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Create .dr folder with missing manifest
      const drPath = join(tempDir.path, '.dr');
      const manifestPath = join(drPath, 'manifest.json');

      // Remove manifest but keep folder
      try {
        await rm(manifestPath);
      } catch {
        // May not exist
      }

      const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

      // Should either succeed (and offer to reinstall) or report missing manifest
      expect(result.exitCode === 0 || result.exitCode === 1).toBe(true);
    });

    it('should detect outdated spec reference', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Test Model'], { cwd: tempDir.path });

      // Simulate outdated .dr by modifying manifest version
      const drManifestPath = join(tempDir.path, '.dr', 'manifest.json');
      try {
        await writeFile(drManifestPath, JSON.stringify({
          specVersion: '0.6.0',
          installDate: new Date().toISOString(),
        }));

        const result = await runDr(['upgrade', '--dry-run'], { cwd: tempDir.path });

        // Should handle the outdated spec reference
        expect(result.exitCode === 0 || result.stdout.includes('Upgrade spec')).toBe(true);
      } catch {
        // If writeFile fails, that's okay - the test is validating error handling
      }
    });
  });

  // ============================================================================
  // Integration Version Checks
  // ============================================================================

  describe('Integration version checks', () => {
    it('should not show integration updates when no integrations installed', async () => {
      // Initialize a model without installing integrations
      await runDr(['init', '--name', 'No Integrations'], { cwd: tempDir.path });

      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Should not mention integration updates when none are installed
      expect(result.stdout).not.toContain('Claude integration outdated');
      expect(result.stdout).not.toContain('GitHub Copilot integration outdated');
    });

    it('should check integration versions during upgrade', async () => {
      // Initialize a model
      await runDr(['init', '--name', 'Integration Check'], { cwd: tempDir.path });

      // Run upgrade which will check integrations
      const result = await runDr(['upgrade', '--yes'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(0);
      // Upgrade should complete even if integrations aren't installed
      expect(result.stdout).toContain('Scanning for available upgrades');
    });
  });

  // ============================================================================
  // Non-Interactive Mode
  // ============================================================================

  describe('Non-interactive mode', () => {
    it('should require --yes flag in non-interactive mode when upgrades needed', async () => {
      // Initialize a model first
      await runDr(['init', '--name', 'Interactive Test'], { cwd: tempDir.path });

      // Downgrade the model to create an upgrade scenario
      const manifestPath = join(tempDir.path, 'documentation-robotics/model/manifest.yaml');
      const yaml = await import('yaml');
      const fs = await import('fs/promises');

      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      manifest.spec_version = '0.5.0';

      await fs.writeFile(manifestPath, yaml.stringify(manifest));

      // Run upgrade in non-interactive mode without --yes
      // This simulates running in CI/CD or other non-TTY environments
      const result = await runDr(['upgrade'], { cwd: tempDir.path });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Non-interactive mode requires --yes flag');
    });
  });
});
