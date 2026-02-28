/**
 * Relationship Catalog - Manages catalog of semantic relationship types
 *
 * Loads predicates from spec/schemas/base/predicates.json and computes
 * derived metadata (applicableLayers) by scanning relationship schemas.
 */

import path from "node:path";
import { fileURLToPath } from "url";
import fs from "node:fs/promises";
import { glob } from "glob";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Directionality of a relationship
 */
export type Directionality = "unidirectional" | "bidirectional";

export interface RelationshipSemantics {
  directionality: Directionality;
  transitivity: boolean;
  symmetry: boolean;
  reflexivity?: boolean;
}

export interface RelationshipExample {
  source: string;
  target: string;
  description: string;
  layer?: string;
}

export interface RelationshipType {
  id: string;
  predicate: string;
  inversePredicate: string | null;
  category: string;
  archimateAlignment: string | null;
  description: string;
  semantics: RelationshipSemantics;
  applicableLayers: string[];  // Computed from relationship schemas
  examples: RelationshipExample[];  // Empty for now
}

export interface PredicateDefinition {
  predicate: string;
  inverse: string;
  category: string;
  description: string;
  archimate_alignment: string | null;
  semantics: RelationshipSemantics;
}

export interface PredicatesData {
  predicates: Record<string, PredicateDefinition>;
}

export interface CategoryInfo {
  name: string;
  description: string;
  color?: string;
}

/**
 * Relationship catalog providing access to semantic relationship type definitions
 */
export class RelationshipCatalog {
  private predicatesData: PredicatesData | null = null;
  private relationshipTypes: RelationshipType[] | null = null;
  private predicatesPath: string;
  private relationshipSchemasPath: string;

  constructor(predicatesPath?: string, relationshipSchemasPath?: string) {
    this.predicatesPath = predicatesPath || this.getDefaultPredicatesPath();
    this.relationshipSchemasPath = relationshipSchemasPath || this.getDefaultRelationshipSchemasPath();
  }

  /**
   * Get default path to base.json (contains predicates under .predicates key)
   */
  private getDefaultPredicatesPath(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return path.join(currentDir, "../schemas/bundled/base.json");
  }

  /**
   * Get default path to bundled schemas directory (contains manifest.json + per-layer JSON files)
   */
  private getDefaultRelationshipSchemasPath(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return path.join(currentDir, "../schemas/bundled");
  }

  /**
   * Load predicates and compute derived metadata
   */
  async load(): Promise<void> {
    // Load predicates — supports both base.json format (has .predicates key) and direct predicates.json
    try {
      const content = await fs.readFile(this.predicatesPath, "utf-8");
      const parsed = JSON.parse(content);
      // base.json has { specVersion, schemas, predicates } — extract .predicates key
      // predicates.json has { predicates } directly
      // In both cases, .predicates is the dict of PredicateDefinition objects
      this.predicatesData = parsed.predicates !== undefined
        ? { predicates: parsed.predicates }
        : parsed;
    } catch (error) {
      // Try fallback path (direct predicates.json in spec source tree)
      try {
        const fallbackPath = path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../spec/schemas/base/predicates.json"
        );
        const content = await fs.readFile(fallbackPath, "utf-8");
        this.predicatesData = JSON.parse(content);
        this.predicatesPath = fallbackPath;
        console.debug(`Loaded predicates from fallback path: ${fallbackPath}`);
      } catch {
        throw new Error(
          `Failed to load predicates from ${this.predicatesPath}: ${getErrorMessage(error)}`
        );
      }
    }

    // Compute applicableLayers by scanning relationship schemas
    const applicableLayersByPredicate = await this.computeApplicableLayers();

    // Convert predicates to RelationshipType format
    this.relationshipTypes = Object.entries(this.predicatesData!.predicates).map(([key, pred]) => ({
      id: key,
      predicate: pred.predicate,
      inversePredicate: pred.inverse,
      category: pred.category,
      archimateAlignment: pred.archimate_alignment,
      description: pred.description,
      semantics: pred.semantics,
      applicableLayers: applicableLayersByPredicate[pred.predicate] || [],
      examples: [],  // Examples are documentation, not stored in predicates
    }));
  }

  /**
   * Compute which layers each predicate is used in by reading compiled layer dist files
   */
  private async computeApplicableLayers(): Promise<Record<string, string[]>> {
    const layersByPredicate: Record<string, Set<string>> = {};

    try {
      // Try compiled bundled format (manifest.json + per-layer JSON files)
      const manifestPath = path.join(this.relationshipSchemasPath, "manifest.json");
      await fs.access(manifestPath);

      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent) as { layers: Array<{ id: string }> };

      for (const { id: layerId } of manifest.layers) {
        const layerPath = path.join(this.relationshipSchemasPath, `${layerId}.json`);
        try {
          await fs.access(layerPath);
          const layerContent = await fs.readFile(layerPath, "utf-8");
          const layerData = JSON.parse(layerContent) as {
            relationshipSchemas: Record<string, { predicate: string; source_layer: string }>;
          };

          for (const relSchema of Object.values(layerData.relationshipSchemas || {})) {
            const { predicate, source_layer } = relSchema;
            if (predicate && source_layer) {
              if (!layersByPredicate[predicate]) {
                layersByPredicate[predicate] = new Set();
              }
              layersByPredicate[predicate].add(source_layer);
            }
          }
        } catch {
          // Skip missing or malformed layer files
        }
      }
    } catch {
      // Fall back to spec source tree (development environment)
      const fallbackPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../spec/schemas/relationships"
      );
      try {
        await fs.access(fallbackPath);
        const relationshipFiles = await glob(`${fallbackPath}/**/*.relationship.schema.json`);

        for (const file of relationshipFiles) {
          try {
            const content = await fs.readFile(file, "utf-8");
            const schema = JSON.parse(content);
            const predicate = schema.properties?.predicate?.const;
            const sourceLayer = schema.properties?.source_layer?.const;

            if (predicate && sourceLayer) {
              if (!layersByPredicate[predicate]) {
                layersByPredicate[predicate] = new Set();
              }
              layersByPredicate[predicate].add(sourceLayer);
            }
          } catch {
            continue;
          }
        }
      } catch {
        // No relationship schemas found, return empty
        return {};
      }
    }

    // Convert Sets to sorted arrays
    const result: Record<string, string[]> = {};
    for (const [predicate, layers] of Object.entries(layersByPredicate)) {
      result[predicate] = Array.from(layers).sort();
    }

    return result;
  }

  /**
   * Ensure catalog is loaded
   */
  private ensureLoaded(): void {
    if (!this.relationshipTypes) {
      throw new Error("Relationship catalog not loaded. Call load() first.");
    }
  }

  /**
   * Get all relationship types
   */
  getAllTypes(): RelationshipType[] {
    this.ensureLoaded();
    return this.relationshipTypes!;
  }

  /**
   * Get relationship type by ID
   */
  getTypeById(id: string): RelationshipType | undefined {
    this.ensureLoaded();
    return this.relationshipTypes!.find((t) => t.id === id);
  }

  /**
   * Get relationship type by predicate
   */
  getTypeByPredicate(predicate: string): RelationshipType | undefined {
    this.ensureLoaded();
    return this.relationshipTypes!.find(
      (t) => t.predicate === predicate || t.inversePredicate === predicate
    );
  }

  /**
   * Get relationship types by category
   */
  getTypesByCategory(category: string): RelationshipType[] {
    this.ensureLoaded();
    return this.relationshipTypes!.filter((t) => t.category === category);
  }

  /**
   * Get relationship types applicable to a layer
   */
  getTypesForLayer(layer: string): RelationshipType[] {
    this.ensureLoaded();
    // Normalize layer format (remove leading zeros if present)
    const normalizedLayer = layer.replace(/^0+/, "");

    return this.relationshipTypes!.filter((t) =>
      t.applicableLayers.some(
        (l) => l === layer || l === normalizedLayer || l.replace(/^0+/, "") === normalizedLayer
      )
    );
  }

  /**
   * Get all categories
   */
  getCategories(): Record<string, CategoryInfo> {
    this.ensureLoaded();

    // Derive categories from relationship types
    const categories: Record<string, CategoryInfo> = {};
    const categoryCounts: Record<string, number> = {};

    for (const type of this.relationshipTypes!) {
      if (!categoryCounts[type.category]) {
        categoryCounts[type.category] = 0;
        categories[type.category] = {
          name: type.category.charAt(0).toUpperCase() + type.category.slice(1),
          description: `${type.category} relationships`,
        };
      }
      categoryCounts[type.category]++;
    }

    return categories;
  }

  /**
   * Get statistics about the catalog
   */
  getStats(): {
    totalTypes: number;
    categoryCounts: Record<string, number>;
    archimateAligned: number;
  } {
    this.ensureLoaded();

    const categoryCounts: Record<string, number> = {};
    let archimateAligned = 0;

    for (const type of this.relationshipTypes!) {
      categoryCounts[type.category] = (categoryCounts[type.category] || 0) + 1;
      if (type.archimateAlignment) {
        archimateAligned++;
      }
    }

    return {
      totalTypes: this.relationshipTypes!.length,
      categoryCounts,
      archimateAligned,
    };
  }

  /**
   * Get catalog metadata
   */
  getMetadata(): {
    version: string;
    generatedBy: string;
    lastUpdated: string;
    totalTypes: number;
  } {
    this.ensureLoaded();
    return {
      version: "1.0.0",
      generatedBy: "relationship-catalog (predicates.json)",
      lastUpdated: new Date().toISOString(),
      totalTypes: this.relationshipTypes!.length,
    };
  }

  /**
   * Search relationship types by keyword
   */
  search(keyword: string): RelationshipType[] {
    this.ensureLoaded();
    const lowerKeyword = keyword.toLowerCase();

    return this.relationshipTypes!.filter(
      (t) =>
        t.id.toLowerCase().includes(lowerKeyword) ||
        t.predicate.toLowerCase().includes(lowerKeyword) ||
        (t.inversePredicate && t.inversePredicate.toLowerCase().includes(lowerKeyword)) ||
        t.description.toLowerCase().includes(lowerKeyword) ||
        t.category.toLowerCase().includes(lowerKeyword)
    );
  }
}
