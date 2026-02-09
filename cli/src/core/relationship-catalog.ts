/**
 * Relationship Catalog - Manages catalog of semantic relationship types
 *
 * This module provides access to the relationship catalog defined in
 * spec/schemas/relationship-catalog.json (v2.1.0+).
 *
 * Replaced the former link-registry.json system (removed in v0.8.0).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

export interface RelationshipSemantics {
  directionality: "unidirectional" | "bidirectional";
  transitivity: boolean;
  symmetry: boolean;
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
  applicableLayers: string[];
  examples: RelationshipExample[];
}

export interface CategoryInfo {
  name: string;
  description: string;
  color?: string;
}

export interface RelationshipCatalogData {
  $schema: string;
  title: string;
  description: string;
  version: string;
  generatedBy: string;
  lastUpdated: string;
  categories?: Record<string, CategoryInfo>;
  relationshipTypes: RelationshipType[];
}

/**
 * Relationship catalog providing access to semantic relationship type definitions
 */
export class RelationshipCatalog {
  private data: RelationshipCatalogData | null = null;
  private catalogPath: string;

  constructor(catalogPath?: string) {
    this.catalogPath = catalogPath || this.getDefaultCatalogPath();
  }

  /**
   * Get default path to relationship-catalog.json
   */
  private getDefaultCatalogPath(): string {
    // Get current file's directory (ES module compatible)
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    // Try bundled schemas first (installed/built mode)
    const bundledPath = path.join(currentDir, "../schemas/bundled/relationship-catalog.json");

    return bundledPath;
  }

  /**
   * Load the relationship catalog
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.catalogPath, "utf-8");
      this.data = JSON.parse(content);
    } catch (error) {
      // Try fallback path
      try {
        const fallbackPath = path.join(
          __dirname,
          "../../..",
          "spec/schemas/relationship-catalog.json"
        );
        const content = await fs.readFile(fallbackPath, "utf-8");
        this.data = JSON.parse(content);
        this.catalogPath = fallbackPath;
      } catch {
        throw new Error(
          `Failed to load relationship catalog from ${this.catalogPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Ensure catalog is loaded
   */
  private ensureLoaded(): void {
    if (!this.data) {
      throw new Error("Relationship catalog not loaded. Call load() first.");
    }
  }

  /**
   * Get all relationship types
   */
  getAllTypes(): RelationshipType[] {
    this.ensureLoaded();
    return this.data!.relationshipTypes;
  }

  /**
   * Get relationship type by ID
   */
  getTypeById(id: string): RelationshipType | undefined {
    this.ensureLoaded();
    return this.data!.relationshipTypes.find((t) => t.id === id);
  }

  /**
   * Get relationship type by predicate
   */
  getTypeByPredicate(predicate: string): RelationshipType | undefined {
    this.ensureLoaded();
    return this.data!.relationshipTypes.find(
      (t) => t.predicate === predicate || t.inversePredicate === predicate
    );
  }

  /**
   * Get relationship types by category
   */
  getTypesByCategory(category: string): RelationshipType[] {
    this.ensureLoaded();
    return this.data!.relationshipTypes.filter((t) => t.category === category);
  }

  /**
   * Get relationship types applicable to a layer
   */
  getTypesForLayer(layer: string): RelationshipType[] {
    this.ensureLoaded();
    // Normalize layer format (remove leading zeros if present)
    const normalizedLayer = layer.replace(/^0+/, "");

    return this.data!.relationshipTypes.filter((t) =>
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
    return this.data!.categories || {};
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
      version: this.data!.version,
      generatedBy: this.data!.generatedBy,
      lastUpdated: this.data!.lastUpdated,
      totalTypes: this.data!.relationshipTypes.length,
    };
  }

  /**
   * Search relationship types by keyword
   */
  search(keyword: string): RelationshipType[] {
    this.ensureLoaded();
    const lowerKeyword = keyword.toLowerCase();

    return this.data!.relationshipTypes.filter(
      (t) =>
        t.id.toLowerCase().includes(lowerKeyword) ||
        t.predicate.toLowerCase().includes(lowerKeyword) ||
        t.description.toLowerCase().includes(lowerKeyword) ||
        (t.inversePredicate && t.inversePredicate.toLowerCase().includes(lowerKeyword))
    );
  }

  /**
   * Validate if a predicate is valid
   */
  isValidPredicate(predicate: string): boolean {
    this.ensureLoaded();
    return this.data!.relationshipTypes.some(
      (t) => t.predicate === predicate || t.inversePredicate === predicate
    );
  }

  /**
   * Get suggested predicates for a layer
   */
  getSuggestedPredicates(layer: string): string[] {
    const types = this.getTypesForLayer(layer);
    const predicates = new Set<string>();

    for (const type of types) {
      predicates.add(type.predicate);
      if (type.inversePredicate) {
        predicates.add(type.inversePredicate);
      }
    }

    return Array.from(predicates).sort();
  }
}
