import { Element } from "./element.js";
import type { LayerData } from "../types/index.js";

/**
 * Layer class representing a container for elements within a layer
 */
export class Layer {
  name: string;
  elements: Map<string, Element>;
  metadata?: { layer: string; version: string };
  private dirty: boolean = false;

  constructor(name: string, elements: Element[] = []) {
    this.name = name;
    this.elements = new Map(elements.map((e) => [e.id, e]));
  }

  /**
   * Add an element to the layer
   */
  addElement(element: Element): void {
    this.elements.set(element.id, element);
    this.dirty = true;
  }

  /**
   * Get an element by ID
   */
  getElement(id: string): Element | undefined {
    return this.elements.get(id);
  }

  /**
   * Delete an element by ID
   */
  deleteElement(id: string): boolean {
    const result = this.elements.delete(id);
    if (result) {
      this.dirty = true;
    }
    return result;
  }

  /**
   * List all elements in the layer
   */
  listElements(): Element[] {
    return Array.from(this.elements.values());
  }

  /**
   * Check if layer has unsaved changes
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Mark layer as clean (no unsaved changes)
   */
  markClean(): void {
    this.dirty = false;
  }

  /**
   * Serialize to JSON representation
   */
  toJSON(): LayerData {
    const result: LayerData = {
      elements: Array.from(this.elements.values()).map((e) => e.toJSON()),
    };

    if (this.metadata) {
      result.metadata = this.metadata;
    }

    return result;
  }

  /**
   * Create Layer from JSON data
   */
  static fromJSON(name: string, data: LayerData): Layer {
    const elements = data.elements.map(
      (e) =>
        new Element({
          id: e.id,
          type: e.type,
          name: e.name,
          description: e.description,
          properties: e.properties,
          references: e.references,
          relationships: e.relationships,
        })
    );
    const layer = new Layer(name, elements);
    layer.metadata = data.metadata;
    return layer;
  }
}
