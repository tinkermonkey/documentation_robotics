/**
 * VirtualProjectionEngine - Computes merged model views by applying staged changes
 *
 * Creates virtual projections of the base model with staged changes applied,
 * without persisting the result. Enables preview and validation operations.
 */

import type { Model } from './model.js';
import type { Layer } from './layer.js';
import type { Element } from './element.js';
import type { Manifest } from './manifest.js';
import { Layer as LayerClass } from './layer.js';
import { Element as ElementClass } from './element.js';
import type { StagedChangesetData, StagedChange } from './changeset.js';
import { StagedChangesetStorage } from './staged-changeset-storage.js';

/**
 * Projected model with isProjection flag to prevent accidental saves
 */
export interface ProjectedModel {
  manifest: Manifest;
  layers: Map<string, Layer>;
  isProjection: true;
}

/**
 * Model diff categorizing changes into additions, modifications, deletions
 */
export interface ModelDiff {
  additions: Array<{
    elementId: string;
    layerName: string;
    data: Record<string, unknown>;
  }>;
  modifications: Array<{
    elementId: string;
    layerName: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
  deletions: Array<{
    elementId: string;
    layerName: string;
    data: Record<string, unknown>;
  }>;
}

/**
 * Projection cache entry
 */
interface CacheEntry {
  layer: Layer;
  computedAt: string;
}

/**
 * Cache configuration and management
 */
interface ProjectionCache {
  cache: Map<string, CacheEntry>;
  maxAge: number;
  lastCleanup: number;
}

/**
 * VirtualProjectionEngine - Computes merged model views
 */
export class VirtualProjectionEngine {
  private stagingAreaManager: StagedChangesetStorage;
  private projectionCache: ProjectionCache;

  constructor(rootPath: string) {
    this.stagingAreaManager = new StagedChangesetStorage(rootPath);
    this.projectionCache = {
      cache: new Map(),
      maxAge: 5 * 60 * 1000, // 5 minutes TTL
      lastCleanup: Date.now(),
    };
  }

  /**
   * Create merged view of a single element by applying staged changes
   * Returns the projected element state or null if deleted
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
    const elementChanges = (changeset as any).changes.filter(
      (c: StagedChange) => c.elementId === elementId
    );

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
        name: projectedData.name || baseElement.name,
        type: projectedData.type || baseElement.type,
        description: projectedData.description || baseElement.description,
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
   * Create merged view of a layer by applying staged changes
   * Clones base layer and applies changes in sequence order
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

    const layerChanges = (changeset as any).changes
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
   * Create merged view of entire model by applying staged changes to all layers
   */
  async projectModel(baseModel: Model, changesetId: string): Promise<ProjectedModel> {
    const changeset = await this.stagingAreaManager.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const projectedLayers = new Map<string, Layer>();

    // Project all layers mentioned in the changeset
    const layerNames = new Set<string>();
    for (const change of (changeset as any).changes) {
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
   * Compute diff by categorizing changeset changes
   */
  async computeDiff(baseModel: Model, changesetId: string): Promise<ModelDiff> {
    const changeset = await this.stagingAreaManager.load(changesetId);
    if (!changeset) {
      throw new Error(`Changeset '${changesetId}' not found`);
    }

    const changeData = changeset as any;

    return {
      additions: changeData.changes
        .filter((c: StagedChange) => c.type === 'add')
        .map((c: StagedChange) => ({
          elementId: c.elementId,
          layerName: c.layerName,
          data: c.after || {},
        })),

      modifications: changeData.changes
        .filter((c: StagedChange) => c.type === 'update')
        .map((c: StagedChange) => ({
          elementId: c.elementId,
          layerName: c.layerName,
          before: c.before || {},
          after: c.after || {},
        })),

      deletions: changeData.changes
        .filter((c: StagedChange) => c.type === 'delete')
        .map((c: StagedChange) => ({
          elementId: c.elementId,
          layerName: c.layerName,
          data: c.before || {},
        })),
    };
  }

  /**
   * Invalidate projection cache for a changeset when changes are staged
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
   * Invalidate projection cache when changes are unstaged
   */
  invalidateOnUnstage(changesetId: string, layerName?: string): void {
    this.invalidateOnStage(changesetId, layerName);
  }

  /**
   * Invalidate all projections for a changeset when it's discarded
   */
  invalidateOnDiscard(changesetId: string): void {
    for (const key of this.projectionCache.cache.keys()) {
      if (key.startsWith(`${changesetId}:`)) {
        this.projectionCache.cache.delete(key);
      }
    }
  }

  /**
   * Clone a layer to create independent copy
   */
  private cloneLayer(layer: Layer): Layer {
    const cloned = new LayerClass(layer.name);

    // Clone all elements
    for (const element of layer.listElements()) {
      const elementClone = new ElementClass({
        id: element.id,
        name: element.name,
        type: element.type,
        description: element.description,
        properties: { ...element.properties },
        references: [...(element.references || [])],
        relationships: [...(element.relationships || [])],
        layer: element.layer,
      });
      cloned.addElement(elementClone);
    }

    // Preserve metadata if present
    if (layer.metadata) {
      cloned.metadata = { ...layer.metadata };
    }

    cloned.markClean();
    return cloned;
  }

  /**
   * Clean up expired cache entries periodically
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();

    // Cleanup every 60 seconds at most
    if (now - this.projectionCache.lastCleanup < 60 * 1000) {
      return;
    }

    for (const [key, entry] of this.projectionCache.cache.entries()) {
      const age = now - new Date(entry.computedAt).getTime();
      if (age >= this.projectionCache.maxAge) {
        this.projectionCache.cache.delete(key);
      }
    }

    this.projectionCache.lastCleanup = now;
  }
}
