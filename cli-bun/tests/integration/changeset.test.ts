import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Model } from '../../src/core/model.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';
import { ChangesetManager, Changeset } from '../../src/core/changeset.js';
import { rm } from 'fs/promises';

const TEST_DIR = '/tmp/changeset-integration-test';

describe('changeset commands integration', () => {
  beforeAll(async () => {
    // Create test directory and model
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Directory may not exist
    }

    // Initialize a test model with a motivation layer
    const model = await Model.init(TEST_DIR, {
      name: 'test-model',
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      specVersion: '0.6.0',
    });

    // Add a motivation layer with an initial element
    const layer = new Layer('motivation');
    const initialGoal = new Element({
      id: 'motivation-goal-initial',
      type: 'goal',
      name: 'Initial Goal',
      description: 'This is the initial goal',
    });
    layer.addElement(initialGoal);
    model.addLayer(layer);

    await model.saveManifest();
    await model.saveLayer('motivation');
  });

  afterAll(async () => {
    // Clean up
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {
      // Ignore errors
    }
  });

  describe('create changeset', () => {
    it('should create a new changeset', async () => {
      const manager = new ChangesetManager(TEST_DIR);
      const changeset = await manager.create(
        'add-requirements',
        'Add new requirements to motivation layer'
      );

      expect(changeset.name).toBe('add-requirements');
      expect(changeset.description).toBe('Add new requirements to motivation layer');
      expect(changeset.status).toBe('draft');
    });
  });

  describe('list changesets', () => {
    it('should list all created changesets', async () => {
      const manager = new ChangesetManager(TEST_DIR);

      // Create multiple changesets
      await manager.create('changeset-1', 'First changeset');
      await manager.create('changeset-2', 'Second changeset');

      const list = await manager.list();

      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.some((c) => c.name === 'changeset-1')).toBe(true);
      expect(list.some((c) => c.name === 'changeset-2')).toBe(true);
    });
  });

  describe('apply changeset', () => {
    it('should apply changes from a changeset to the model', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const manager = new ChangesetManager(TEST_DIR);

      // Create a changeset with an add operation
      const changeset = await manager.create('apply-test', 'Test applying changeset');
      const motivation = await model.getLayer('motivation');

      // Add a change to the changeset
      if (motivation) {
        changeset.addChange('add', 'motivation-goal-new', 'motivation', undefined, {
          type: 'goal',
          name: 'New Goal',
          description: 'Added via changeset',
        });
        await manager.save(changeset);

        // Apply the changeset
        const result = await manager.apply(model, 'apply-test');

        expect(result.applied).toBeGreaterThan(0);
        expect(result.failed).toBe(0);

        // Verify the element was added
        const updated = await model.getLayer('motivation');
        const newElement = updated?.getElement('motivation-goal-new');
        expect(newElement).not.toBeUndefined();
      }
    });
  });

  describe('revert changeset', () => {
    it('should revert changes from a changeset', async () => {
      const model = await Model.load(TEST_DIR, { lazyLoad: false });
      const manager = new ChangesetManager(TEST_DIR);

      // Create a changeset with a delete operation
      const motivation = await model.getLayer('motivation');
      if (motivation) {
        const changeset = await manager.create('revert-test', 'Test reverting changeset');

        // Add a change to delete an element
        changeset.addChange(
          'delete',
          'motivation-goal-initial',
          'motivation',
          {
            type: 'goal',
            name: 'Initial Goal',
            description: 'This is the initial goal',
          },
          undefined
        );
        await manager.save(changeset);

        // Apply the changeset (delete the element)
        await manager.apply(model, 'revert-test');

        // Verify element was deleted
        let element = motivation.getElement('motivation-goal-initial');
        expect(element).toBeUndefined();

        // Revert the changeset (restore the element)
        const revertResult = await manager.revert(model, 'revert-test');

        expect(revertResult.reverted).toBeGreaterThan(0);
        expect(revertResult.failed).toBe(0);

        // Verify element was restored
        const reloadedModel = await Model.load(TEST_DIR, { lazyLoad: false });
        const reloadedMotivation = await reloadedModel.getLayer('motivation');
        element = reloadedMotivation?.getElement('motivation-goal-initial');
        expect(element).toBeDefined();
      }
    });
  });

  describe('changeset status tracking', () => {
    it('should track changeset status through lifecycle', async () => {
      const manager = new ChangesetManager(TEST_DIR);

      const changeset = await manager.create('status-test', 'Test status tracking');
      expect(changeset.status).toBe('draft');

      // Mark as applied
      changeset.markApplied();
      await manager.save(changeset);

      const loaded = await manager.load('status-test');
      expect(loaded?.status).toBe('applied');

      // Mark as reverted
      if (loaded) {
        loaded.markReverted();
        await manager.save(loaded);
      }

      const reloaded = await manager.load('status-test');
      expect(reloaded?.status).toBe('reverted');
    });
  });

  describe('changeset with multiple change types', () => {
    it('should track different change types correctly', async () => {
      const manager = new ChangesetManager(TEST_DIR);
      const changeset = await manager.create('multi-change', 'Multiple change types');

      // Add different types of changes
      changeset.addChange('add', 'elem-1', 'motivation', undefined, {
        name: 'Add',
      });
      changeset.addChange('update', 'elem-2', 'business', {}, { name: 'Update' });
      changeset.addChange('delete', 'elem-3', 'application', {}, undefined);

      expect(changeset.getChangesByType('add')).toHaveLength(1);
      expect(changeset.getChangesByType('update')).toHaveLength(1);
      expect(changeset.getChangesByType('delete')).toHaveLength(1);
      expect(changeset.getChangeCount()).toBe(3);
    });
  });
});
