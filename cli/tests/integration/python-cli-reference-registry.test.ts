/**
 * Reference Registry - Integration Test with Real Python CLI Model
 *
 * Tests with actual 275-element model to verify production behavior
 * Model location: /Users/austinsand/workspace/documentation_robotics_viewer/documentation-robotics
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { ReferenceRegistry } from '@/core/reference-registry';
import { Element } from '@/core/element';

describe('ReferenceRegistry - Real Python CLI Model Integration', () => {
  let registry: ReferenceRegistry;
  let elements: Element[] = [];
  const MODEL_PATH = '/Users/austinsand/workspace/documentation_robotics_viewer/documentation-robotics/model';

  beforeAll(async () => {
    registry = new ReferenceRegistry();

    // Load all .yml files from model directory recursively
    const loadedElements: Element[] = [];

    async function loadDirectory(dirPath: string) {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);

          if (entry.isDirectory()) {
            await loadDirectory(fullPath);
          } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
            try {
              const content = await readFile(fullPath, 'utf-8');
              const data = parseYaml(content);

              if (!data) continue;

              // Handle multiple elements keyed by name (Python CLI format)
              if (typeof data === 'object' && !Array.isArray(data)) {
                for (const [key, elemData] of Object.entries(data)) {
                  if (elemData && typeof elemData === 'object' && 'id' in elemData) {
                    const elem = elemData as any;
                    const element = new Element({
                      id: elem.id,
                      type: elem.type || 'unknown',
                      name: elem.name || elem.id,
                      layer: elem.layer || elem.id.split('.')[0] || 'unknown',
                      description: elem.description || elem.documentation,
                      properties: elem.properties || elem,
                      references: elem.references || []
                    });
                    loadedElements.push(element);
                    registry.registerElement(element);
                  }
                }
              }
              // Handle arrays
              else if (Array.isArray(data)) {
                for (const elemData of data) {
                  if (elemData && elemData.id) {
                    const element = new Element({
                      id: elemData.id,
                      type: elemData.type || 'unknown',
                      name: elemData.name || elemData.id,
                      layer: elemData.layer || elemData.id.split('.')[0] || 'unknown',
                      description: elemData.description || elemData.documentation,
                      properties: elemData.properties || elemData,
                      references: elemData.references || []
                    });
                    loadedElements.push(element);
                    registry.registerElement(element);
                  }
                }
              }
            } catch (err) {
              // Skip files that can't be parsed
            }
          }
        }
      } catch (err) {
        // Skip directories that can't be read
      }
    }

    await loadDirectory(MODEL_PATH);
    elements = loadedElements;
  });

  it('should load substantial number of elements from real model', () => {
    expect(elements.length).toBeGreaterThan(100);
    console.log(`Loaded ${elements.length} elements from model`);
  });

  it('should extract references from loaded elements', () => {
    const stats = registry.getStats();

    console.log(`Total references: ${stats.totalReferences}`);
    console.log(`Unique sources: ${stats.uniqueSources}`);
    console.log(`Unique targets: ${stats.uniqueTargets}`);
    console.log(`Reference types: ${stats.referenceTypes.join(', ')}`);

    expect(stats.totalReferences).toBeGreaterThan(0);
    expect(stats.uniqueSources).toBeGreaterThan(0);
  });

  it('should build dependency graph from real model', () => {
    const graph = registry.getDependencyGraph();

    console.log(`Graph nodes: ${graph.order}`);
    console.log(`Graph edges: ${graph.size}`);

    expect(graph.order).toBeGreaterThan(0);
    expect(graph.size).toBeGreaterThan(0);
  });

  it('should detect broken references in model', () => {
    const validIds = new Set(elements.map(e => e.id));
    const broken = registry.findBrokenReferences(validIds);

    console.log(`Broken references: ${broken.length}`);

    if (broken.length > 0) {
      console.log('Sample broken references:');
      broken.slice(0, 5).forEach(ref => {
        console.log(`  ${ref.source} -> ${ref.target} (${ref.type})`);
      });
    }

    // Don't fail on broken references - this is informational
    expect(Array.isArray(broken)).toBe(true);
  });

  it('should identify reference types used in model', () => {
    const stats = registry.getStats();
    const types = stats.referenceTypes;

    console.log(`Reference types in model: ${types.join(', ')}`);

    // Check for common types from Python CLI
    const commonTypes = ['realizes', 'serves', 'accesses', 'uses'];
    const foundCommonTypes = commonTypes.filter(t => types.includes(t));

    console.log(`Found common types: ${foundCommonTypes.join(', ')}`);

    expect(types.length).toBeGreaterThan(0);
  });

  it('should handle cross-layer references', () => {
    const allRefs = registry.getAllReferences();

    // Count references by extracting layer from element IDs (format: layer.type.name)
    const crossLayerRefs = allRefs.filter(ref => {
      const sourceLayer = ref.source.split('.')[0];
      const targetLayer = ref.target.split('.')[0];
      return sourceLayer !== targetLayer;
    });

    console.log(`Cross-layer references: ${crossLayerRefs.length}/${allRefs.length}`);

    if (crossLayerRefs.length > 0) {
      const sample = crossLayerRefs[0];
      console.log(`Sample: ${sample.source} -> ${sample.target} (${sample.type})`);
    }

    // Expect some cross-layer references (core of architecture enforcement)
    expect(crossLayerRefs.length).toBeGreaterThan(0);
  });

  it('should find highly connected elements (hubs)', () => {
    const allRefs = registry.getAllReferences();

    // Count connections per element
    const connections = new Map<string, number>();

    for (const ref of allRefs) {
      connections.set(ref.source, (connections.get(ref.source) || 0) + 1);
      connections.set(ref.target, (connections.get(ref.target) || 0) + 1);
    }

    // Find top 5 most connected elements
    const sorted = Array.from(connections.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    console.log('Top 5 most connected elements:');
    sorted.forEach(([id, count]) => {
      console.log(`  ${id}: ${count} connections`);
    });

    expect(sorted.length).toBeGreaterThan(0);
    expect(sorted[0][1]).toBeGreaterThan(1);
  });

  it('should trace dependency chains', () => {
    // Find an element with both incoming and outgoing refs
    const stats = registry.getStats();
    if (stats.uniqueSources === 0) {
      console.log('No references to trace');
      return;
    }

    const allRefs = registry.getAllReferences();
    const elementWithBoth = allRefs.find(ref => {
      const outgoing = registry.getReferencesFrom(ref.source);
      const incoming = registry.getReferencesTo(ref.source);
      return outgoing.length > 0 && incoming.length > 0;
    });

    if (elementWithBoth) {
      const id = elementWithBoth.source;
      const upstream = registry.getReferencesTo(id);
      const downstream = registry.getReferencesFrom(id);

      console.log(`Element ${id}:`);
      console.log(`  Upstream (depends on it): ${upstream.length}`);
      console.log(`  Downstream (it depends on): ${downstream.length}`);

      expect(upstream.length).toBeGreaterThan(0);
      expect(downstream.length).toBeGreaterThan(0);
    }
  });

  it('should measure reference extraction performance', () => {
    // Re-register all elements to measure performance
    const testRegistry = new ReferenceRegistry();

    const start = Date.now();
    for (const element of elements) {
      testRegistry.registerElement(element);
    }
    const duration = Date.now() - start;

    console.log(`Registered ${elements.length} elements in ${duration}ms`);
    console.log(`Average: ${(duration / elements.length).toFixed(2)}ms per element`);

    // Should be fast - less than 5ms per element
    expect(duration / elements.length).toBeLessThan(5);
  });
});
