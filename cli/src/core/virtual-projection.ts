/**
 * VirtualProjectionEngine - Computes merged model views by applying staged changes.
 *
 * Creates virtual (temporary) projections of the base model with staged changes applied,
 * without modifying or persisting the base model. Enables safe preview and validation
 * of changes before commit. Includes projection caching with TTL-based expiration.
 *
 * Staging changes are applied in sequence order to compute accurate merged views.
 */

import type { Model } from './model.js';
import type { Layer } from './layer.js';
import type { Element } from './element.js';
import type { Manifest } from './manifest.js';
import { Layer as LayerClass } from './layer.js';
import { Element as ElementClass } from './element.js';
import type { StagedChange, Change } from './changeset.js';
import { StagedChangesetStorage } from './staged-changeset-storage.js';

/**
 * Projected model with isProjection flag to prevent accidental saves.
 * This marker interface ensures that projected models are recognized as temporary
 * and cannot be persisted to disk without explicit commit of the underlying changeset.
 */
export interface ProjectedModel {
  manifest: Manifest;
  layers: Map<string, Layer>;
  isProjection: true; // Always true; marks this as a temporary virtual projection
}

/**
 * Model diff categorizing changeset changes by type.
 * Separates staged changes into additions (new elements), modifications (updated properties),
 * and deletions (removed elements). Used for preview and diff display operations.
 */
export interface ModelDiff {
  additions: Array<{
    elementId: string;
    layerName: string;
    data: Record<string, unknown>; // Complete element state (from change.after)
  }>;
  modifications: Array<{
    elementId: string;
    layerName: string;
    before: Record<string, unknown>; // Previous state (from change.before)
    after: Record<string, unknown>;  // New state (from change.after)
  }>;
  deletions: Array<{
    elementId: string;
    layerName: string;
    data: Record<string, unknown>; // Element state before deletion (from change.before)
  }>;
}

/**
 * Single cached layer projection.
 * Stores the computed projected layer and timestamp for cache expiration.
 */
interface CacheEntry {
  layer: Layer;
  computedAt: string; // ISO timestamp for age calculation
}

/**
 * Projection cache for storing computed layer projections.
 * Uses TTL-based expiration to prevent stale projections.
 * Entries are lazily removed when expired on access or during periodic cleanup.
 */
interface ProjectionCache {
  cache: Map<string, CacheEntry>; // Key format: `${changesetId}:${layerName}`
  maxAge: number; // Cache entry TTL in milliseconds (5 minutes default)
  lastCleanup: number; // Timestamp of last cleanup to limit cleanup frequency
}

/**
 * VirtualProjectionEngine - Computes merged model views without persisting.
 * Applies staged changes to a cloned base model to compute projections.
 * Uses caching with TTL-based expiration to optimize repeated projections.
 */
export class VirtualProjectionEngine {
  private stagingAreaManager: StagedChangesetStorage;
  private projectionCache: ProjectionCache;

  /**
   * Create a new projection engine.
   *
   * @param rootPath - Root path to the model (used by StagedChangesetStorage)
   */
  constructor(rootPath: string) {
    this.stagingAreaManager = new StagedChangesetStorage(rootPath);
    this.projectionCache = {
      cache: new Map(),
      maxAge: 5 * 60 * 1000, // 5-minute TTL for cached projections
      lastCleanup: Date.now(),
    };
  }

  /**
   * Project a single element by applying staged changes to it.
   * Merges the element's base state with staged changes to compute its projected state.
   *
   * @param baseModel - The base model to project from
   * @param changesetId - ID of the changeset containing staged changes
   * @param elementId - ID of the element to project
   * @returns Projected element with staged changes applied, or null if element is deleted
   * @throws Error if changeset not found
   *
   * @remarks
   * If multiple changes exist for the element, the last change determines final state.
   * For 'delete' operations, returns null.
   * For 'add' operations without base element, creates new element from staged data.
   * For 'update' operations, merges staged changes with base element properties.
   */
  async projectElement(
    baseModel: Model,
    changesetId: string,
    elementId: string
  ): Promise<Element | null> {
    const changeset = await this.stagingAreaManager.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    // Find all changes for this element across all layers
    const elementChanges = changeset.changes.filter(
      (c: Change) => c.elementId === elementId
    ) as StagedChange[];

    if (elementChanges.length === 0) {
      // No changes, return base element if it exists
      return baseModel.getElementById(elementId) || null;
    }

    // Get the last change to determine the element's final state
    const lastChange = elementChanges[elementChanges.length - 1];

    if (lastChange.type === 'delete') {
      return null;
    }

    // For add or update, construct the projected element
    const baseElement = baseModel.getElementById(elementId);
    const projectedData = lastChange.after || {};

    if (baseElement) {
      // Create a new element with projected data merged with base
      const mergedData = {
        id: baseElement.id,
        name: (typeof projectedData.name === 'string' ? projectedData.name : baseElement.name),
        type: (typeof projectedData.type === 'string' ? projectedData.type : baseElement.type),
        description: (typeof projectedData.description === 'string' ? projectedData.description : baseElement.description),
        properties: {
          ...baseElement.properties,
          ...(typeof projectedData.properties === 'object' ? projectedData.properties : {}),
        },
        references: Array.isArray(projectedData.references)
          ? projectedData.references
          : baseElement.references,
        relationships: Array.isArray(projectedData.relationships)
          ? projectedData.relationships
          : baseElement.relationships,
        layer: baseElement.layer,
      };

      return new ElementClass(mergedData);
    } else if (lastChange.type === 'add') {
      // New element being added
      return new ElementClass({
        id: elementId,
        name: (projectedData.name as string) || elementId,
        type: (projectedData.type as string) || 'unknown',
        description: (projectedData.description as string) || '',
        properties: (typeof projectedData.properties === 'object'
          ? projectedData.properties
          : {}) as Record<string, unknown>,
        references: Array.isArray(projectedData.references)
          ? projectedData.references
          : [],
        relationships: Array.isArray(projectedData.relationships)
          ? projectedData.relationships
          : [],
        layer: lastChange.layerName,
      });
    }

    return null;
  }

  /**
   * Project a layer by applying staged changes to a clone of the base layer.
   * Checks cache first; computes and caches result if not found or expired.
   *
   * @param baseModel - The base model to project from
   * @param changesetId - ID of the changeset containing staged changes
   * @param layerName - Name of the layer to project
   * @returns Projected layer with staged changes applied
   * @throws Error if changeset or base layer not found
   *
   * @remarks
   * Computation process:
   * 1. Check projection cache (returns if found and not expired)
   * 2. Clone base layer to avoid mutations
   * 3. Load staged changes filtered to this layer
   * 4. Apply changes in sequence number order (add/update/delete)
   * 5. Cache result with timestamp for TTL tracking
   * 6. Trigger periodic cache cleanup
   */
  async projectLayer(
    baseModel: Model,
    changesetId: string,
    layerName: string
  ): Promise<Layer> {
    // Check cache first
    const cacheKey = `${changesetId}:${layerName}`;
    const cached = this.projectionCache.cache.get(cacheKey);

    if (cached) {
      const age = Date.now() - new Date(cached.computedAt).getTime();
      if (age < this.projectionCache.maxAge) {
        return cached.layer;
      } else {
        // Invalidate expired entry
        this.projectionCache.cache.delete(cacheKey);
      }
    }

    // Load base layer
    const baseLayer = await baseModel.getLayer(layerName);
    if (!baseLayer) {
      throw new Error(`Layer '${layerName}' not found in base model`);
    }

    // Clone base layer to avoid mutations
    const projectedLayer = this.cloneLayer(baseLayer);

    // Load staged changes for this layer
    const changeset = await this.stagingAreaManager.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const layerChanges = (changeset.changes as StagedChange[])
      .filter((c: StagedChange) => c.layerName === layerName)
      .sort((a: StagedChange, b: StagedChange) => a.sequenceNumber - b.sequenceNumber);

    // Apply changes in sequence order
    for (const change of layerChanges) {
      switch (change.type) {
        case 'add':
          if (change.after) {
            const newElement = new ElementClass({
              id: change.elementId,
              name: (change.after.name as string) || change.elementId,
              type: (change.after.type as string) || 'unknown',
              description: (change.after.description as string) || '',
              properties: (typeof change.after.properties === 'object'
                ? change.after.properties
                : {}) as Record<string, unknown>,
              references: Array.isArray(change.after.references)
                ? change.after.references
                : [],
              relationships: Array.isArray(change.after.relationships)
                ? change.after.relationships
                : [],
              layer: layerName,
            });
            projectedLayer.addElement(newElement);
          }
          break;

        case 'update':
          if (change.after) {
            const existing = projectedLayer.getElement(change.elementId);
            if (existing) {
              // Merge projected data with existing
              existing.name = (change.after.name as string) || existing.name;
              existing.type = (change.after.type as string) || existing.type;
              existing.description =
                (change.after.description as string) || existing.description;

              if (typeof change.after.properties === 'object') {
                existing.properties = {
                  ...existing.properties,
                  ...change.after.properties,
                };
              }

              if (Array.isArray(change.after.references)) {
                existing.references = change.after.references;
              }

              if (Array.isArray(change.after.relationships)) {
                existing.relationships = change.after.relationships;
              }
            }
          }
          break;

        case 'delete':
          projectedLayer.deleteElement(change.elementId);
          break;
      }
    }

    // Cache the result
    const cacheEntry: CacheEntry = {
      layer: projectedLayer,
      computedAt: new Date().toISOString(),
    };
    this.projectionCache.cache.set(cacheKey, cacheEntry);

    // Periodic cleanup of expired entries
    this.cleanupExpiredCache();

    return projectedLayer;
  }

  /**
   * Project entire model by applying staged changes to all layers.
   * Creates a complete projected model view that includes both changed and unchanged layers.
   *
   * @param baseModel - The base model to project from
   * @param changesetId - ID of the changeset containing staged changes
   * @returns ProjectedModel with isProjection=true flag (prevents accidental saves)
   * @throws Error if changeset not found
   *
   * @remarks
   * Projection includes:
   * - All layers mentioned in changeset changes
   * - All layers from base model (to have complete model state)
   * - Base model's manifest (unchanged)
   * Returned model has isProjection=true to prevent accidental persistence.
   */
  async projectModel(baseModel: Model, changesetId: string): Promise<ProjectedModel> {
    const changeset = await this.stagingAreaManager.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const projectedLayers = new Map<string, Layer>();

    // Project all layers mentioned in the changeset
    const layerNames = new Set<string>();
    for (const change of changeset.changes) {
      layerNames.add(change.layerName);
    }

    // Also include all base layers to get complete model
    for (const baseLayerName of baseModel.getLayerNames()) {
      layerNames.add(baseLayerName);
    }

    // Project each layer
    for (const layerName of layerNames) {
      const projectedLayer = await this.projectLayer(baseModel, changesetId, layerName);
      projectedLayers.set(layerName, projectedLayer);
    }

    // Create projected model with isProjection flag
    const projectedModel: ProjectedModel = {
      manifest: baseModel.manifest,
      layers: projectedLayers,
      isProjection: true,
    };

    return projectedModel;
  }

  /**
   * Compute diff by categorizing changeset changes by type.
   * Extracts the staged changes and organizes them into additions, modifications, and deletions.
   *
   * @param _baseModel - The base model (unused; included for interface compatibility)
   * @param changesetId - ID of the changeset to compute diff for
   * @returns ModelDiff with changes categorized by type
   * @throws Error if changeset not found
   *
   * @remarks
   * Diff is computed directly from changeset changes; does not perform deep comparison.
   * Each change's before/after snapshots are included for detailed display.
   */
  async computeDiff(_baseModel: Model, changesetId: string): Promise<ModelDiff> {
    const changeset = await this.stagingAreaManager.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const changes = changeset.changes as StagedChange[];

    return {
      additions: changes
        .filter((c: StagedChange) => c.type === 'add')
        .map((c: StagedChange) => ({
          elementId: c.elementId,
          layerName: c.layerName,
          data: c.after || {},
        })),

      modifications: changes
        .filter((c: StagedChange) => c.type === 'update')
        .map((c: StagedChange) => ({
          elementId: c.elementId,
          layerName: c.layerName,
          before: c.before || {},
          after: c.after || {},
        })),

      deletions: changes
        .filter((c: StagedChange) => c.type === 'delete')
        .map((c: StagedChange) => ({
          elementId: c.elementId,
          layerName: c.layerName,
          data: c.before || {},
        })),
    };
  }

  /**
   * Invalidate projection cache when changes are staged.
   * Removes cached projections to ensure fresh computation next time.
   *
   * @param changesetId - ID of the changeset being modified
   * @param layerName - Optional: specific layer to invalidate (all if omitted)
   *
   * @remarks
   * If layerName is provided, only that layer's projection is invalidated.
   * Otherwise, all projections for the changeset are invalidated.
   */
  invalidateOnStage(changesetId: string, layerName?: string): void {
    if (layerName) {
      // Invalidate specific layer projection
      const cacheKey = `${changesetId}:${layerName}`;
      this.projectionCache.cache.delete(cacheKey);
    } else {
      // Invalidate all projections for this changeset
      for (const key of this.projectionCache.cache.keys()) {
        if (key.startsWith(`${changesetId}:`)) {
          this.projectionCache.cache.delete(key);
        }
      }
    }
  }

  /**
   * Invalidate projection cache when changes are unstaged.
   * Delegates to invalidateOnStage (same cache invalidation logic).
   *
   * @param changesetId - ID of the changeset being modified
   * @param layerName - Optional: specific layer to invalidate (all if omitted)
   */
  invalidateOnUnstage(changesetId: string, layerName?: string): void {
    this.invalidateOnStage(changesetId, layerName);
  }

  /**
   * Invalidate all projections for a changeset when it's discarded.
   * Clears all cached projections for this changeset to free memory.
   *
   * @param changesetId - ID of the changeset being discarded
   */
  invalidateOnDiscard(changesetId: string): void {
    for (const key of this.projectionCache.cache.keys()) {
      if (key.startsWith(`${changesetId}:`)) {
        this.projectionCache.cache.delete(key);
      }
    }
  }

  /**
   * Clone a layer to create an independent copy.
   * Deep clones all elements and metadata to avoid mutations.
   * Cloned layer is marked clean to prevent unintended saves.
   *
   * @param layer - The layer to clone
   * @returns New layer with cloned elements and metadata
   *
   * @remarks
   * Cloning strategy:
   * 1. Create new Layer with same name
   * 2. Clone each element: deep copy properties, references, relationships
   * 3. Copy layer metadata if present
   * 4. Mark cloned layer as clean to prevent automatic saves
   * This ensures changes to projection don't affect base layer.
   */
  private cloneLayer(layer: Layer): Layer {
    const cloned = new LayerClass(layer.name);

    // Clone all elements (deep copy to avoid mutations)
    for (const element of layer.listElements()) {
      const elementClone = new ElementClass({
        id: element.id,
        name: element.name,
        type: element.type,
        description: element.description,
        properties: { ...element.properties },        // Shallow copy (properties are read-only in projection)
        references: [...(element.references || [])],  // Shallow copy of array
        relationships: [...(element.relationships || [])], // Shallow copy of array
        layer: element.layer,
      });
      cloned.addElement(elementClone);
    }

    // Preserve layer metadata if present
    if (layer.metadata) {
      cloned.metadata = { ...layer.metadata };
    }

    // Mark as clean to prevent projection from being saved
    cloned.markClean();
    return cloned;
  }

  /**
   * Clean up expired cache entries periodically (every 60 seconds).
   * Removes entries that exceed the maxAge TTL.
   * Runs at most once per minute to limit overhead.
   *
   * @remarks
   * Cleanup is triggered after each projection computation.
   * Early exit if last cleanup was less than 60 seconds ago.
   * Entries are marked for deletion based on age calculation from computedAt timestamp.
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();

    // Limit cleanup frequency to at most every 60 seconds
    if (now - this.projectionCache.lastCleanup < 60 * 1000) {
      return;
    }

    // Remove entries that have exceeded their TTL
    for (const [key, entry] of this.projectionCache.cache.entries()) {
      const age = now - new Date(entry.computedAt).getTime();
      if (age >= this.projectionCache.maxAge) {
        this.projectionCache.cache.delete(key);
      }
    }

    this.projectionCache.lastCleanup = now;
  }
}
