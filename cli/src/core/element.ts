import { randomUUID } from "crypto";

import type {
  Element as IElement,
  ElementMetadata,
  Reference,
  Relationship,
  SourceReference,
} from "../types/index.js";

/**
 * Type guard to check if a value is a SourceReference
 * Safely validates the structure of source reference data without unsafe assertions
 *
 * @param obj Unknown value to validate
 * @returns true if obj matches SourceReference structure
 */
function isSourceReference(obj: unknown): obj is SourceReference {
  if (!obj || typeof obj !== "object") {
    return false;
  }

  const entry = obj as Record<string, unknown>;
  return typeof entry.provenance === "string" && Array.isArray(entry.locations);
}

/**
 * Type guard to check if a value is a generic Record object
 * Used for safe property access without array false-positives
 *
 * @param obj Unknown value to validate
 * @returns true if obj is an object (not null, not array)
 */
function isRecord(obj: unknown): obj is Record<string, unknown> {
  return obj !== null && typeof obj === "object" && !Array.isArray(obj);
}

/**
 * Element class representing an individual architecture item
 *
 * Aligns with spec-node.schema.json structure for direct validation.
 * Provides type-safe access to element properties with layer-aware handling
 * for source references (different storage patterns for different layer types).
 *
 * Supports both new spec-aligned format and automatic migration from legacy format.
 */
export class Element implements IElement {
  // Spec-node aligned required fields
  id: string = "";
  spec_node_id: string = "";
  type: string = "";
  layer_id: string = "";
  name: string = "";

  // Spec-node aligned optional fields
  description?: string;
  attributes: Record<string, unknown> = {};
  source_reference?: SourceReference;
  metadata?: ElementMetadata;

  // Legacy fields for backward compatibility
  properties: Record<string, unknown> = {};
  elementId?: string;

  // Relationship tracking (unchanged)
  references: Reference[] = [];
  relationships: Relationship[] = [];

  // Internal tracking (unchanged)
  layer?: string;
  filePath?: string;
  rawData?: any;

  constructor(data: any) {
    // Detect if data is in legacy format and migrate if necessary
    if (this.isLegacyFormat(data)) {
      this.initializeFromLegacy(data);
    } else {
      this.initializeFromSpecNode(data);
    }
  }

  /**
   * Detect if data is in legacy format
   * Legacy format has either:
   * - elementId field (old semantic ID)
   * - id that looks like a semantic ID (contains dots)
   * - No spec_node_id field
   * - properties instead of attributes as the main property container
   */
  private isLegacyFormat(data: any): boolean {
    return (
      !data.spec_node_id &&
      (data.elementId || (data.id && typeof data.id === "string" && data.id.includes(".")))
    );
  }

  /**
   * Initialize Element from legacy format data
   * Automatically migrates to spec-node aligned structure
   */
  private initializeFromLegacy(data: any): void {
    // Generate UUID if not present or if it's a semantic ID
    const isSemanticId = data.id && typeof data.id === "string" && data.id.includes(".");
    this.id = !isSemanticId && this.isUUID(data.id) ? data.id : this.generateUUID();

    // Extract layer and type from semantic ID
    const semanticId = data.elementId || (isSemanticId ? data.id : null);
    if (semanticId) {
      const parts = semanticId.split(".");
      this.layer_id = parts[0];
      this.type = parts[1];
      this.elementId = semanticId;
    } else {
      // Fallback: use provided type and layer
      this.type = data.type || "";
      this.layer_id = data.layer || "";
      this.elementId = undefined;
    }

    this.spec_node_id = `${this.layer_id}.${this.type}`;

    // Core fields
    this.name = data.name;
    this.description = data.description;

    // Migrate properties to attributes
    this.attributes = data.properties || {};
    this.properties = data.properties || {};

    // Extract source reference if present in properties
    const sourceRef = this.extractSourceReferenceFromLegacy(data);
    if (sourceRef) {
      this.source_reference = sourceRef;
    }

    // Initialize metadata with migration timestamp
    this.metadata = {
      created_at: data.metadata?.created_at || new Date().toISOString(),
      updated_at: data.metadata?.updated_at || new Date().toISOString(),
      created_by: data.metadata?.created_by,
      version: data.metadata?.version || 1,
    };

    // Relationship tracking
    this.references = data.references || [];
    this.relationships = data.relationships || [];

    // Internal tracking
    this.layer = data.layer || this.layer_id;
    this.filePath = data.filePath;
    this.rawData = data.rawData;

    // Log deprecation warning
    console.warn(
      `Element initialized from legacy format: ${this.elementId || this.id}. ` +
        "Legacy format with flat properties will be removed in a future version. " +
        "Consider migrating to spec-node aligned format using 'dr migrate elements'."
    );
  }

  /**
   * Initialize Element from spec-node aligned format
   */
  private initializeFromSpecNode(data: IElement): void {
    this.id = data.id;
    this.spec_node_id = data.spec_node_id;
    this.type = data.type;
    this.layer_id = data.layer_id;
    this.name = data.name;
    this.description = data.description;
    this.attributes = data.attributes || {};
    this.source_reference = data.source_reference;
    this.metadata = data.metadata;

    // Initialize legacy fields for backward compatibility
    this.properties = data.properties || {};
    this.elementId = data.elementId;

    // Relationship tracking
    this.references = data.references || [];
    this.relationships = data.relationships || [];

    // Internal tracking
    this.layer = data.layer || data.layer_id;
    this.filePath = data.filePath;
    this.rawData = data.rawData;
  }

  /**
   * Extract source reference from legacy format properties
   * Handles both ArchiMate and OpenAPI patterns
   */
  private extractSourceReferenceFromLegacy(data: any): SourceReference | undefined {
    // Check for x-source-reference (OpenAPI pattern, layers 6-8)
    const xSourceRef = data.properties?.["x-source-reference"];
    if (xSourceRef && isSourceReference(xSourceRef)) {
      return xSourceRef;
    }

    // Check for properties.source.reference (ArchiMate pattern, layers 1-5, 9-12)
    const sourceObj = data.properties?.source;
    if (sourceObj && isRecord(sourceObj) && "reference" in sourceObj) {
      const ref = sourceObj.reference;
      if (isSourceReference(ref)) {
        return ref;
      }
    }

    return undefined;
  }

  /**
   * Check if a value is a valid UUIDv4
   */
  private isUUID(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
  }

  /**
   * Generate a cryptographically secure UUIDv4
   * Uses Node.js crypto.randomUUID() (available since Node.js 15.7.0)
   */
  private generateUUID(): string {
    // randomUUID() is available in Node.js 15.7.0+
    // It provides cryptographically secure random UUID generation
    // for production-grade unique identifiers
    return randomUUID();
  }

  /**
   * Convert Element to spec-node format for validation
   * Returns object that matches spec-node.schema.json structure
   */
  toSpecNode(): Record<string, unknown> {
    return {
      id: this.id,
      spec_node_id: this.spec_node_id,
      type: this.type,
      layer_id: this.layer_id,
      name: this.name,
      ...(this.description && { description: this.description }),
      ...(Object.keys(this.attributes).length > 0 && { attributes: this.attributes }),
      ...(this.source_reference && { source_reference: this.source_reference }),
      ...(this.metadata && { metadata: this.metadata }),
    };
  }

  /**
   * Create Element from spec-node format
   */
  static fromSpecNode(data: Record<string, unknown>): Element {
    return new Element({
      id: data.id as string,
      spec_node_id: data.spec_node_id as string,
      type: data.type as string,
      layer_id: data.layer_id as string,
      name: data.name as string,
      description: data.description as string | undefined,
      attributes: (data.attributes as Record<string, unknown>) || {},
      source_reference: data.source_reference as SourceReference | undefined,
      metadata: data.metadata as ElementMetadata | undefined,
    });
  }

  /**
   * Get a property by key with type inference
   */
  getProperty<T>(key: string): T | undefined {
    return this.properties[key] as T | undefined;
  }

  /**
   * Set a property by key
   */
  setProperty(key: string, value: unknown): void {
    this.properties[key] = value;
  }

  /**
   * Get array property with type safety
   */
  getArrayProperty<T>(key: string): T[] {
    const value = this.properties[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
    return [];
  }

  /**
   * Add item to array property
   */
  addToArrayProperty<T>(key: string, item: T): void {
    const current = this.getArrayProperty<T>(key);
    current.push(item);
    this.properties[key] = current;
  }

  /**
   * Get source reference from element
   *
   * Handles layer-specific property paths:
   * - Layers 6-8 (API, Data Model, Data Store): stored at x-source-reference (OpenAPI pattern)
   * - Layers 4-5, 9-12 (ArchiMate): stored at properties.source.reference (ArchiMate pattern)
   *
   * Uses type guards for safe property access without unsafe assertions.
   *
   * @returns The source reference if found, undefined otherwise
   */
  getSourceReference(): SourceReference | undefined {
    // For layers 6-8 (API, Data Model, Data Store), source reference is at x-source-reference
    const xSourceRef = this.getProperty<unknown>("x-source-reference");
    if (isSourceReference(xSourceRef)) {
      return xSourceRef;
    }

    // For layers 4-5, 9-12, source reference is at properties.source.reference
    const sourceObj = this.getProperty<unknown>("source");
    if (isRecord(sourceObj) && "reference" in sourceObj) {
      const ref = sourceObj.reference;
      if (isSourceReference(ref)) {
        return ref;
      }
    }

    return undefined;
  }

  /**
   * Set source reference on element
   *
   * Handles layer-specific property paths:
   * - Layers 06-08 (API, Data Model, Data Store): x-source-reference (OpenAPI pattern)
   * - Layers 01, 02, 04, 05, 09-12 (ArchiMate): properties.source.reference (ArchiMate pattern)
   *
   * Uses type guards and safe property narrowing to avoid unsafe assertions.
   *
   * @param sourceRef The source reference to set, or undefined to remove existing reference
   * @throws Error if element has no layer assigned (required for layer-aware storage)
   */
  setSourceReference(sourceRef: SourceReference | undefined): void {
    if (!sourceRef) {
      // Remove source reference from both possible locations
      delete this.properties["x-source-reference"];

      const sourceObj = this.properties["source"];
      if (isRecord(sourceObj)) {
        delete sourceObj.reference;
        if (Object.keys(sourceObj).length === 0) {
          delete this.properties["source"];
        }
      }
      return;
    }

    // Layer-aware storage: use layer-specific property paths
    if (!this.layer) {
      throw new Error("Cannot set source reference: element has no layer assigned");
    }

    const layerNum = parseInt(this.layer.split("-")[0], 10);

    // For layers 6-8 (API, Data Model, Data Store), use x-source-reference (OpenAPI pattern)
    if (layerNum >= 6 && layerNum <= 8) {
      this.properties["x-source-reference"] = sourceRef;
      return;
    }

    // For ArchiMate layers (01, 02, 04, 05, 09-12), use properties.source.reference (ArchiMate pattern)
    if (!this.properties.source) {
      this.properties.source = {};
    }

    const sourceObj = this.properties.source;
    if (isRecord(sourceObj)) {
      sourceObj.reference = sourceRef;
    }
  }

  /**
   * Check if element has a source reference
   */
  hasSourceReference(): boolean {
    return this.getSourceReference() !== undefined;
  }

  /**
   * Serialize to JSON representation (spec-node aligned format)
   */
  toJSON(): IElement {
    const result: IElement = {
      id: this.id,
      spec_node_id: this.spec_node_id,
      type: this.type,
      layer_id: this.layer_id,
      name: this.name,
    };

    if (this.description) {
      result.description = this.description;
    }

    if (Object.keys(this.attributes).length > 0) {
      result.attributes = this.attributes;
    }

    if (this.source_reference) {
      result.source_reference = this.source_reference;
    }

    if (this.metadata) {
      result.metadata = this.metadata;
    }

    // Include legacy fields for backward compatibility if present
    if (Object.keys(this.properties).length > 0) {
      result.properties = this.properties;
    }

    if (this.elementId) {
      result.elementId = this.elementId;
    }

    if (this.references.length > 0) {
      result.references = this.references;
    }

    if (this.relationships.length > 0) {
      result.relationships = this.relationships;
    }

    return result;
  }

  /**
   * String representation
   */
  toString(): string {
    return `Element(${this.id})`;
  }
}
