/**
 * Integration tests for atomic commit workflow
 *
 * Tests the complete commit flow including:
 * - Drift detection and error handling
 * - Validation before commit
 * - Atomic application of changes
 * - Rollback on failure
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs/promises';
import { Model } from '../../src/core/model.js';
import { StagingAreaManager } from '../../src/core/staging-area.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';

describe('Atomic Commit Workflow', () => {
  let testDir: string;
  let model: Model;
  let stagingManager: StagingAreaManager;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join('/tmp', `dr-commit-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Initialize test model
    model = await Model.load(testDir, { lazyLoad: false });
    stagingManager = new StagingAreaManager(testDir, model);
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should commit 10 staged changes successfully', async () => {
    const changeset = await stagingManager.create('test-bulk', 'Bulk commit test');

    // Stage 10 changes
    for (let i = 0; i < 10; i++) {
      await stagingManager.stage(changeset.id!, {
        elementId: `api-endpoint-user-${i}`,
        layerName: 'api',
        type: 'add',
        after: {
          id: `api-endpoint-user-${i}`,
          type: 'endpoint',
          name: `Endpoint ${i}`,
          description: `Test endpoint ${i}`,
        },
      });
    }

    expect(changeset.changes.length).toBe(10);

    // Commit changeset
    const result = await stagingManager.commit(model, changeset.id!, {
      validate: true,
      dryRun: false,
    });

    expect(result.committed).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.validation.passed).toBe(true);

    // Verify elements were added to model
    const apiLayer = await model.getLayer('api');
    expect(apiLayer).toBeDefined();
    if (apiLayer) {
      for (let i = 0; i < 10; i++) {
        const element = apiLayer.getElement(`api-endpoint-user-${i}`);
        expect(element).toBeDefined();
        expect(element?.name).toBe(`Endpoint ${i}`);
      }
    }
  });

  it('should block commit when model has drifted without --force', async () => {
    const changeset = await stagingManager.create('test-drift', 'Drift test');

    // Stage a change
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-test',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-test',
        type: 'endpoint',
        name: 'Test',
      },
    });

    // Simulate drift by modifying base model after changeset creation
    const apiLayer = await model.getLayer('api');
    if (apiLayer) {
      const newElement = new Element({
        id: 'api-endpoint-drift',
        type: 'endpoint',
        name: 'Drift Element',
        properties: {},
      });
      apiLayer.addElement(newElement);
      await model.saveLayer('api');
    }

    // Commit should throw due to drift
    expect(async () => {
      await stagingManager.commit(model, changeset.id!, {
        validate: true,
        force: false,
      });
    }).toThrow('drifted');
  });

  it('should allow commit with --force when model has drifted', async () => {
    const changeset = await stagingManager.create('test-drift-force', 'Drift force test');

    // Stage a change
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-force',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-force',
        type: 'endpoint',
        name: 'Force Test',
      },
    });

    // Simulate drift
    const apiLayer = await model.getLayer('api');
    if (apiLayer) {
      const driftElement = new Element({
        id: 'api-endpoint-drift-2',
        type: 'endpoint',
        name: 'Drift Element 2',
        properties: {},
      });
      apiLayer.addElement(driftElement);
      await model.saveLayer('api');
    }

    // Commit with --force should succeed
    const result = await stagingManager.commit(model, changeset.id!, {
      validate: true,
      force: true,
    });

    expect(result.committed).toBe(1);
    expect(result.driftWarning).toBeDefined();
  });

  it('should block commit on validation errors regardless of --force', async () => {
    const changeset = await stagingManager.create('test-validation-block', 'Validation block');

    // Stage change with invalid element ID
    await stagingManager.stage(changeset.id!, {
      elementId: 'InvalidID',  // Invalid naming convention
      layerName: 'api',
      type: 'add',
      after: {
        id: 'InvalidID',
        type: 'endpoint',
        name: 'Test',
      },
    });

    // Commit should fail on validation, even with --force
    expect(async () => {
      await stagingManager.commit(model, changeset.id!, {
        validate: true,
        force: true,
      });
    }).toThrow('Validation failed');
  });

  it('should rollback model on partial failure during commit', async () => {
    // Create initial state
    const apiLayer = await model.getLayer('api');
    if (apiLayer) {
      const initialElement = new Element({
        id: 'api-endpoint-existing',
        type: 'endpoint',
        name: 'Existing',
        properties: {},
      });
      apiLayer.addElement(initialElement);
      await model.saveLayer('api');
    }

    const changeset = await stagingManager.create('test-rollback', 'Rollback test');

    // Stage a valid change
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-new',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-new',
        type: 'endpoint',
        name: 'New',
      },
    });

    // Get current element count
    const preCommitLayer = await model.getLayer('api');
    const preCommitCount = preCommitLayer?.listElements().length || 0;

    // Stage a problematic change that will fail during apply
    // (This tests rollback capability)
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-invalid',
      layerName: 'nonexistent-layer',  // Layer doesn't exist
      type: 'add',
      after: {
        id: 'api-endpoint-invalid',
        type: 'endpoint',
        name: 'Invalid',
      },
    });

    // Commit should fail
    expect(async () => {
      await stagingManager.commit(model, changeset.id!, {
        validate: false,  // Skip validation to test apply-time failure
      });
    }).toThrow();

    // Reload model to verify it wasn't partially modified
    const reloadedModel = await Model.load(testDir, { lazyLoad: false });
    const reloadedLayer = await reloadedModel.getLayer('api');
    const postFailureCount = reloadedLayer?.listElements().length || 0;

    // Element count should be unchanged (rolled back)
    expect(postFailureCount).toBe(preCommitCount);
  });

  it('should dry-run commit without applying changes', async () => {
    const changeset = await stagingManager.create('test-dryrun', 'Dry-run test');

    // Stage a change
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-dryrun',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-dryrun',
        type: 'endpoint',
        name: 'Dry-run',
      },
    });

    // Get pre-dryrun element count
    const preLayer = await model.getLayer('api');
    const preCount = preLayer?.listElements().length || 0;

    // Execute dry-run
    const result = await stagingManager.commit(model, changeset.id!, {
      validate: true,
      dryRun: true,
    });

    expect(result.committed).toBe(1);

    // Verify no elements were actually added
    const postLayer = await model.getLayer('api');
    const postCount = postLayer?.listElements().length || 0;
    expect(postCount).toBe(preCount);  // Should be unchanged
  });

  it('should update changeset status to committed on success', async () => {
    const changeset = await stagingManager.create('test-status', 'Status test');

    // Stage a change
    await stagingManager.stage(changeset.id!, {
      elementId: 'api-endpoint-status',
      layerName: 'api',
      type: 'add',
      after: {
        id: 'api-endpoint-status',
        type: 'endpoint',
        name: 'Status',
      },
    });

    expect(changeset.status).toBe('staged');

    // Commit
    await stagingManager.commit(model, changeset.id!, {
      validate: true,
    });

    // Reload changeset to verify status updated
    const reloadedChangeset = await stagingManager.load(changeset.id!);
    expect(reloadedChangeset?.status).toBe('committed');
  });

  it('should apply changes in sequence number order', async () => {
    const changeset = await stagingManager.create('test-sequence', 'Sequence test');

    // Stage changes in specific order
    const elementIds = ['api-endpoint-first', 'api-endpoint-second', 'api-endpoint-third'];
    for (const id of elementIds) {
      await stagingManager.stage(changeset.id!, {
        elementId: id,
        layerName: 'api',
        type: 'add',
        after: {
          id,
          type: 'endpoint',
          name: id,
        },
      });
    }

    // Verify sequence numbers
    const loadedChangeset = await stagingManager.load(changeset.id!);
    expect(loadedChangeset?.changes[0].sequenceNumber).toBe(0);
    expect(loadedChangeset?.changes[1].sequenceNumber).toBe(1);
    expect(loadedChangeset?.changes[2].sequenceNumber).toBe(2);

    // Commit
    const result = await stagingManager.commit(model, changeset.id!);
    expect(result.committed).toBe(3);

    // Verify all elements exist
    const apiLayer = await model.getLayer('api');
    for (const id of elementIds) {
      expect(apiLayer?.getElement(id)).toBeDefined();
    }
  });
});
