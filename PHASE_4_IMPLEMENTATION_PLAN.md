# Phase 4: Implementation Plan - Validation and Atomic Commit

## Overview

This document outlines the detailed implementation strategy for Phase 4 of issue #188, focusing on validating staged changes against projected model views, implementing drift detection, and building atomic commit logic with rollback capabilities.

## Executive Summary

### Current State
- **Validation Pipeline**: Fully implemented 4-stage pipeline (schema, naming, reference, semantic)
- **Staging Infrastructure**: Complete changeset storage, virtual projection engine, base snapshot manager
- **Commit Logic**: Basic implementation exists but lacks validation integration and atomic guarantees

### What Needs to Be Done
1. Integrate existing validators to run against **projected models** (not just base model)
2. Enhance reference validation to check references exist in **merged view** (base + staged)
3. Ensure drift detection works correctly (hash comparison is already implemented)
4. Implement atomic commit with proper **rollback on failure**
5. Add comprehensive tests for validation and commit workflows

### Key Design Principle
**Validation against projected model = base model + staged changes applied virtually**

---

## Architecture: Validation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Commit Command                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────▼──────────┐
                    │  Load Changeset │
                    └──────┬──────────┘
                           │
                    ┌──────▼──────────┐
                    │ Detect Drift    │
                    └──────┬──────────┘
                           │
              ┌────────────▼────────────┐
              │ Drift Detected?         │
              │ && !options.force       │
              └──┬──────────────┬───────┘
                 │              │
              YES│              │NO
                 │              │
         ┌───────▼┐      ┌──────▼─────────────┐
         │ Throw  │      │ Validate: Project  │
         │ Error  │      │ Model + Validate   │
         └────────┘      └──────┬─────────────┘
                                │
                        ┌───────▼────────┐
                        │ Validation     │
                        │ Failed?        │
                        └──┬──────┬──────┘
                          YES    NO
                           │      │
                    ┌──────▼┐  ┌──▼──────────┐
                    │Throw  │  │Apply Changes│
                    │Error  │  │ Atomically  │
                    └───────┘  └──┬───────────┘
                                  │
                          ┌───────▼──────────┐
                          │ Any Failure?     │
                          └──┬───────┬───────┘
                            YES      NO
                             │        │
                      ┌──────▼┐  ┌───▼─────────┐
                      │Rollback│  │ Save Model &│
                      │ Backup │  │ Mark Status │
                      └────────┘  └─────────────┘
```

---

## Component 1: Enhanced Validation Pipeline Integration

### File: `cli/src/core/changeset-validator.ts` (NEW)

**Purpose**: Run full validation pipeline on projected model

```typescript
import type { Model } from './model.js';
import type { ProjectedModel } from './virtual-projection.js';
import { Validator } from '../validators/validator.js';
import type { ValidationResult } from '../validators/types.js';

/**
 * Validates projected model (base + staged changes merged)
 */
export class ChangesetValidator {
  private validator: Validator;

  constructor() {
    this.validator = new Validator();
  }

  /**
   * Validate a projected model (base + staged changes)
   * Runs full 4-stage validation pipeline:
   * 1. Schema validation
   * 2. Naming validation
   * 3. Reference validation
   * 4. Semantic validation
   */
  async validateProjectedModel(projectedModel: ProjectedModel): Promise<ValidationResult> {
    // Validators expect Model interface, but ProjectedModel has isProjection flag
    // Convert ProjectedModel to Model-like object for validation
    const modelLike = {
      manifest: projectedModel.manifest,
      layers: projectedModel.layers,
      // Add other required Model methods if needed
    } as unknown as Model;

    return this.validator.validateModel(modelLike);
  }

  /**
   * Convenience method: validate after staging
   * Takes base model + changeset ID
   */
  async validateChangeset(
    baseModel: Model,
    changesetId: string,
    projectionEngine: any // VirtualProjectionEngine type
  ): Promise<ValidationResult> {
    // Project model with staged changes
    const projected = await projectionEngine.projectModel(baseModel, changesetId);

    // Validate projected state
    return this.validateProjectedModel(projected);
  }
}
```

### Integration Points

#### In `staging-area.ts` `commit()` method:

```typescript
async commit(model: Model, changesetId: string, options: CommitOptions = {}): Promise<CommitResult> {
  const changeset = await this.storage.load(changesetId);
  if (!changeset) {
    throw new Error(`Changeset '${changesetId}' not found`);
  }

  const isDryRun = options.dryRun === true;

  // STEP 1: Detect drift
  const drift = await this.detectDrift(changesetId);
  if (drift.isDrifted && !options.force) {
    throw new Error(
      `Base model has drifted. Run 'dr changeset diff' to see changes. Use --force to commit anyway.`
    );
  }

  // STEP 2: Validate merged view (NEW)
  if (options.validate !== false) {
    const projectionEngine = model.getVirtualProjectionEngine();
    const validator = new ChangesetValidator();
    const validation = await validator.validateChangeset(model, changesetId, projectionEngine);

    if (!validation.isValid()) {
      const errorMessages = validation.errors
        .map((e) => `[${e.layer}] ${e.message}`)
        .join('\n');
      throw new Error(`Validation failed:\n${errorMessages}`);
    }
  }

  // STEP 3: Dry run early exit
  if (isDryRun) {
    return {
      changeset: changeset.name,
      committed: 0,
      failed: 0,
      validation: { passed: true, errors: [] },
    };
  }

  // STEP 4-8: Apply changes atomically (existing code)
  // ...
}
```

---

## Component 2: Reference Validation on Projected Model

### Current Implementation Analysis

The existing `reference-validator.ts` has:
- `validateModel(model: Model)` - validates against base model
- Uses `collectAllElementIds()` to build set of valid IDs
- Enforces layer hierarchy constraint

### Enhancement Strategy

The reference validator already works correctly on any Model-like object. When we pass a ProjectedModel:
- It will see merged elements (base + staged additions)
- It will validate references against this merged set
- Deleted elements are removed from the projected layer, so references to them will be caught

**No changes needed to reference validator itself** - it works on any Model interface.

### Validation Workflow

1. Project model with staged changes
2. Reference validator runs on projected model
3. If staged change adds reference to non-existent element → validation error
4. If staged change adds element referenced by staged element → works (both in projection)
5. If staged element references base element → works (both in projection)

---

## Component 3: Atomic Commit with Rollback

### File: Enhance `staging-area.ts`

**Key Changes**:

```typescript
async commit(model: Model, changesetId: string, options: CommitOptions = {}): Promise<CommitResult> {
  const changeset = await this.storage.load(changesetId);
  if (!changeset) {
    throw new Error(`Changeset '${changesetId}' not found`);
  }

  const isDryRun = options.dryRun === true;
  const result: CommitResult = {
    changeset: changeset.name,
    committed: 0,
    failed: 0,
    validation: { passed: true, errors: [] },
  };

  // STEP 1: Detect drift
  const drift = await this.detectDrift(changesetId);
  if (drift.isDrifted && !options.force) {
    result.driftWarning = drift;
    throw new Error(
      `Base model has drifted. Use --force to commit anyway or run 'dr changeset diff' to see changes.`
    );
  }

  // STEP 2: Validate (optional, default: true)
  if (options.validate !== false) {
    const projectionEngine = model.getVirtualProjectionEngine();
    const validator = new ChangesetValidator();
    const validation = await validator.validateChangeset(model, changesetId, projectionEngine);

    if (!validation.isValid()) {
      result.validation = {
        passed: false,
        errors: validation.errors.map((e) => `[${e.layer}] ${e.message}`),
      };
      throw new Error(`Validation failed: ${result.validation.errors[0]}`);
    }
  }

  // STEP 3: Dry run early exit
  if (isDryRun) {
    return result;
  }

  // STEP 4: Backup current state for rollback
  const backup = await this.createBackup(model);

  try {
    // STEP 5: Apply changes sequentially
    const modifiedLayers = new Set<string>();

    for (const change of changeset.changes.sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
      const layer = await model.getLayer(change.layerName);
      if (!layer) {
        throw new Error(`Layer '${change.layerName}' not found`);
      }

      try {
        switch (change.type) {
          case 'add': {
            if (change.after) {
              const { Element } = await import('./element.js');
              const element = new Element({
                id: change.elementId,
                type: (change.after.type as string) || 'unknown',
                name: (change.after.name as string) || change.elementId,
                description: change.after.description as string | undefined,
                properties: change.after,
              });
              layer.addElement(element);
              modifiedLayers.add(change.layerName);
              result.committed++;
            }
            break;
          }
          case 'update': {
            const element = layer.getElement(change.elementId);
            if (element && change.after) {
              Object.assign(element, change.after);
              modifiedLayers.add(change.layerName);
              result.committed++;
            }
            break;
          }
          case 'delete': {
            const element = layer.getElement(change.elementId);
            if (element) {
              layer.deleteElement(change.elementId);
              modifiedLayers.add(change.layerName);
              result.committed++;
            }
            break;
          }
        }
      } catch (error) {
        // On any change application error, rollback entire transaction
        throw new Error(
          `Failed to apply ${change.type} to ${change.elementId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // STEP 6: Save all modified layers (atomic batch save)
    for (const layerName of modifiedLayers) {
      await model.saveLayer(layerName);
    }

    // STEP 7: Save manifest
    await model.saveManifest();

    // STEP 8: Update changeset status
    changeset.status = 'committed';
    changeset.updateModified();
    await this.storage.save(changeset);

    // Success - no rollback needed
    return result;
  } catch (error) {
    // ROLLBACK: Restore from backup on any failure
    result.failed = changeset.changes.length;
    result.validation.passed = false;
    result.validation.errors = [
      error instanceof Error ? error.message : String(error),
    ];
    result.committed = 0;

    try {
      await this.restoreBackup(model, backup);
    } catch (restoreError) {
      result.validation.errors.push(
        `CRITICAL: Rollback failed: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`
      );
    }

    throw error;
  }
}

/**
 * Create backup of current model state for rollback
 */
private async createBackup(model: Model): Promise<Map<string, string>> {
  const backup = new Map<string, string>();

  // Back up manifest
  const manifestPath = path.join(model.rootPath, 'documentation-robotics', 'manifest.yaml');
  if (await fileExists(manifestPath)) {
    backup.set('manifest', await readFile(manifestPath));
  }

  // Back up all layers that might be modified
  for (const layer of model.layers.values()) {
    const layerPath = layer.filePath;
    if (layerPath && (await fileExists(layerPath))) {
      backup.set(layer.name, await readFile(layerPath));
    }
  }

  return backup;
}

/**
 * Restore model from backup on failure
 */
private async restoreBackup(model: Model, backup: Map<string, string>): Promise<void> {
  // Restore manifest
  if (backup.has('manifest')) {
    const manifestPath = path.join(model.rootPath, 'documentation-robotics', 'manifest.yaml');
    await writeFile(manifestPath, backup.get('manifest')!);
  }

  // Restore all layers
  for (const [layerName, content] of backup) {
    if (layerName === 'manifest') continue;
    const layer = await model.getLayer(layerName);
    if (layer && layer.filePath) {
      await writeFile(layer.filePath, content);
    }
  }

  // Reload model to reflect restored state
  await model.reload();
}
```

---

## Component 4: Test Strategy

### Unit Tests: Validation on Projected Model

**File**: `cli/tests/unit/test-changeset-validation.ts`

```typescript
import { describe, it, expect } from 'bun:test';
import { Model } from '../../src/core/model';
import { StagingAreaManager } from '../../src/core/staging-area';
import { ChangesetValidator } from '../../src/core/changeset-validator';
import { VirtualProjectionEngine } from '../../src/core/virtual-projection';

describe('Changeset Validation on Projected Model', () => {
  it('validates schema on projected model after staged additions', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);
    const validator = new ChangesetValidator();

    // Create and stage an addition
    const changeset = await staging.create('test');
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'api-endpoint-new-endpoint',
      layerName: 'api',
      after: {
        id: 'api-endpoint-new-endpoint',
        type: 'endpoint',
        name: 'New Endpoint',
        properties: { method: 'GET', path: '/test' }
      },
      timestamp: new Date().toISOString(),
    });

    // Validate projection
    const engine = new VirtualProjectionEngine(tempDir);
    const projected = await engine.projectModel(model, changeset.id!);
    const result = await validator.validateProjectedModel(projected);

    expect(result.isValid()).toBe(true);
  });

  it('catches schema violations on projected model', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);
    const validator = new ChangesetValidator();

    // Stage invalid element (missing required field)
    const changeset = await staging.create('invalid');
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'api-endpoint-invalid',
      layerName: 'api',
      after: {
        id: 'api-endpoint-invalid',
        type: 'endpoint',
        // Missing 'name' required field
        properties: {}
      },
      timestamp: new Date().toISOString(),
    });

    const engine = new VirtualProjectionEngine(tempDir);
    const projected = await engine.projectModel(model, changeset.id!);
    const result = await validator.validateProjectedModel(projected);

    expect(result.isValid()).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates references in projected model', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);
    const validator = new ChangesetValidator();

    // Add element in one layer that references another layer
    const changeset = await staging.create('references');
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'application-service-test',
      layerName: 'application',
      after: {
        id: 'application-service-test',
        type: 'service',
        name: 'Test Service',
        references: [
          { targetId: 'api-endpoint-existing', type: 'uses' }
        ]
      },
      timestamp: new Date().toISOString(),
    });

    const engine = new VirtualProjectionEngine(tempDir);
    const projected = await engine.projectModel(model, changeset.id!);
    const result = await validator.validateProjectedModel(projected);

    // Should pass if api-endpoint-existing exists in base model
    expect(result.isValid()).toBe(true);
  });

  it('rejects references to non-existent elements in projection', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);
    const validator = new ChangesetValidator();

    const changeset = await staging.create('bad-refs');
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'application-service-test',
      layerName: 'application',
      after: {
        id: 'application-service-test',
        type: 'service',
        name: 'Test Service',
        references: [
          { targetId: 'api-endpoint-nonexistent', type: 'uses' }
        ]
      },
      timestamp: new Date().toISOString(),
    });

    const engine = new VirtualProjectionEngine(tempDir);
    const projected = await engine.projectModel(model, changeset.id!);
    const result = await validator.validateProjectedModel(projected);

    expect(result.isValid()).toBe(false);
    const refErrors = result.errors.filter((e) => e.message.includes('non-existent'));
    expect(refErrors.length).toBeGreaterThan(0);
  });

  it('validates inter-stage references within changeset', async () => {
    // When stage 1 adds element A and stage 2 adds element B that references A,
    // validation should pass because both exist in projection
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);
    const validator = new ChangesetValidator();

    const changeset = await staging.create('inter-stage-refs');

    // Stage 1: Add element in lower layer
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'api-endpoint-stage1',
      layerName: 'api',
      after: {
        id: 'api-endpoint-stage1',
        type: 'endpoint',
        name: 'Stage 1 Endpoint',
      },
      timestamp: new Date().toISOString(),
    });

    // Stage 2: Add element in higher layer that references stage 1
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'application-service-stage2',
      layerName: 'application',
      after: {
        id: 'application-service-stage2',
        type: 'service',
        name: 'Stage 2 Service',
        references: [
          { targetId: 'api-endpoint-stage1', type: 'uses' }
        ]
      },
      timestamp: new Date().toISOString(),
    });

    const engine = new VirtualProjectionEngine(tempDir);
    const projected = await engine.projectModel(model, changeset.id!);
    const result = await validator.validateProjectedModel(projected);

    expect(result.isValid()).toBe(true);
  });
});
```

### Unit Tests: Drift Detection

**File**: `cli/tests/unit/test-drift-detection.ts`

```typescript
describe('Drift Detection', () => {
  it('detects when base model has changed since changeset creation', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    // Create changeset (captures base snapshot)
    const changeset = await staging.create('drift-test');
    const baseSnapshot = changeset.baseSnapshot;

    // Modify base model outside of changeset
    const layer = await model.getLayer('api');
    const { Element } = await import('../../src/core/element');
    layer.addElement(new Element({
      id: 'api-endpoint-external',
      type: 'endpoint',
      name: 'External Change',
    }));
    await model.saveLayer('api');

    // Detect drift
    const drift = await staging.detectDrift(changeset.id!);

    expect(drift.isDrifted).toBe(true);
    expect(drift.baseSnapshotId).toBe(baseSnapshot);
    expect(drift.currentSnapshotId).not.toBe(baseSnapshot);
  });

  it('allows force commit when drift detected', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    const changeset = await staging.create('force-drift');
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'api-endpoint-force',
      layerName: 'api',
      after: {
        id: 'api-endpoint-force',
        type: 'endpoint',
        name: 'Force Endpoint',
      },
      timestamp: new Date().toISOString(),
    });

    // Introduce drift
    const layer = await model.getLayer('api');
    const { Element } = await import('../../src/core/element');
    layer.addElement(new Element({
      id: 'api-endpoint-external',
      type: 'endpoint',
      name: 'External',
    }));
    await model.saveLayer('api');

    // Commit with force should succeed
    const result = await staging.commit(model, changeset.id!, { force: true });

    expect(result.committed).toBeGreaterThan(0);
  });

  it('blocks commit on drift without force flag', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    const changeset = await staging.create('block-drift');
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'api-endpoint-block',
      layerName: 'api',
      after: {
        id: 'api-endpoint-block',
        type: 'endpoint',
        name: 'Block Endpoint',
      },
      timestamp: new Date().toISOString(),
    });

    // Introduce drift
    const layer = await model.getLayer('api');
    const { Element } = await import('../../src/core/element');
    layer.addElement(new Element({
      id: 'api-endpoint-external',
      type: 'endpoint',
      name: 'External',
    }));
    await model.saveLayer('api');

    // Commit without force should throw
    expect(async () => {
      await staging.commit(model, changeset.id!);
    }).rejects.toThrow(/Base model has drifted/);
  });
});
```

### Integration Tests: Commit Workflow

**File**: `cli/tests/integration/test-commit-workflow.ts`

```typescript
describe('Commit Workflow: Validation and Atomic Application', () => {
  it('validates and commits 10 changes atomically', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    const changeset = await staging.create('bulk-commit');

    // Stage 10 elements
    for (let i = 0; i < 10; i++) {
      await staging.stage(changeset.id!, {
        type: 'add',
        elementId: `api-endpoint-bulk-${i}`,
        layerName: 'api',
        after: {
          id: `api-endpoint-bulk-${i}`,
          type: 'endpoint',
          name: `Bulk Endpoint ${i}`,
          properties: { method: 'GET', path: `/bulk/${i}` }
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Commit
    const result = await staging.commit(model, changeset.id!);

    expect(result.committed).toBe(10);
    expect(result.failed).toBe(0);

    // Verify all elements in base model
    const apiLayer = await model.getLayer('api');
    for (let i = 0; i < 10; i++) {
      const element = apiLayer.getElement(`api-endpoint-bulk-${i}`);
      expect(element).toBeDefined();
      expect(element?.name).toBe(`Bulk Endpoint ${i}`);
    }
  });

  it('rolls back on partial failure', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    const changeset = await staging.create('rollback-test');

    // Stage valid change
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'api-endpoint-valid',
      layerName: 'api',
      after: {
        id: 'api-endpoint-valid',
        type: 'endpoint',
        name: 'Valid Endpoint',
      },
      timestamp: new Date().toISOString(),
    });

    // Manually inject invalid change that will fail (e.g., add to non-existent layer)
    const invalidChange: StagedChange = {
      type: 'add',
      elementId: 'invalid-element',
      layerName: 'nonexistent-layer',
      after: { id: 'invalid-element' },
      timestamp: new Date().toISOString(),
      sequenceNumber: 1,
    };
    (changeset as any).changes.push(invalidChange);
    await staging.storage.save(changeset);

    const apiLayerBefore = await model.getLayer('api');
    const elementCountBefore = apiLayerBefore.listElements().length;

    // Attempt commit - should fail and rollback
    expect(async () => {
      await staging.commit(model, changeset.id!);
    }).rejects.toThrow();

    // Verify no elements were added (rollback worked)
    const apiLayerAfter = await model.getLayer('api');
    const elementCountAfter = apiLayerAfter.listElements().length;
    expect(elementCountAfter).toBe(elementCountBefore);
    expect(apiLayerAfter.getElement('api-endpoint-valid')).toBeUndefined();
  });

  it('validates projection before commit', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    const changeset = await staging.create('validation-test');

    // Stage element with invalid reference
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'application-service-invalid-ref',
      layerName: 'application',
      after: {
        id: 'application-service-invalid-ref',
        type: 'service',
        name: 'Invalid Service',
        references: [
          { targetId: 'api-endpoint-nonexistent', type: 'uses' }
        ]
      },
      timestamp: new Date().toISOString(),
    });

    // Commit should fail validation
    expect(async () => {
      await staging.commit(model, changeset.id!);
    }).rejects.toThrow(/Validation failed/);

    // Model should be unchanged
    const appLayer = await model.getLayer('application');
    expect(appLayer.getElement('application-service-invalid-ref')).toBeUndefined();
  });

  it('supports --dry-run preview without modifying model', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    const changeset = await staging.create('dryrun-test');
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'api-endpoint-preview',
      layerName: 'api',
      after: {
        id: 'api-endpoint-preview',
        type: 'endpoint',
        name: 'Preview Endpoint',
      },
      timestamp: new Date().toISOString(),
    });

    const apiLayerBefore = await model.getLayer('api');
    const countBefore = apiLayerBefore.listElements().length;

    // Dry run
    const result = await staging.commit(model, changeset.id!, { dryRun: true });

    expect(result.committed).toBe(1);

    // Model unchanged
    const apiLayerAfter = await model.getLayer('api');
    const countAfter = apiLayerAfter.listElements().length;
    expect(countAfter).toBe(countBefore);
  });

  it('blocks validation errors even with --force flag', async () => {
    const model = await Model.load(tempDir);
    const staging = new StagingAreaManager(tempDir, model);

    const changeset = await staging.create('force-validate');

    // Stage element with invalid reference
    await staging.stage(changeset.id!, {
      type: 'add',
      elementId: 'application-service-bad',
      layerName: 'application',
      after: {
        id: 'application-service-bad',
        type: 'service',
        name: 'Bad Service',
        references: [
          { targetId: 'api-endpoint-nonexistent', type: 'uses' }
        ]
      },
      timestamp: new Date().toISOString(),
    });

    // Introduce drift
    const layer = await model.getLayer('api');
    const { Element } = await import('../../src/core/element');
    layer.addElement(new Element({
      id: 'api-endpoint-external',
      type: 'endpoint',
      name: 'External',
    }));
    await model.saveLayer('api');

    // --force should override drift but NOT validation errors
    expect(async () => {
      await staging.commit(model, changeset.id!, { force: true });
    }).rejects.toThrow(/Validation failed/);
  });
});
```

---

## Implementation Tasks

### Task Group 1: Core Implementation

1. **Create ChangesetValidator class** (`cli/src/core/changeset-validator.ts`)
   - Integrate existing 4-stage validation pipeline
   - Accept ProjectedModel as input
   - Return ValidationResult

2. **Enhance StagingAreaManager.commit()**
   - Add validation step before applying changes
   - Add backup/restore mechanism
   - Make change application atomic
   - Add proper error handling

3. **Reference Validator Verification**
   - Confirm works on projected models (no changes needed)
   - Document behavior with staged changes

### Task Group 2: Testing

4. **Unit tests for changeset validation** (`cli/tests/unit/test-changeset-validation.ts`)
   - Schema validation on projection
   - Naming validation on projection
   - Reference validation on projection
   - Semantic validation on projection
   - Inter-stage references

5. **Unit tests for drift detection** (`cli/tests/unit/test-drift-detection.ts`)
   - Detect drift when model changed
   - Allow force commit
   - Block commit without force

6. **Integration tests for commit workflow** (`cli/tests/integration/test-commit-workflow.ts`)
   - Bulk commit (10+ changes)
   - Rollback on failure
   - Validation before commit
   - Dry-run support
   - Force vs validation distinction

### Task Group 3: Integration

7. **Update commit command** (`cli/src/commands/changeset.ts`)
   - Wire validation into commit flow
   - Display validation errors
   - Handle drift warnings
   - Support --force flag

8. **Update CLI help/documentation**
   - Document validation behavior
   - Document drift detection
   - Document rollback guarantees

---

## Acceptance Criteria Coverage

| Criteria | Implementation | Tests |
|----------|----------------|-------|
| validateStagedChanges() runs on projected model | ChangesetValidator class | test-changeset-validation.ts |
| Reference validation checks merged view | ProjectedModel passed to validator | test-changeset-validation.ts |
| Reference validation enforces layer constraint | Existing validator + projection | test-changeset-validation.ts |
| detectDrift() compares snapshot hashes | Existing - hash comparison | test-drift-detection.ts |
| Drift report identifies affected items | BaseSnapshotManager output | test-drift-detection.ts |
| commit() blocks on drift without --force | Enhanced commit logic | test-drift-detection.ts |
| commit() blocks on validation errors (force cannot override) | Enhanced commit logic | test-commit-workflow.ts |
| commit() applies changes sequentially | Loop over sorted changes | test-commit-workflow.ts |
| Commit is atomic: all-or-nothing | Backup/restore mechanism | test-commit-workflow.ts |
| Post-commit updates changeset status | Existing code (status = 'committed') | test-commit-workflow.ts |
| Post-commit adds to manifest history | Verify manifest has changeset entry | test-commit-workflow.ts |
| Unit tests for validation on projections | test-changeset-validation.ts | ✓ |
| Unit tests for drift detection | test-drift-detection.ts | ✓ |
| Integration test: 10 staged changes | test-commit-workflow.ts | ✓ |
| Integration test: rollback on failure | test-commit-workflow.ts | ✓ |
| Code reviewed and approved | Code review checklist | N/A |

---

## Risk Mitigation

### Data Loss Prevention
- Backup created before applying changes
- Rollback on any failure
- Validation before application
- Atomic save operations

### Performance
- Validation runs on temporary projection (no persistence)
- Projection caching (existing mechanism)
- Sequential change application (ordered)

### Backward Compatibility
- Existing changeset status values preserved
- New status values ('staged', 'committed') do not conflict
- Validation optional (validate: false for legacy behavior)

---

## Success Metrics

- [ ] All 14 acceptance criteria met
- [ ] All new tests pass
- [ ] No regression in existing tests
- [ ] Code review approved
- [ ] Documentation updated
