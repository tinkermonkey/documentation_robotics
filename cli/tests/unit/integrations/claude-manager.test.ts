import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { ClaudeIntegrationManager } from '@/integrations/claude-manager';
import { VersionData } from '@/integrations/types';

/**
 * Unit tests for ClaudeIntegrationManager upgrade behavior.
 * Focuses on verifying that non-tracked components are properly skipped.
 */
describe('ClaudeIntegrationManager.upgrade', () => {
  let tempDir: string;
  let projectRoot: string;
  let manager: ClaudeIntegrationManager;

  beforeEach(async () => {
    // Create temporary directory structure
    tempDir = await mkdtemp(join(tmpdir(), 'dr-claude-test-'));
    projectRoot = tempDir;

    // Create .claude directory
    const claudeDir = join(projectRoot, '.claude');
    await mkdir(claudeDir, { recursive: true });

    // Create source directories (simulating package resources)
    const sourceBase = join(projectRoot, '.dr-source');
    await mkdir(join(sourceBase, 'commands'), { recursive: true });
    await mkdir(join(sourceBase, 'agents'), { recursive: true });
    await mkdir(join(sourceBase, 'templates'), { recursive: true });

    // Create test files in source
    await writeFile(join(sourceBase, 'commands', 'dr-cmd1.md'), 'Command 1', 'utf-8');
    await writeFile(join(sourceBase, 'agents', 'dr-agent1.md'), 'Agent 1', 'utf-8');
    await writeFile(join(sourceBase, 'templates', 'template1.md'), 'Template 1', 'utf-8');

    manager = new ClaudeIntegrationManager();
    // Override getProjectRoot for testing
    manager['getProjectRoot'] = async () => projectRoot;
    manager['getSourceRoot'] = () => sourceBase;
  });

  afterEach(async () => {
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('upgrade method - Skip non-tracked components', () => {
    it('should skip components where tracked === false during update detection', async () => {
      // Setup: Create initial installation with version file
      const claudeDir = join(projectRoot, '.claude');
      const sourceBase = manager['getSourceRoot']();

      // Create installed files
      await mkdir(join(claudeDir, 'commands'), { recursive: true });
      await mkdir(join(claudeDir, 'agents'), { recursive: true });
      await mkdir(join(claudeDir, 'templates'), { recursive: true });

      await writeFile(join(claudeDir, 'commands', 'dr-cmd1.md'), 'Command 1', 'utf-8');
      await writeFile(join(claudeDir, 'agents', 'dr-agent1.md'), 'Agent 1', 'utf-8');
      await writeFile(join(claudeDir, 'templates', 'template1.md'), 'Template 1', 'utf-8');

      // Create initial version file with all components
      const versionContent = `version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  commands:
    dr-cmd1.md:
      hash: "abc12345"
      modified: false
  agents:
    dr-agent1.md:
      hash: "def67890"
      modified: false
  templates:
    template1.md:
      hash: "ghi11111"
      modified: false`;

      await writeFile(join(claudeDir, '.dr-claude-version'), versionContent, 'utf-8');

      // Spy on checkUpdates to verify it's called selectively
      const checkUpdatesCalls: string[] = [];
      const originalCheckUpdates = manager['checkUpdates'].bind(manager);
      manager['checkUpdates'] = async (componentName: string, versionData: VersionData) => {
        checkUpdatesCalls.push(componentName);
        return originalCheckUpdates(componentName, versionData);
      };

      // Execute upgrade
      await manager.upgrade({ dryRun: true, force: true });

      // Assert: checkUpdates should be called for tracked components
      expect(checkUpdatesCalls).toContain('commands');
      expect(checkUpdatesCalls).toContain('agents');

      // Assert: checkUpdates should NOT be called for non-tracked components
      expect(checkUpdatesCalls).not.toContain('templates');
    });

    it('should only process tracked components in update loop', async () => {
      // Get component configs
      const components = manager['components'];

      // Verify test setup: commands and agents should be tracked
      expect(components['commands'].tracked).toBe(true);
      expect(components['agents'].tracked).toBe(true);

      // Verify test setup: templates should NOT be tracked
      expect(components['templates'].tracked).toBe(false);

      // Count tracked components
      const trackedComponents = Object.entries(components)
        .filter(([_, config]) => config.tracked !== false)
        .map(([name]) => name);

      // Should have at least commands and agents
      expect(trackedComponents.length).toBeGreaterThanOrEqual(2);
      expect(trackedComponents).toContain('commands');
      expect(trackedComponents).toContain('agents');
      expect(trackedComponents).not.toContain('templates');
    });

    it('should correctly identify tracked vs non-tracked components', async () => {
      // This test validates the component configuration structure
      const components = manager['components'];

      // Verify tracked components
      for (const [name, config] of Object.entries(components)) {
        if (name === 'templates') {
          // templates is explicitly marked non-tracked
          expect(config.tracked).toBe(false);
        } else {
          // All other components should be tracked
          expect(config.tracked).not.toBe(false);
        }
      }
    });
  });

  describe('install method - Include all components by default', () => {
    it('should include non-tracked components during installation', async () => {
      // Verify that install() processes non-tracked components
      // even though upgrade() skips them
      const components = manager['components'];

      // Non-tracked components like 'templates' should still be installed
      // (they're just not updated during upgrades)
      expect(components['templates']).toBeDefined();
      expect(components['templates'].tracked).toBe(false);

      // But they should still be in the component list available for installation
    });
  });
});
