/**
 * Test Fixtures and Model Helpers
 * Provides reusable fixtures for creating test models and elements
 *
 * Golden Copy Integration:
 * - createTestModel() can now use shared golden copy for better performance
 * - Set USE_GOLDEN_COPY=true to enable (defaults to true if available)
 * - Falls back to original behavior if golden copy is unavailable
 */

import { Model } from '../../src/core/model.js';
import { Layer } from '../../src/core/layer.js';
import { Element } from '../../src/core/element.js';
import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { GoldenCopyCacheManager } from '../../src/core/golden-copy-cache.js';

declare global {
  var __GOLDEN_COPY_INITIALIZED__: boolean;
}

/**
 * Interface for test model creation options
 */
export interface TestModelOptions {
  name?: string;
  version?: string;
  specVersion?: string;
  description?: string;
  author?: string;
  lazyLoad?: boolean;
}

/**
 * Create a test model with standard configuration
 * Automatically cleans up temporary directory on creation
 *
 * Golden Copy Enhancement: Optionally uses shared golden copy for better performance
 * - Set USE_GOLDEN_COPY=true to enable (will attempt to use if available)
 * - Respects DISABLE_GOLDEN_COPY=true to force fresh creation
 * - Falls back gracefully if golden copy initialization fails
 *
 * @param options Optional configuration for the test model
 * @returns Promise resolving to the initialized Model
 */
export async function createTestModel(options?: TestModelOptions): Promise<{
  model: Model;
  rootPath: string;
  cleanup: () => Promise<void>;
}> {
  // Check if golden copy should be used
  const useGoldenCopy = process.env.DISABLE_GOLDEN_COPY !== 'true' &&
                        (process.env.USE_GOLDEN_COPY === 'true' ||
                         globalThis.__GOLDEN_COPY_INITIALIZED__ === true);

  if (useGoldenCopy) {
    try {
      const manager = GoldenCopyCacheManager.getInstance();

      // Only try to use golden copy if it's been initialized
      if (manager.isInitialized()) {
        const cloned = await manager.clone();

        if (process.env.DEBUG_GOLDEN_COPY) {
          console.log(`[Fixtures] Using golden copy clone (${cloned.stats.cloneTime}ms)`);
        }

        return {
          model: cloned.model,
          rootPath: cloned.rootPath,
          cleanup: cloned.cleanup,
        };
      }
    } catch (error) {
      // Log but don't fail - fall through to normal creation
      if (process.env.DEBUG_GOLDEN_COPY) {
        console.warn(
          `[Fixtures] Golden copy unavailable, falling back to createTestModel:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  // Fallback: Create fresh model (original behavior)
  const rootPath = join(tmpdir(), `dr-test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`);

  await mkdir(rootPath, { recursive: true });

  const model = await Model.init(
    rootPath,
    {
      name: options?.name ?? 'Test Model',
      version: options?.version ?? '0.1.0',
      specVersion: options?.specVersion ?? '0.6.0',
      description: options?.description ?? 'Test model for integration tests',
      author: options?.author ?? 'Test Suite',
      created: new Date().toISOString(),
    },
    { lazyLoad: options?.lazyLoad ?? false }
  );

  return {
    model,
    rootPath,
    cleanup: async () => {
      try {
        await rm(rootPath, { recursive: true, force: true });
      } catch (e) {
        // Silently ignore cleanup errors
      }
    },
  };
}

/**
 * Add a test element to a model layer
 *
 * @param model The model to add the element to
 * @param layerName The name of the layer (e.g., 'motivation', 'business')
 * @param type The type of element (e.g., 'goal', 'service')
 * @param id The element ID
 * @param options Additional element properties
 * @returns The created element
 */
export async function addTestElement(
  model: Model,
  layerName: string,
  type: string,
  id: string,
  options?: {
    name?: string;
    description?: string;
    properties?: Record<string, unknown>;
  }
): Promise<Element> {
  let layer = await model.getLayer(layerName);

  if (!layer) {
    layer = new Layer(layerName);
    model.addLayer(layer);
  }

  const element = new Element({
    id,
    type,
    name: options?.name ?? `Test ${type}`,
    description: options?.description ?? `Test element of type ${type}`,
    properties: options?.properties ?? {},
  });

  layer.addElement(element);
  await model.save();

  return element;
}

/**
 * Add multiple test elements to a layer in bulk
 *
 * @param model The model to add elements to
 * @param layerName The layer name
 * @param elements Array of element definitions
 * @returns Array of created elements
 */
export async function addTestElements(
  model: Model,
  layerName: string,
  elements: Array<{
    type: string;
    id: string;
    name?: string;
    description?: string;
    properties?: Record<string, unknown>;
  }>
): Promise<Element[]> {
  const created: Element[] = [];

  for (const elementDef of elements) {
    const element = await addTestElement(model, layerName, elementDef.type, elementDef.id, {
      name: elementDef.name,
      description: elementDef.description,
      properties: elementDef.properties,
    });
    created.push(element);
  }

  return created;
}

/**
 * Populate a test model with sample data across multiple layers
 *
 * @param model The model to populate
 * @returns Promise that resolves when population is complete
 */
export async function populateTestModel(model: Model): Promise<void> {
  // Motivation layer
  await addTestElements(model, 'motivation', [
    { type: 'goal', id: 'motivation-goal-test-1', name: 'Test Goal 1' },
    { type: 'requirement', id: 'motivation-requirement-test-1', name: 'Test Requirement 1' },
  ]);

  // Business layer
  await addTestElements(model, 'business', [
    { type: 'process', id: 'business-process-test-1', name: 'Test Process 1' },
    { type: 'service', id: 'business-service-test-1', name: 'Test Service 1' },
  ]);

  // Application layer
  await addTestElements(model, 'application', [
    { type: 'component', id: 'application-component-test-1', name: 'Test Component 1' },
    { type: 'service', id: 'application-service-test-1', name: 'Test Service 1' },
  ]);

  // Technology layer
  await addTestElements(model, 'technology', [
    { type: 'infrastructure', id: 'technology-infrastructure-test-1', name: 'Test Infrastructure 1' },
    { type: 'platform', id: 'technology-platform-test-1', name: 'Test Platform 1' },
  ]);

  // API layer
  await addTestElements(model, 'api', [
    {
      type: 'endpoint',
      id: 'api-endpoint-test-1',
      name: 'Test Endpoint 1',
      properties: { method: 'GET', path: '/test' },
    },
  ]);

  // Data Model layer
  await addTestElements(model, 'data-model', [
    { type: 'entity', id: 'data-model-entity-test-1', name: 'Test Entity 1' },
  ]);

  // Save after all additions
  await model.save();
}
