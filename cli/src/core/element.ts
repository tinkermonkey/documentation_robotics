import type { Element as IElement, Reference, Relationship, SourceReference } from "../types/index.js";

/**
 * Element class representing an individual architecture item
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
   * Get source reference for this element (layer-aware)
   * - Layers 06-08 (OpenAPI): reads from properties['x-source-reference']
   * - Other layers (ArchiMate): reads from properties.source?.reference
   */
  getSourceReference(): SourceReference | undefined {
    if (!this.layer) {
      return undefined;
    }

    const layerNum = parseInt(this.layer.split('-')[0], 10);

    // OpenAPI pattern for layers 06-08
    if (layerNum >= 6 && layerNum <= 8) {
      return this.properties['x-source-reference'] as SourceReference | undefined;
    }

    // ArchiMate pattern for other layers
    const source = this.properties.source as { reference?: SourceReference } | undefined;
    return source?.reference;
  }

  /**
   * Set source reference for this element (layer-aware)
   */
  setSourceReference(reference: SourceReference): void {
    if (!this.layer) {
      throw new Error('Cannot set source reference: element has no layer assigned');
    }

    const layerNum = parseInt(this.layer.split('-')[0], 10);

    // OpenAPI pattern for layers 06-08
    if (layerNum >= 6 && layerNum <= 8) {
      this.properties['x-source-reference'] = reference;
    } else {
      // ArchiMate pattern for other layers
      if (!this.properties.source) {
        this.properties.source = {};
      }
      (this.properties.source as { reference: SourceReference }).reference = reference;
    }
  }

  /**
   * Check if element has source reference
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
