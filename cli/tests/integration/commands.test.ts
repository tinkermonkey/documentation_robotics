/**
 * Integration tests for CLI commands
 * These tests verify complete command workflows using temporary directories
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { fileExists } from '../../src/utils/file-io.js';
import { createTempWorkdir, runDr as runDrHelper } from '../helpers/cli-runner.js';

let tempDir: { path: string; cleanup: () => Promise<void> };

/**
 * Wrapper around the cli-runner helper
 */
async function runDr(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runDrHelper(args, { cwd: tempDir.path });
}

describe('CLI Commands Integration Tests', () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe('init command', () => {
    it('should create a new model', async () => {
      const result = await runDr('init', '--name', 'Test Model');

      expect(result.exitCode).toBe(0);

      // Verify model directory was created (Python CLI format)
      expect(await fileExists(`${tempDir.path}/documentation-robotics/model/manifest.yaml`)).toBe(true);

      // Verify layer directories were created
      for (let i = 1; i <= 12; i++) {
        const layerNum = String(i).padStart(2, '0');
        const layers = ['motivation', 'business', 'security', 'application', 'technology',
                       'api', 'data-model', 'datastore', 'ux', 'navigation', 'apm', 'testing'];
        const layerDir = `${tempDir.path}/documentation-robotics/model/${layerNum}_${layers[i-1]}`;
        expect(await fileExists(layerDir)).toBe(true);
      }

      // Verify manifest contents (YAML format)
      const yaml = await import('yaml');
      const fs = await import('fs/promises');
      const manifestContent = await fs.readFile(`${tempDir.path}/documentation-robotics/model/manifest.yaml`, 'utf-8');
      const manifest = yaml.parse(manifestContent);
      expect(manifest.project.name).toBe('Test Model');
    });

    it('should fail if model already exists', async () => {
      // Initialize once
      await runDr('init', '--name', 'First Model');

      // Try to initialize again
      const result = await runDr('init', '--name', 'Second Model');

      expect(result.exitCode).toBe(1);
    });

    it('should fail if no model found for other commands', async () => {
      const result = await runDr('list', 'motivation');

      expect(result.exitCode).toBe(1);
    });

    it('should support --author option', async () => {
      const result = await runDr('init', '--name', 'Test Model', '--author', 'John Doe');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('initialized');
    });

    it('should support --description option', async () => {
      const result = await runDr('init', '--name', 'Test Model', '--description', 'Test Description');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('initialized');
    });

    it('should support multiple options together', async () => {
      const result = await runDr('init',
        '--name', 'Complex Model',
        '--author', 'Jane Smith',
        '--description', 'A complex test model'
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Complex Model');
    });

    it('should fail when --name is missing', async () => {
      const result = await runDr('init');

      expect(result.exitCode).toBe(1);
    });
  });

  describe('add command', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
    });

    it('should add an element to a layer', async () => {
      const result = await runDr(
        'add', 'motivation', 'goal', 'motivation-goal-test',
        '--name', 'Test Goal'
      );

      expect(result.exitCode).toBe(0);

      // Verify element was created
      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('motivation');
      expect(layer).toBeDefined();
      const element = layer!.getElement('motivation-goal-test');
      expect(element).toBeDefined();
      expect(element!.name).toBe('Test Goal');
    });

    it('should add element with properties', async () => {
      const result = await runDr(
        'add', 'data-model', 'entity', 'data-model-entity-user',
        '--name', 'User',
        '--properties', JSON.stringify({ required: true })
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('data-model');
      const element = layer!.getElement('data-model-entity-user');
      expect(element!.properties.required).toBe(true);
    });

    it('should fail if element already exists', async () => {
      // Add element first
      await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');

      // Try to add again
      const result = await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Duplicate');

      expect(result.exitCode).toBe(1);
    });

    it('should fail with invalid JSON properties', async () => {
      const result = await runDr(
        'add', 'motivation', 'goal', 'motivation-goal-test',
        '--properties', 'not-json'
      );

      expect(result.exitCode).toBe(1);
    });

    it('should support --description option', async () => {
      const result = await runDr(
        'add', 'api', 'endpoint', 'api-endpoint-test',
        '--name', 'Test Endpoint',
        '--description', 'A test endpoint'
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('api');
      const element = layer!.getElement('api-endpoint-test');
      expect(element!.description).toBe('A test endpoint');
    });

    it('should support complex JSON properties', async () => {
      const complexProps = {
        method: 'POST',
        path: '/api/users',
        parameters: [
          { name: 'id', type: 'string', required: true }
        ],
        tags: ['user', 'api']
      };

      const result = await runDr(
        'add', 'api', 'endpoint', 'api-endpoint-create-user',
        '--name', 'Create User',
        '--properties', JSON.stringify(complexProps)
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('api');
      const element = layer!.getElement('api-endpoint-create-user');
      expect(element!.properties.method).toBe('POST');
      expect(element!.properties.path).toBe('/api/users');
      expect((element!.properties.parameters as any[]).length).toBe(1);
    });

    it('should support all options together', async () => {
      const props = { version: '1.0', deprecated: false };

      const result = await runDr(
        'add', 'business', 'service', 'business-service-test',
        '--name', 'Test Service',
        '--description', 'A comprehensive service test',
        '--properties', JSON.stringify(props)
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('business');
      const element = layer!.getElement('business-service-test');
      expect(element!.name).toBe('Test Service');
      expect(element!.description).toBe('A comprehensive service test');
      expect(element!.properties.version).toBe('1.0');
    });

    it('should fail when --name is missing', async () => {
      const result = await runDr(
        'add', 'motivation', 'goal', 'motivation-goal-test'
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('required');
    });

    it('should fail with invalid element ID containing underscores', async () => {
      const result = await runDr(
        'add', 'motivation', 'goal', 'motivation_goal_test',
        '--name', 'Test Goal'
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('kebab-case');
    });

    it('should handle special characters in name and description', async () => {
      const result = await runDr(
        'add', 'motivation', 'goal', 'motivation-goal-special',
        '--name', 'Test Goal (Priority: Critical)',
        '--description', 'Description with special chars: @#$%'
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('motivation');
      const element = layer!.getElement('motivation-goal-special');
      expect(element!.name).toContain('Priority');
      expect(element!.description).toContain('special');
    });
  });

  describe('update command', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Original Name');
    });

    it('should update element name', async () => {
      const result = await runDr('update', 'motivation-goal-test', '--name', 'Updated Name');

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('motivation');
      const element = layer!.getElement('motivation-goal-test');
      expect(element!.name).toBe('Updated Name');
    });

    it('should fail if element not found', async () => {
      const result = await runDr('update', 'nonexistent-element', '--name', 'Test');

      expect(result.exitCode).toBe(1);
    });
  });

  describe('delete command', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
    });

    it('should delete element with force flag', async () => {
      const result = await runDr('delete', 'motivation-goal-test', '--force');

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const layer = await model.getLayer('motivation');
      expect(layer!.getElement('motivation-goal-test')).toBeUndefined();
    });

    it('should fail if element not found', async () => {
      const result = await runDr('delete', 'nonexistent-element', '--force');

      expect(result.exitCode).toBe(1);
    });
  });

  describe('show command', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-test',
        '--name', 'Test Goal'
      );
    });

    it('should display element details', async () => {
      const result = await runDr('show', 'motivation-goal-test');

      expect(result.exitCode).toBe(0);
    });

    it('should fail if element not found', async () => {
      const result = await runDr('show', 'nonexistent-element');

      expect(result.exitCode).toBe(1);
    });
  });

  describe('list command', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-2', '--name', 'Goal 2');
      await runDr('add', 'motivation', 'driver', 'motivation-driver-1', '--name', 'Driver 1');
    });

    it('should list all elements in layer', async () => {
      const result = await runDr('list', 'motivation');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Goal 1');
      expect(result.stdout).toContain('Goal 2');
      expect(result.stdout).toContain('Driver 1');
    });

    it('should filter by type', async () => {
      const result = await runDr('list', 'motivation', '--type', 'goal');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Goal 1');
      expect(result.stdout).toContain('Goal 2');
      expect(result.stdout).not.toContain('Driver 1');
    });

    it('should fail if layer not found', async () => {
      const result = await runDr('list', 'nonexistent-layer');

      expect(result.exitCode).toBe(1);
    });

    it('should support --json output format', async () => {
      const result = await runDr('list', 'motivation', '--json');

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBe(3);
    });

    it('should filter by type with --json output', async () => {
      const result = await runDr('list', 'motivation', '--type', 'goal', '--json');

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.length).toBe(2);
      expect(output.every((el: any) => el.type === 'goal')).toBe(true);
    });

    it('should list empty layer without error', async () => {
      const result = await runDr('list', 'api');

      expect(result.exitCode).toBe(0);
    });

    it('should handle multiple layers', async () => {
      await runDr('add', 'api', 'endpoint', 'api-endpoint-test', '--name', 'Test Endpoint');

      const result1 = await runDr('list', 'motivation');
      const result2 = await runDr('list', 'api');

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
      expect(result1.stdout).toContain('Goal 1');
      expect(result2.stdout).toContain('Test Endpoint');
    });
  });

  describe('search command', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-improve', '--name', 'Improve System');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-enhance', '--name', 'Enhance Security');
      await runDr('add', 'business', 'process', 'business-process-user-auth', '--name', 'User Authentication');
    });

    it('should search by id pattern', async () => {
      const result = await runDr('search', 'goal');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('motivation-goal-improve');
      expect(result.stdout).toContain('motivation-goal-enhance');
    });

    it('should search by name pattern', async () => {
      const result = await runDr('search', 'Enhance');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Enhance Security');
    });

    it('should filter by layer', async () => {
      const result = await runDr('search', 'User', '--layer', 'business');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('User Authentication');
    });

    it('should return empty results for no matches', async () => {
      const result = await runDr('search', 'nonexistent');

      expect(result.exitCode).toBe(0);
    });

    it('should support --layer filter option', async () => {
      const result = await runDr('search', 'goal', '--layer', 'motivation');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('motivation-goal-improve');
      expect(result.stdout).not.toContain('User Authentication');
    });

    it('should support --type filter option', async () => {
      const result = await runDr('search', 'User', '--type', 'process');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('User Authentication');
    });

    it('should support --json output format', async () => {
      const result = await runDr('search', 'goal', '--json');

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBe(2);
    });

    it('should combine --layer and --type filters', async () => {
      const result = await runDr('search', 'goal', '--layer', 'motivation', '--type', 'goal');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('motivation-goal-improve');
    });

    it('should support case-insensitive search', async () => {
      const result = await runDr('search', 'system');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Improve System');
    });

    it('should return empty results when no layer exists', async () => {
      const result = await runDr('search', 'test', '--layer', 'ux');

      expect(result.exitCode).toBe(0);
    });
  });

  describe('validate command', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
    });

    it('should validate valid model', async () => {
      const result = await runDr('validate');

      expect(result.exitCode).toBe(0);
    });
  });

  describe('element subcommands', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
    });

    it('should add element via element subcommand', async () => {
      const result = await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-test',
        '--name', 'Test Goal'
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      const element = (await model.getLayer('motivation'))!.getElement('motivation-goal-test');
      expect(element).toBeDefined();
    });

    it('should list elements via element subcommand', async () => {
      await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
      await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-2', '--name', 'Goal 2');

      const result = await runDr('element', 'list', 'motivation');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Goal 1');
      expect(result.stdout).toContain('Goal 2');
    });

    it('should show element details via show subcommand', async () => {
      await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-test',
        '--name', 'Test Goal',
        '--description', 'Test Description'
      );

      const result = await runDr('show', 'motivation-goal-test');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Test Goal');
    });

    it('show command should display element metadata', async () => {
      await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-test',
        '--name', 'Test Goal'
      );

      const result = await runDr('show', 'motivation-goal-test');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('motivation-goal-test');
      expect(result.stdout).toContain('Test Goal');
    });

    it('should fail to show non-existent element', async () => {
      const result = await runDr('show', 'non-existent-element');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('element list should support --json output', async () => {
      await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
      await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-2', '--name', 'Goal 2');

      const result = await runDr('element', 'list', 'motivation', '--json');

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBe(2);
    });

    it('element list should filter by type with --type option', async () => {
      await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
      await runDr('element', 'add', 'motivation', 'driver', 'motivation-driver-1', '--name', 'Driver 1');

      const result = await runDr('element', 'list', 'motivation', '--type', 'goal');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Goal 1');
      expect(result.stdout).not.toContain('Driver 1');
    });
  });

  describe('relationship subcommands', () => {
    beforeEach(async () => {
      await runDr('init', '--name', 'Test Model');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-2', '--name', 'Goal 2');
      await runDr('add', 'motivation', 'goal', 'motivation-goal-3', '--name', 'Goal 3');
    });

    it('should add relationship between elements', async () => {
      const result = await runDr('relationship', 'add',
        'motivation-goal-1', 'motivation-goal-2',
        '--predicate', 'depends-on'
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      await model.loadRelationships();
      const relationships = model.relationships.find('motivation-goal-1', 'motivation-goal-2');
      expect(relationships.length).toBe(1);
      expect(relationships[0].predicate).toBe('depends-on');
    });

    it('should fail to add cross-layer relationship', async () => {
      await runDr('add', 'business', 'process', 'business-process-test', '--name', 'Test Process');

      const result = await runDr('relationship', 'add',
        'motivation-goal-1', 'business-process-test',
        '--predicate', 'depends-on'
      );

      expect(result.exitCode).toBe(1);
    });

    it('should list relationships', async () => {
      await runDr('relationship', 'add',
        'motivation-goal-1', 'motivation-goal-2',
        '--predicate', 'depends-on'
      );

      const result = await runDr('relationship', 'list', 'motivation-goal-1');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('motivation-goal-2');
    });

    it('should delete relationship', async () => {
      await runDr('relationship', 'add',
        'motivation-goal-1', 'motivation-goal-2',
        '--predicate', 'depends-on'
      );

      const result = await runDr('relationship', 'delete',
        'motivation-goal-1', 'motivation-goal-2',
        '--force'
      );

      expect(result.exitCode).toBe(0);

      const model = await Model.load(tempDir.path);
      await model.loadRelationships();
      const relationships = model.relationships.find('motivation-goal-1', 'motivation-goal-2');
      expect(relationships.length).toBe(0);
    });

    it('should support --json output for list', async () => {
      await runDr('relationship', 'add',
        'motivation-goal-1', 'motivation-goal-2',
        '--predicate', 'depends-on'
      );
      await runDr('relationship', 'add',
        'motivation-goal-1', 'motivation-goal-3',
        '--predicate', 'supports'
      );

      const result = await runDr('relationship', 'list', 'motivation-goal-1', '--json');

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBe(2);
    });

    it('should support different relationship types', async () => {
      const predicates = ['depends-on', 'supports', 'triggers', 'includes'];

      for (let i = 0; i < predicates.length; i++) {
        const targetId = `motivation-goal-${i + 2}`;
        if (i === 0) {
          const result = await runDr('relationship', 'add',
            'motivation-goal-1', targetId,
            '--predicate', predicates[i]
          );
          expect(result.exitCode).toBe(0);
        }
      }
    });

    it('should fail to add relationship with non-existent elements', async () => {
      const result = await runDr('relationship', 'add',
        'non-existent-1', 'non-existent-2',
        '--predicate', 'depends-on'
      );

      expect(result.exitCode).toBe(1);
    });

    it('should handle multiple relationships on same element', async () => {
      await runDr('relationship', 'add',
        'motivation-goal-1', 'motivation-goal-2',
        '--predicate', 'depends-on'
      );
      await runDr('relationship', 'add',
        'motivation-goal-1', 'motivation-goal-3',
        '--predicate', 'supports'
      );

      const result = await runDr('relationship', 'list', 'motivation-goal-1');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('motivation-goal-2');
      expect(result.stdout).toContain('motivation-goal-3');
    });
  });
});
