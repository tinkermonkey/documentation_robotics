import type { Element as IElement, Reference, Relationship, SourceReference } from "../types/index.js";

/**
 * Type guard to check if a value is a SourceReference
 * Safely validates the structure of source reference data without unsafe assertions
 *
 * @param obj Unknown value to validate
 * @returns true if obj matches SourceReference structure
 */
function isSourceReference(obj: unknown): obj is SourceReference {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const entry = obj as Record<string, unknown>;
  return (
    typeof entry.type === 'string' &&
    Array.isArray(entry.locations)
  );
}

/**
 * Type guard to check if a value is a generic Record object
 * Used for safe property access without array false-positives
 *
 * @param obj Unknown value to validate
 * @returns true if obj is an object (not null, not array)
 */
function isRecord(obj: unknown): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Element class representing an individual architecture item
 *
 * Provides type-safe access to element properties with layer-aware handling
 * for source references (different storage patterns for different layer types)
 */
export class Element implements IElement {
  id: string;
  type: string;
  name: string;
  description?: string;
  properties: Record<string, unknown>;
  references: Reference[];
  relationships: Relationship[];
  layer?: string;  // Track which layer this element belongs to (Python CLI compatibility)
  filePath?: string;  // Track source file path for saving back (Python CLI compatibility)
  rawData?: any;  // Preserve raw YAML data to avoid losing unknown fields (Python CLI compatibility)

  constructor(data: {
    id: string;
    type: string;
    name: string;
    description?: string;
    properties?: Record<string, unknown>;
    references?: Reference[];
    relationships?: Relationship[];
    layer?: string;
    filePath?: string;
    rawData?: any;
  }) {
    this.id = data.id;
    this.type = data.type;
    this.name = data.name;
    this.description = data.description;
    this.properties = data.properties ?? {};
    this.references = data.references ?? [];
    this.relationships = data.relationships ?? [];
    this.layer = data.layer;
    this.filePath = data.filePath;
    this.rawData = data.rawData;
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
    const xSourceRef = this.getProperty<unknown>('x-source-reference');
    if (isSourceReference(xSourceRef)) {
      return xSourceRef;
    }

    // For layers 4-5, 9-12, source reference is at properties.source.reference
    const sourceObj = this.getProperty<unknown>('source');
    if (isRecord(sourceObj) && 'reference' in sourceObj) {
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
      delete this.properties['x-source-reference'];

      const sourceObj = this.properties['source'];
      if (isRecord(sourceObj)) {
        delete sourceObj.reference;
        if (Object.keys(sourceObj).length === 0) {
          delete this.properties['source'];
        }
      }
      return;
    }

    // Layer-aware storage: use layer-specific property paths
    if (!this.layer) {
      throw new Error('Cannot set source reference: element has no layer assigned');
    }

    const layerNum = parseInt(this.layer.split('-')[0], 10);

    // For layers 6-8 (API, Data Model, Data Store), use x-source-reference (OpenAPI pattern)
    if (layerNum >= 6 && layerNum <= 8) {
      this.properties['x-source-reference'] = sourceRef;
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
   * Serialize to JSON representation
   */
  toJSON(): IElement {
    const result: IElement = {
      id: this.id,
      type: this.type,
      name: this.name,
    };

    if (this.description) {
      result.description = this.description;
    }

    if (Object.keys(this.properties).length > 0) {
      result.properties = this.properties;
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
