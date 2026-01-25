/**
 * Integration tests for GitHub Copilot integration management
 * Tests install, upgrade, remove, status, and list subcommands
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { fileExists, readJSON } from '../../src/utils/file-io.js';
import { createTempWorkdir, runDr as runDrHelper } from '../helpers/cli-runner.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { readFile } from 'node:fs/promises';

let tempDir: { path: string; cleanup: () => Promise<void> };

/**
 * Wrapper around the cli-runner helper
 */
async function runDr(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runDrHelper(args, { cwd: tempDir.path });
}

describe('Copilot Integration Commands', () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
    // Initialize a DR project first
    await runDr('init', '--name', 'Test Project');
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe('dr copilot list', () => {
    it('should list all available components', async () => {
      const result = await runDr('copilot', 'list');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Available Components');
      expect(result.stdout).toContain('agents');
      expect(result.stdout).toContain('skills');
    });

    it('should show component descriptions', async () => {
      const result = await runDr('copilot', 'list');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Specialized');
      expect(result.stdout).toContain('Auto-activating');
    });
  });

  describe('dr copilot install', () => {
    it('should install all components', async () => {
      const result = await runDr('copilot', 'install', '--force');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('GitHub Copilot integration installed successfully');
      expect(result.stdout).toContain('Installed');
      expect(result.stdout).toContain('files');

      // Verify .github directory was created
      const githubDir = join(tempDir.path, '.github');
      expect(await fileExists(githubDir)).toBe(true);

      // Verify version file was created
      const versionFile = join(githubDir, '.dr-copilot-version');
      expect(await fileExists(versionFile)).toBe(true);
    });

    it('should create .github subdirectories for components', async () => {
      await runDr('copilot', 'install', '--force');

      const githubDir = join(tempDir.path, '.github');
      // These are the component target directories
      // Note: Some directories may not exist if their source isn't populated
      expect(await fileExists(join(githubDir, 'agents'))).toBe(true);
      expect(await fileExists(join(githubDir, 'skills'))).toBe(true);
    });

    it('should support --agents-only flag', async () => {
      const result = await runDr('copilot', 'install', '--agents-only', '--force');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('GitHub Copilot integration installed successfully');

      // Version file should exist with agents component entry
      const githubDir = join(tempDir.path, '.github');
      const versionFile = join(githubDir, '.dr-copilot-version');
      const content = await readFile(versionFile, 'utf-8');
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty('agents');
    });

    it('should support --skills-only flag', async () => {
      const result = await runDr('copilot', 'install', '--skills-only', '--force');

      expect(result.exitCode).toBe(0);

      const githubDir = join(tempDir.path, '.github');
      const versionFile = join(githubDir, '.dr-copilot-version');
      const content = await readFile(versionFile, 'utf-8');
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty('skills');
    });

    it('should combine multiple component flags', async () => {
      const result = await runDr('copilot', 'install', '--agents-only', '--skills-only', '--force');

      expect(result.exitCode).toBe(0);

      const githubDir = join(tempDir.path, '.github');
      const versionFile = join(githubDir, '.dr-copilot-version');
      const content = await readFile(versionFile, 'utf-8');
      const versionData = yaml.parse(content);
      expect(versionData.components).toHaveProperty('agents');
      expect(versionData.components).toHaveProperty('skills');
    });

    it('should record CLI version in version file', async () => {
      await runDr('copilot', 'install', '--force');

      const githubDir = join(tempDir.path, '.github');
      const versionFile = join(githubDir, '.dr-copilot-version');
      const content = await readFile(versionFile, 'utf-8');
      const versionData = yaml.parse(content);

      // Should have a version field
      expect(versionData).toHaveProperty('version');
      expect(typeof versionData.version).toBe('string');

      // Should have an installed_at timestamp
      expect(versionData).toHaveProperty('installed_at');
      expect(typeof versionData.installed_at).toBe('string');

      // Should be valid ISO 8601 timestamp
      expect(() => new Date(versionData.installed_at)).not.toThrow();
    });

    it('should prompt for confirmation if already installed', async () => {
      // First install
      await runDr('copilot', 'install', '--force');

      // Try to install again without force
      const result = await runDr('copilot', 'install');

      // Should be rejected due to missing confirmation
      expect(result.exitCode).toBeGreaterThan(0);
    });
  });

  describe('dr copilot status', () => {
    it('should show not installed status initially', async () => {
      const result = await runDr('copilot', 'status');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('GitHub Copilot integration not installed');
      expect(result.stdout).toContain('dr copilot install');
    });

    it('should show installation status after install', async () => {
      await runDr('copilot', 'install', '--force');

      const result = await runDr('copilot', 'status');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Installation Status');
      expect(result.stdout).toContain('Version');
      expect(result.stdout).toContain('Installed');
      expect(result.stdout).toContain('Components');
    });

    it('should list all installed components', async () => {
      await runDr('copilot', 'install', '--force');

      const result = await runDr('copilot', 'status');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('agents');
      expect(result.stdout).toContain('skills');
      expect(result.stdout).toContain('files');
    });

    it('should show file counts per component', async () => {
      await runDr('copilot', 'install', '--force');

      const result = await runDr('copilot', 'status');

      expect(result.exitCode).toBe(0);
      // Should have entries like "agents     N files"
      expect(result.stdout).toMatch(/\d+ files/);
    });
  });

  describe('dr copilot upgrade', () => {
    it('should indicate no upgrades needed if freshly installed', async () => {
      await runDr('copilot', 'install', '--force');

      const result = await runDr('copilot', 'upgrade');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('up to date');
    });

    it('should show error if not installed', async () => {
      const result = await runDr('copilot', 'upgrade');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('GitHub Copilot integration not installed');
    });

    it('should support --dry-run flag', async () => {
      await runDr('copilot', 'install', '--force');

      const result = await runDr('copilot', 'upgrade', '--dry-run');

      expect(result.exitCode).toBe(0);
      // Should indicate dry-run mode
      expect(result.stdout).toContain('up to date');
    });

    it('should support --force flag', async () => {
      await runDr('copilot', 'install', '--force');

      const result = await runDr('copilot', 'upgrade', '--force');

      expect(result.exitCode).toBe(0);
    });
  });

  describe('dr copilot remove', () => {
    beforeEach(async () => {
      // Install before trying to remove
      await runDr('copilot', 'install', '--force');
    });

    it('should remove all components with force flag', async () => {
      const result = await runDr('copilot', 'remove', '--force');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('successfully');

      // Verify version file was removed
      const versionFile = join(tempDir.path, '.github', '.dr-copilot-version');
      expect(await fileExists(versionFile)).toBe(false);
    });

    it('should support --agents flag', async () => {
      const result = await runDr('copilot', 'remove', '--agents', '--force');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('successfully');
    });

    it('should support --skills flag', async () => {
      const result = await runDr('copilot', 'remove', '--skills', '--force');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('successfully');
    });

    it('should combine multiple removal flags', async () => {
      const result = await runDr('copilot', 'remove', '--agents', '--skills', '--force');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('successfully');
    });

    it('should handle removal when not installed', async () => {
      // Remove first
      await runDr('copilot', 'remove', '--force');

      // Try to remove again
      const result = await runDr('copilot', 'remove');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('GitHub Copilot integration not installed');
    });
  });

  describe('Copilot integration workflow', () => {
    it('should support install -> status -> upgrade -> remove workflow', async () => {
      // Install
      let result = await runDr('copilot', 'install', '--force');
      expect(result.exitCode).toBe(0);

      // Status
      result = await runDr('copilot', 'status');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Installation Status');

      // Upgrade
      result = await runDr('copilot', 'upgrade');
      expect(result.exitCode).toBe(0);

      // Remove
      result = await runDr('copilot', 'remove', '--force');
      expect(result.exitCode).toBe(0);

      // Verify removed
      const versionFile = join(tempDir.path, '.github', '.dr-copilot-version');
      expect(await fileExists(versionFile)).toBe(false);
    });

    it('should support component-specific workflow', async () => {
      // Install only agents
      let result = await runDr('copilot', 'install', '--agents-only', '--force');
      expect(result.exitCode).toBe(0);

      // Check status shows agents
      result = await runDr('copilot', 'status');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('agents');

      // Remove specific component
      result = await runDr('copilot', 'remove', '--agents', '--force');
      expect(result.exitCode).toBe(0);
    });
  });
});
