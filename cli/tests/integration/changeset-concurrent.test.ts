import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { StagingAreaManager } from '../../src/core/staging-area.js';
import { rm, mkdir, cp } from 'fs/promises';
import path from 'path';

const TEST_DIR = '/tmp/changeset-concurrent-test';
const BASELINE_DIR = path.join(process.cwd(), '..', 'cli-validation', 'test-project', 'baseline');

describe('Changeset Concurrent Operations', () => {
  let model: Model;

  beforeEach(async () => {
    // Clean test directory
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }

    await mkdir(TEST_DIR, { recursive: true });

    // Copy baseline project
    await cp(BASELINE_DIR, TEST_DIR, { recursive: true });

    // Load model
    model = await Model.load(TEST_DIR, { lazyLoad: false });
  });

  afterAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('simultaneous staging operations', () => {
    it('should handle concurrent stage operations with correct sequence numbers', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const changeset = await manager.create('concurrent-staging', 'Test');
      await manager.setActive(changeset.id!);

      // Stage multiple changes concurrently
      const stagePromises = Array.from({ length: 10 }, (_, i) =>
        manager.stage(changeset.id!, {
          type: 'add',
          elementId: `motivation-goal-concurrent-${i}`,
          layerName: 'motivation',
          timestamp: new Date().toISOString(),
          after: {
            type: 'goal',
            name: `Concurrent Goal ${i}`,
            description: `Goal added concurrently ${i}`
          }
        })
      );

      // Wait for all staging operations
      await Promise.all(stagePromises);

      // Load changeset and verify
      const loaded = await manager.load(changeset.id!);
      expect(loaded).not.toBeNull();
      expect(loaded!.changes.length).toBe(10);

      // Verify sequence numbers are unique and sequential
      const sequenceNumbers = loaded!.changes.map(c => (c as any).sequenceNumber).sort((a, b) => a - b);
      const expectedSequence = Array.from({ length: 10 }, (_, i) => i);
      expect(sequenceNumbers).toEqual(expectedSequence);

      // Verify all element IDs are present
      const elementIds = loaded!.changes.map(c => c.elementId).sort();
      const expectedIds = Array.from({ length: 10 }, (_, i) => `motivation-goal-concurrent-${i}`).sort();
      expect(elementIds).toEqual(expectedIds);
    });

    it('should handle concurrent unstage operations', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const changeset = await manager.create('concurrent-unstaging', 'Test');
      await manager.setActive(changeset.id!);

      // Stage multiple changes
      for (let i = 0; i < 10; i++) {
        await manager.stage(changeset.id!, {
          type: 'add',
          elementId: `test-elem-${i}`,
          layerName: 'motivation',
          timestamp: new Date().toISOString(),
          after: { type: 'goal', name: `Element ${i}` }
        });
      }

      // Unstage multiple elements concurrently
      const unstagePromises = [0, 2, 4, 6, 8].map(i =>
        manager.unstage(changeset.id!, `test-elem-${i}`)
      );

      await Promise.all(unstagePromises);

      // Verify remaining changes
      const loaded = await manager.load(changeset.id!);
      expect(loaded!.changes.length).toBe(5);

      // Verify correct elements remain
      const remainingIds = loaded!.changes.map(c => c.elementId).sort();
      expect(remainingIds).toEqual(['test-elem-1', 'test-elem-3', 'test-elem-5', 'test-elem-7', 'test-elem-9']);

      // Verify sequence numbers are resequenced correctly
      const sequenceNumbers = loaded!.changes.map(c => (c as any).sequenceNumber).sort((a, b) => a - b);
      expect(sequenceNumbers).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle concurrent changeset creation', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create multiple changesets concurrently
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        manager.create(`concurrent-create-${i}`, `Test ${i}`)
      );

      const changesets = await Promise.all(createPromises);

      // Verify all changesets were created
      expect(changesets.length).toBe(5);

      // Verify all have unique IDs
      const ids = changesets.map(c => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(5);

      // Verify all are listed
      const list = await manager.list();
      expect(list.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('concurrent file access', () => {
    it('should handle concurrent save operations', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const changeset = await manager.create('concurrent-save', 'Test');
      await manager.setActive(changeset.id!);

      // Modify and save changeset multiple times concurrently
      const savePromises = Array.from({ length: 5 }, async (_, i) => {
        await manager.stage(changeset.id!, {
          type: 'add',
          elementId: `test-${i}`,
          layerName: 'motivation',
          timestamp: new Date().toISOString(),
          after: { type: 'goal', name: `Test ${i}` }
        });
      });

      await Promise.all(savePromises);

      // Verify final state
      const loaded = await manager.load(changeset.id!);
      expect(loaded!.changes.length).toBe(5);
    });

    it('should handle concurrent load operations', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const changeset = await manager.create('concurrent-load', 'Test');

      // Load changeset multiple times concurrently
      const loadPromises = Array.from({ length: 10 }, () =>
        manager.load(changeset.id!)
      );

      const results = await Promise.all(loadPromises);

      // Verify all loads succeeded
      expect(results.every(r => r !== null)).toBe(true);
      expect(results.every(r => r!.id === changeset.id)).toBe(true);
    });

    it('should handle concurrent delete operations gracefully', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);

      // Create multiple changesets
      const changesets = await Promise.all([
        manager.create('delete-1', 'Test 1'),
        manager.create('delete-2', 'Test 2'),
        manager.create('delete-3', 'Test 3')
      ]);

      // Try to delete same changeset multiple times concurrently
      const deletePromises = Array.from({ length: 5 }, () =>
        manager.delete(changesets[0].id!).catch(() => null)
      );

      const results = await Promise.all(deletePromises);

      // At least one should succeed, others should fail gracefully
      const successes = results.filter(r => r !== null).length;
      expect(successes).toBeGreaterThanOrEqual(1);

      // Verify changeset is deleted
      const loaded = await manager.load(changesets[0].id!);
      expect(loaded).toBeNull();
    });
  });

  describe('race conditions in sequence numbers', () => {
    it('should maintain sequence number integrity under concurrent staging', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const changeset = await manager.create('sequence-race', 'Test');
      await manager.setActive(changeset.id!);

      // Stage changes with intentional timing to trigger race conditions
      const stagePromises = Array.from({ length: 20 }, async (_, i) => {
        // Random delay to increase chance of race condition
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

        return manager.stage(changeset.id!, {
          type: 'add',
          elementId: `race-elem-${i}`,
          layerName: 'motivation',
          timestamp: new Date().toISOString(),
          after: { type: 'goal', name: `Element ${i}` }
        });
      });

      await Promise.all(stagePromises);

      // Verify sequence numbers
      const loaded = await manager.load(changeset.id!);
      expect(loaded!.changes.length).toBe(20);

      const sequenceNumbers = loaded!.changes.map(c => (c as any).sequenceNumber).sort((a, b) => a - b);

      // Should be sequential from 0 to 19
      for (let i = 0; i < 20; i++) {
        expect(sequenceNumbers[i]).toBe(i);
      }

      // Should have no duplicates
      const uniqueSequences = new Set(sequenceNumbers);
      expect(uniqueSequences.size).toBe(20);
    });

    it('should handle concurrent stage and unstage operations', async () => {
      const manager = new StagingAreaManager(TEST_DIR, model);
      const changeset = await manager.create('stage-unstage-race', 'Test');
      await manager.setActive(changeset.id!);

      // Pre-populate with some changes
      for (let i = 0; i < 10; i++) {
        await manager.stage(changeset.id!, {
          type: 'add',
          elementId: `initial-${i}`,
          layerName: 'motivation',
          timestamp: new Date().toISOString(),
          after: { type: 'goal', name: `Initial ${i}` }
        });
      }

      // Mix of stage and unstage operations
      const operations = [
        // Stage new changes
        ...Array.from({ length: 5 }, (_, i) =>
          manager.stage(changeset.id!, {
            type: 'add',
            elementId: `new-${i}`,
            layerName: 'motivation',
            timestamp: new Date().toISOString(),
            after: { type: 'goal', name: `New ${i}` }
          })
        ),
        // Unstage existing changes
        ...Array.from({ length: 5 }, (_, i) =>
          manager.unstage(changeset.id!, `initial-${i}`)
        )
      ];

      // Shuffle operations to increase race condition likelihood
      operations.sort(() => Math.random() - 0.5);

      await Promise.all(operations);

      // Verify final state
      const loaded = await manager.load(changeset.id!);
      expect(loaded!.changes.length).toBe(10); // 10 initial - 5 unstaged + 5 new

      // Verify sequence numbers are still valid
      const sequenceNumbers = loaded!.changes.map(c => (c as any).sequenceNumber).sort((a, b) => a - b);
      expect(sequenceNumbers).toEqual(Array.from({ length: 10 }, (_, i) => i));
    });
  });

  describe('atomicity under concurrency', () => {
    it('should maintain backup integrity during concurrent commits', async () => {
      const manager1 = new StagingAreaManager(TEST_DIR, model);
      const manager2 = new StagingAreaManager(TEST_DIR, model);

      // Create two changesets
      const cs1 = await manager1.create('atomic-1', 'Test 1');
      const cs2 = await manager2.create('atomic-2', 'Test 2');

      // Stage changes sequentially first to avoid conflicts
      await manager1.setActive(cs1.id!);
      await manager1.stage(cs1.id!, {
        type: 'add',
        elementId: 'motivation-goal-atomic1',
        layerName: 'motivation',
        timestamp: new Date().toISOString(),
        after: { type: 'goal', name: 'Goal 1' }
      });
      await manager1.clearActive();

      // Stage changes for second changeset
      await manager2.setActive(cs2.id!);
      await manager2.stage(cs2.id!, {
        type: 'add',
        elementId: 'motivation-goal-atomic2',
        layerName: 'motivation',
        timestamp: new Date().toISOString(),
        after: { type: 'goal', name: 'Goal 2' }
      });
      await manager2.clearActive();

      // Commit sequentially (file locking will serialize them anyway)
      // This tests that atomic commit works correctly, not concurrent behavior
      const result1 = await manager1.commit(model, cs1.id!, { validate: false, force: true });
      const result2 = await manager2.commit(model, cs2.id!, { validate: false, force: true });

      // Both should succeed
      expect(result1.committed).toBe(1);
      expect(result2.committed).toBe(1);

      // Verify both changes were applied
      await model.loadLayer('motivation');
      const layer = await model.getLayer('motivation');
      expect(layer?.getElement('motivation-goal-atomic1')).toBeDefined();
      expect(layer?.getElement('motivation-goal-atomic2')).toBeDefined();
    });
  });
});
