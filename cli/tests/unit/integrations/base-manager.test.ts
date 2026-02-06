import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { BaseIntegrationManager } from '@/integrations/base-manager';
import { ComponentConfig, VersionData } from '@/integrations/types';
import { computeFileHash } from '@/integrations/hash-utils';

/**
 * Test implementation of BaseIntegrationManager
 * Used for unit testing the abstract base class
 */
class TestIntegrationManager extends BaseIntegrationManager {
  protected readonly components: Record<string, ComponentConfig> = {
    commands: {
      source: 'commands',
      target: 'commands',
      description: 'Command templates',
      type: 'files',
      tracked: true,
    },
    agents: {
      source: 'agents',
      target: 'agents',
      description: 'Agent configurations',
      prefix: 'dr-',
      type: 'files',
      tracked: true,
    },
    templates: {
      source: 'templates',
      target: 'templates',
      description: 'User customization templates',
      type: 'files',
      tracked: false,
    },
  };

  protected readonly targetDir: string;
  protected readonly versionFileName: string = '.dr-test-version';
  protected readonly integrationSourceDir: string;
  private sourceRoot: string;

  constructor(targetDir: string, sourceDir: string = 'test_integration') {
    super();
    this.targetDir = targetDir;
    this.integrationSourceDir = sourceDir;
    this.sourceRoot = sourceDir;
  }

  // Override getSourceRoot for testing to use injected path
  protected getSourceRoot(): string {
    return this.sourceRoot;
  }

  public setSourceRoot(path: string): void {
    this.sourceRoot = path;
  }

  // Expose protected methods for testing
  public async testIsInstalled(): Promise<boolean> {
    return this.isInstalled();
  }

  public async testLoadVersionFile(): Promise<VersionData | null> {
    return this.loadVersionFile();
  }

  public async testUpdateVersionFile(cliVersion: string): Promise<void> {
    return this.updateVersionFile(cliVersion);
  }

  public async testDetectObsoleteFiles() {
    return this.detectObsoleteFiles();
  }

  public async testCheckUpdates(componentName: string, versionData: VersionData) {
    return this.checkUpdates(componentName, versionData);
  }

  public async testInstallComponent(componentName: string, force: boolean = false) {
    return this.installComponent(componentName, force);
  }

  public testGetSourceRoot(): string {
    return this.getSourceRoot();
  }

  public async testGetAbsoluteTargetDir(): Promise<string> {
    return this.getAbsoluteTargetDir();
  }
}

describe.serial('BaseIntegrationManager', () => {
  let tempDir: string;
  let targetDir: string;
  let sourceDir: string;
  let manager: TestIntegrationManager;

  beforeEach(async () => {
    // Create temporary directories
    tempDir = await mkdtemp(join(tmpdir(), 'dr-manager-test-'));
    targetDir = join(tempDir, 'target');
    sourceDir = join(tempDir, 'source');

    await mkdir(targetDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });

    // Create source directory structure
    const commandsDir = join(sourceDir, 'commands');
    const agentsDir = join(sourceDir, 'agents');
    const templatesDir = join(sourceDir, 'templates');

    await mkdir(commandsDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    await mkdir(templatesDir, { recursive: true });

    // Create test files
    await writeFile(join(commandsDir, 'cmd1.md'), 'Command 1', 'utf-8');
    await writeFile(join(commandsDir, 'cmd2.md'), 'Command 2', 'utf-8');
    await writeFile(join(agentsDir, 'dr-agent1.md'), 'Agent 1', 'utf-8');
    await writeFile(join(agentsDir, 'ignore-agent.md'), 'Should ignore', 'utf-8');
    await writeFile(join(templatesDir, 'template1.md'), 'Template 1', 'utf-8');

    manager = new TestIntegrationManager(targetDir);
    manager.setSourceRoot(sourceDir);
  });

  afterEach(async () => {
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('isInstalled', () => {
    it('should return false when version file does not exist', async () => {
      const isInstalled = await manager.testIsInstalled();
      expect(isInstalled).toBe(false);
    });

    it('should return true when version file exists', async () => {
      // Create version file
      await writeFile(
        join(targetDir, '.dr-test-version'),
        'version: "0.1.0"\ninstalled_at: "2024-01-01T00:00:00Z"',
        'utf-8'
      );

      const isInstalled = await manager.testIsInstalled();
      expect(isInstalled).toBe(true);
    });
  });

  describe('loadVersionFile', () => {
    it('should return null when version file does not exist', async () => {
      const versionData = await manager.testLoadVersionFile();
      expect(versionData).toBeNull();
    });

    it('should parse YAML version file correctly', async () => {
      const versionContent = `
version: "0.1.0"
installed_at: "2024-01-04T10:30:00Z"
components:
  commands:
    cmd1.md:
      hash: "a1b2c3d4"
      modified: false
`;

      await writeFile(join(targetDir, '.dr-test-version'), versionContent, 'utf-8');

      const versionData = await manager.testLoadVersionFile();

      expect(versionData).not.toBeNull();
      expect(versionData?.version).toBe('0.1.0');
      expect(versionData?.installed_at).toBe('2024-01-04T10:30:00Z');
      expect(versionData?.components['commands']).toBeDefined();
      expect(versionData?.components['commands']['cmd1.md']).toEqual({
        hash: 'a1b2c3d4',
        modified: false,
      });
    });

    it('should throw error for invalid YAML', async () => {
      const invalidYaml = 'version: [invalid yaml content {{{';

      await writeFile(join(targetDir, '.dr-test-version'), invalidYaml, 'utf-8');

      let threwError = false;
      try {
        await manager.testLoadVersionFile();
      } catch (error) {
        threwError = true;
        expect(error).toBeTruthy();
        expect((error as Error).message).toContain('Failed to parse version file');
      }
      expect(threwError).toBe(true);
    });
  });

  describe('updateVersionFile', () => {
    it('should create version file with correct structure', async () => {
      // First install some files
      await manager.testInstallComponent('commands');

      // Update version file
      await manager.testUpdateVersionFile('0.1.0');

      // Read and verify version file
      const versionContent = await readFile(join(targetDir, '.dr-test-version'), 'utf-8');
      const versionData = parseYaml(versionContent) as VersionData;

      expect(versionData.version).toBe('0.1.0');
      expect(versionData.installed_at).toBeTruthy();
      expect(versionData.components).toBeDefined();
      expect(versionData.components['commands']).toBeDefined();
    });

    it('should record correct hashes for installed files', async () => {
      // Install component
      await manager.testInstallComponent('commands');

      // Update version file
      await manager.testUpdateVersionFile('0.1.0');

      const versionData = await manager.testLoadVersionFile();

      // Verify hashes are recorded
      expect(versionData?.components['commands']['cmd1.md']).toBeDefined();
      expect(versionData?.components['commands']['cmd1.md'].hash).toHaveLength(8);
      expect(versionData?.components['commands']['cmd1.md'].modified).toBe(false);
    });

    it('should set installed_at to current timestamp', async () => {
      const beforeTime = new Date();
      await manager.testUpdateVersionFile('0.1.0');
      const afterTime = new Date();

      const versionData = await manager.testLoadVersionFile();
      const installedTime = new Date(versionData?.installed_at || '');

      expect(installedTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(installedTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should exclude non-tracked components from version file', async () => {
      // Install all components (including non-tracked ones)
      await manager.testInstallComponent('commands');
      await manager.testInstallComponent('agents');
      await manager.testInstallComponent('templates');

      // Update version file
      await manager.testUpdateVersionFile('0.1.0');

      const versionData = await manager.testLoadVersionFile();

      // Verify tracked components are included
      expect(versionData?.components['commands']).toBeDefined();
      expect(versionData?.components['agents']).toBeDefined();

      // Verify non-tracked components are NOT included
      expect(versionData?.components['templates']).toBeUndefined();
    });
  });

  describe('detectObsoleteFiles', () => {
    it('should return empty array when nothing installed', async () => {
      const obsolete = await manager.testDetectObsoleteFiles();
      expect(obsolete).toHaveLength(0);
    });

    it('should detect files missing from source', async () => {
      // Create initial version file
      const versionContent = `
version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  commands:
    cmd1.md:
      hash: "a1b2c3d4"
      modified: false
    deleted-file.md:
      hash: "e5f6g7h8"
      modified: false
`;

      await writeFile(join(targetDir, '.dr-test-version'), versionContent, 'utf-8');

      const obsolete = await manager.testDetectObsoleteFiles();

      // Should identify deleted-file.md as obsolete
      const deletedFile = obsolete.find((f) => f.path === 'deleted-file.md');
      expect(deletedFile).toBeDefined();
      expect(deletedFile?.component).toBe('commands');
    });

    it('should not flag files that exist in source', async () => {
      // Install files first
      await manager.testInstallComponent('commands');
      await manager.testUpdateVersionFile('0.1.0');

      // Check for obsolete files
      const obsolete = await manager.testDetectObsoleteFiles();

      // cmd1.md and cmd2.md should not be obsolete
      expect(obsolete.some((f) => f.path === 'cmd1.md')).toBe(false);
      expect(obsolete.some((f) => f.path === 'cmd2.md')).toBe(false);
    });
  });

  describe('checkUpdates', () => {
    it('should detect new files in source', async () => {
      // Create initial version with no files
      const versionContent = `
version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  commands: {}
`;

      await writeFile(join(targetDir, '.dr-test-version'), versionContent, 'utf-8');
      const versionData = parseYaml(versionContent) as VersionData;

      const changes = await manager.testCheckUpdates('commands', versionData);

      // Should detect cmd1.md and cmd2.md as added
      const addedFiles = changes.filter((c) => c.changeType === 'added');
      expect(addedFiles.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect modified files in source', async () => {
      // Create installed files
      const cmdDir = join(targetDir, 'commands');
      await mkdir(cmdDir, { recursive: true });
      await writeFile(join(cmdDir, 'cmd1.md'), 'Original content', 'utf-8');

      // Get hash of original content
      const originalHash = await computeFileHash(join(cmdDir, 'cmd1.md'));

      // Create version with original hash
      const versionContent = `
version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  commands:
    cmd1.md:
      hash: "${originalHash}"
      modified: false
`;

      await writeFile(join(targetDir, '.dr-test-version'), versionContent, 'utf-8');

      // Modify source file
      await writeFile(join(sourceDir, 'commands', 'cmd1.md'), 'Modified content', 'utf-8');

      const versionData = parseYaml(versionContent) as VersionData;
      const changes = await manager.testCheckUpdates('commands', versionData);

      // Should detect cmd1.md as modified
      const modified = changes.find((c) => c.path === 'cmd1.md' && c.changeType === 'modified');
      expect(modified).toBeDefined();
    });

    it('should detect deleted files in source', async () => {
      const versionContent = `
version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  commands:
    cmd1.md:
      hash: "a1b2c3d4"
      modified: false
    deleted-cmd.md:
      hash: "e5f6g7h8"
      modified: false
`;

      await writeFile(join(targetDir, '.dr-test-version'), versionContent, 'utf-8');

      const versionData = parseYaml(versionContent) as VersionData;
      const changes = await manager.testCheckUpdates('commands', versionData);

      // Should detect deleted-cmd.md as deleted
      const deleted = changes.find((c) => c.path === 'deleted-cmd.md' && c.changeType === 'deleted');
      expect(deleted).toBeDefined();
    });
  });

  describe('installComponent', () => {
    it('should copy files from source to target', async () => {
      const filesInstalled = await manager.testInstallComponent('commands');

      expect(filesInstalled).toBeGreaterThan(0);

      // Check files were copied
      const cmd1Path = join(targetDir, 'commands', 'cmd1.md');
      const cmd2Path = join(targetDir, 'commands', 'cmd2.md');

      const cmd1Content = await readFile(cmd1Path, 'utf-8');
      const cmd2Content = await readFile(cmd2Path, 'utf-8');

      expect(cmd1Content).toBe('Command 1');
      expect(cmd2Content).toBe('Command 2');
    });

    it('should respect prefix filter during installation', async () => {
      const filesInstalled = await manager.testInstallComponent('agents');

      // Should only copy dr-agent1.md, not ignore-agent.md
      const agentPath = join(targetDir, 'agents', 'dr-agent1.md');
      const ignorePath = join(targetDir, 'agents', 'ignore-agent.md');

      const agentContent = await readFile(agentPath, 'utf-8');
      expect(agentContent).toBe('Agent 1');

      // ignorePath should not exist
      let fileExists = false;
      try {
        await readFile(ignorePath, 'utf-8');
        fileExists = true;
      } catch {
        // Expected - file should not exist
      }
      expect(fileExists).toBe(false);
    });

    it('should create parent directories as needed', async () => {
      // Ensure target directory doesn't have commands subdirectory initially
      const cmdDir = join(targetDir, 'commands');

      await manager.testInstallComponent('commands');

      // Directory should now exist
      const files = await readFile(join(cmdDir, 'cmd1.md'), 'utf-8');
      expect(files).toBeTruthy();
    });

    it('should return count of installed files', async () => {
      const filesInstalled = await manager.testInstallComponent('commands');

      // Should have installed at least cmd1.md and cmd2.md
      expect(filesInstalled).toBeGreaterThanOrEqual(2);
    });

    it('should skip user-modified files unless force is set', async () => {
      // First install
      await manager.testInstallComponent('commands');
      await manager.testUpdateVersionFile('0.1.0');

      // User modifies a file
      const cmd1Path = join(targetDir, 'commands', 'cmd1.md');
      await writeFile(cmd1Path, 'User custom content', 'utf-8');

      // Get the new hash (user-modified)
      const userHash = await computeFileHash(cmd1Path);

      // Update version file with user modification flag
      const versionData = await manager.testLoadVersionFile();
      if (versionData?.components['commands']['cmd1.md']) {
        versionData.components['commands']['cmd1.md'].modified = true;
      }
      const yaml = require('yaml');
      await writeFile(
        join(targetDir, '.dr-test-version'),
        yaml.stringify(versionData),
        'utf-8'
      );

      // Modify source
      await writeFile(join(sourceDir, 'commands', 'cmd1.md'), 'Updated Command 1', 'utf-8');

      // Try to reinstall without force - file should not be overwritten
      await manager.testInstallComponent('commands', false);
      const cmd1Content = await readFile(cmd1Path, 'utf-8');
      expect(cmd1Content).toBe('User custom content');

      // Now reinstall with force - file should be overwritten
      await manager.testInstallComponent('commands', true);
      const cmd1UpdatedContent = await readFile(cmd1Path, 'utf-8');
      expect(cmd1UpdatedContent).toBe('Updated Command 1');
    });

    it('should skip conflict files unless force is set', async () => {
      // First install
      await manager.testInstallComponent('commands');
      await manager.testUpdateVersionFile('0.1.0');

      // User modifies a file
      const cmd1Path = join(targetDir, 'commands', 'cmd1.md');
      await writeFile(cmd1Path, 'User custom content', 'utf-8');

      // Source also modifies the file
      await writeFile(join(sourceDir, 'commands', 'cmd1.md'), 'Source updated', 'utf-8');

      // This creates a conflict (both user and source modified)
      // Update version file with original hash to trigger conflict detection
      const originalHash = await computeFileHash(join(sourceDir, 'commands', 'cmd1.md'));
      const versionData = await manager.testLoadVersionFile();
      if (versionData?.components['commands']['cmd1.md']) {
        versionData.components['commands']['cmd1.md'].hash = originalHash;
      }
      const yaml = require('yaml');
      await writeFile(
        join(targetDir, '.dr-test-version'),
        yaml.stringify(versionData),
        'utf-8'
      );

      // Try to reinstall without force - conflict file should not be overwritten
      await manager.testInstallComponent('commands', false);
      const cmd1Content = await readFile(cmd1Path, 'utf-8');
      expect(cmd1Content).toBe('User custom content');

      // Now reinstall with force - file should be overwritten
      await manager.testInstallComponent('commands', true);
      const cmd1UpdatedContent = await readFile(cmd1Path, 'utf-8');
      expect(cmd1UpdatedContent).toBe('Source updated');
    });
  });

  describe('Source path resolution', () => {
    it('should handle relative source paths correctly', () => {
      // This test validates that getSourceRoot works with our test setup
      const sourceRoot = manager.testGetSourceRoot();
      expect(sourceRoot).toBeTruthy();
      expect(sourceRoot).toContain('source');
    });
  });

  describe('Absolute target directory resolution (Bug #1)', () => {
    it('should work with absolute paths directly', async () => {
      // Create manager with absolute path
      const absoluteManager = new TestIntegrationManager(targetDir);

      const resolvedPath = await absoluteManager.testGetAbsoluteTargetDir();

      // Should return the same path
      expect(resolvedPath).toBe(targetDir);
    });

    it('isInstalled should work with absolute paths', async () => {
      // Use absolute path manager
      const absoluteManager = new TestIntegrationManager(targetDir);
      absoluteManager.setSourceRoot(sourceDir);

      // First should be false
      const installed1 = await absoluteManager.testIsInstalled();
      expect(installed1).toBe(false);

      // Create version file
      const versionFile = join(targetDir, '.dr-test-version');
      await mkdir(dirname(versionFile), { recursive: true });
      await writeFile(
        versionFile,
        'version: "0.1.0"\ninstalled_at: "2024-01-01T00:00:00Z"',
        'utf-8'
      );

      // Should now be true
      const installed2 = await absoluteManager.testIsInstalled();
      expect(installed2).toBe(true);
    });

    it('loadVersionFile should work with absolute paths', async () => {
      // Use absolute path manager
      const absoluteManager = new TestIntegrationManager(targetDir);
      absoluteManager.setSourceRoot(sourceDir);

      // Create version file
      const versionFile = join(targetDir, '.dr-test-version');
      await mkdir(dirname(versionFile), { recursive: true });

      const versionContent = `version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  commands:
    test.md:
      hash: "a1b2c3d4"
      modified: false`;

      await writeFile(versionFile, versionContent, 'utf-8');

      // Should load the version file
      const versionData = await absoluteManager.testLoadVersionFile();
      expect(versionData).not.toBeNull();
      expect(versionData?.version).toBe('0.1.0');
      expect(versionData?.components['commands']['test.md']).toEqual({
        hash: 'a1b2c3d4',
        modified: false,
      });
    });
  });

  describe('Integration workflow', () => {
    it('should handle complete install and update cycle', async () => {
      // 1. Install component
      const installed = await manager.testInstallComponent('commands');
      expect(installed).toBeGreaterThan(0);

      // 2. Create version file
      await manager.testUpdateVersionFile('0.1.0');
      let versionData = await manager.testLoadVersionFile();
      expect(versionData?.version).toBe('0.1.0');

      // 3. Simulate source file change
      await writeFile(join(sourceDir, 'commands', 'cmd1.md'), 'Modified Command 1', 'utf-8');

      // 4. Check for updates
      const changes = await manager.testCheckUpdates('commands', versionData!);
      const modifiedFiles = changes.filter((c) => c.changeType === 'modified');
      expect(modifiedFiles.length).toBeGreaterThan(0);

      // 5. Reinstall component
      const updated = await manager.testInstallComponent('commands');
      expect(updated).toBeGreaterThan(0);

      // 6. Update version file again
      await manager.testUpdateVersionFile('0.1.1');
      versionData = await manager.testLoadVersionFile();
      expect(versionData?.version).toBe('0.1.1');
    });
  });
});
