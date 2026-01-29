/**
 * Unit tests for changeset validation
 *
 * Tests validate that the 4-stage validation pipeline correctly validates
 * projected models containing staged changes
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs/promises';
import { Model } from '../../src/core/model.js';
import { StagingAreaManager } from '../../src/core/staging-area.js';
import { ChangesetValidator } from '../../src/core/changeset-validator.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';

describe('ChangesetValidator - Validation on Projected Models', () => {
  let testDir: string;
  let model: Model;
  let validator: ChangesetValidator;
  let stagingManager: StagingAreaManager;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join('/tmp', `dr-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Eager loading required: Test validates changeset operations on projected models
    // which requires all layers loaded upfront to properly validate staged changes
    model = await Model.load(testDir, { lazyLoad: false });
    validator = new ChangesetValidator(testDir);
    stagingManager = new StagingAreaManager(testDir, model);
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should validate empty changeset', async () => {
    const changeset = await stagingManager.create('test-empty', 'Empty changeset');
    const validation = await validator.validateChangeset(model, changeset.id!);

    expect(validation.isValid()).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('should validate changeset with valid new element', async () => {
    const changeset = await stagingManager.create('test-valid', 'Valid changeset');

    // Stage a valid add operation
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-test-users',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-test-users',
        type: 'endpoint',
        name: 'GET /users',
        description: 'List all users',
      },
    });

    const validation = await validator.validateChangeset(model, changeset.id!);

    // Should pass schema and naming validation
    expect(validation.isValid()).toBe(true);
  });

  it('should catch invalid element ID naming convention', async () => {
    const changeset = await stagingManager.create('test-invalid-id', 'Invalid ID');

    // Stage with invalid element ID (not following {layer}-{type}-{kebab-case} format)
    await stagingManager.stage(changeset.id!, {
      elementId: 'InvalidElementId',  // Not kebab-case
      layerName: 'api',
      type: 'add',
      after: {
        id: 'InvalidElementId',
        type: 'endpoint',
        name: 'Test',
      },
    });

    const validation = await validator.validateChangeset(model, changeset.id!);

    // Should fail naming validation
    expect(validation.isValid()).toBe(false);
    expect(validation.errors.some(e => e.message.includes('naming') || e.message.includes('ID format'))).toBe(true);
  });

  it('should validate inter-stage references', async () => {
    const changeset = await stagingManager.create('test-references', 'Test references');

    // Stage first element
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-create-user',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-create-user',
        type: 'endpoint',
        name: 'POST /users',
        references: ['data-model-user'],  // References element in data-model layer
      },
    });

    // Stage second element that is referenced
    await stagingManager.stage(changeset.id!, {
      elementId: 'data-model-user',
      layerName: 'data-model',
      type: 'add',
      after: {
        id: 'data-model-user',
        type: 'entity',
        name: 'User',
      },
    });

    const validation = await validator.validateChangeset(model, changeset.id!);

    // Both elements should exist in projected model
    // Reference validation should check the merged view
    expect(validation.errors.filter(e => e.message.includes('Reference')).length).toBeLessThanOrEqual(0);
  });

  it('should detect reference to non-existent element', async () => {
    const changeset = await stagingManager.create('test-bad-ref', 'Bad reference');

    // Stage element with reference to non-existent element
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-users',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-users',
        type: 'endpoint',
        name: 'GET /users',
        references: ['data-model-nonexistent'],  // This doesn't exist
      },
    });

    const validation = await validator.validateChangeset(model, changeset.id!);

    // Should fail reference validation
    expect(validation.isValid()).toBe(false);
    expect(validation.errors.some(e => e.message.includes('Reference') || e.message.includes('non-existent'))).toBe(true);
  });

  it('should enforce higher->lower layer reference constraint', async () => {
    const changeset = await stagingManager.create('test-layer-direction', 'Layer direction test');

    // Stage API layer element referencing motivation layer (lower -> higher, invalid)
    await stagingManager.stage(changeset.id!, {
      elementId: 'data-model-user',
      layerName: 'data-model',
      type: 'add',
      after: {
        id: 'data-model-user',
        type: 'entity',
        name: 'User',
        references: ['motivation-project-users'],  // Invalid: lower to higher
      },
    });

    const validation = await validator.validateChangeset(model, changeset.id!);

    // Should fail reference validation for invalid layer direction
    expect(validation.isValid()).toBe(false);
    expect(validation.errors.some(e =>
      e.message.includes('layer') || e.message.includes('reference')
    )).toBe(true);
  });

  it('should validate deleted elements are removed from projected model', async () => {
    // Create an initial element in base model
    const apiLayer = await model.getLayer('api');
    if (apiLayer) {
      const testElement = new Element({
        id: 'api-endpoint-test',
        type: 'endpoint',
        name: 'Test Endpoint',
        properties: {},
      });
      apiLayer.addElement(testElement);
      await model.saveLayer('api');
    }

    const changeset = await stagingManager.create('test-delete', 'Test deletion');

    // Stage a deletion
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-test',
      layerName: 'api',
      type: 'delete',
    });

    const validation = await validator.validateChangeset(model, changeset.id!);

    // Validation should see the element as deleted in projected model
    expect(validation.isValid()).toBe(true);
  });

  it('should validate update to existing element in changeset', async () => {
    // Create base element
    const apiLayer = await model.getLayer('api');
    if (apiLayer) {
      const testElement = new Element({
        id: 'api-endpoint-users',
        type: 'endpoint',
        name: 'GET /users',
        properties: { method: 'GET', path: '/users' },
      });
      apiLayer.addElement(testElement);
      await model.saveLayer('api');
    }

    const changeset = await stagingManager.create('test-update', 'Test update');

    // Stage an update
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-users',
      layerName: 'api',
      type: 'update',
      before: {
        name: 'GET /users',
      },
      after: {
        name: 'GET /users (List)',
        description: 'List all users',
      },
    });

    const validation = await validator.validateChangeset(model, changeset.id!);

    // Update should be valid
    expect(validation.isValid()).toBe(true);
  });
});
