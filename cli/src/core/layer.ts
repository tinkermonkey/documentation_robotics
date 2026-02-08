import { Element } from "./element.js";
import { GraphModel } from "./graph-model.js";
import type { LayerData } from "../types/index.js";

/**
 * Layer class - thin wrapper over graph model for backward compatibility
 * Queries the graph for elements in a specific layer
 */
export class Layer {
  name: string;
  graph: GraphModel;
  metadata?: { layer: string; version: string };
  private dirty: boolean = false;

  constructor(name: string, elementsOrGraph?: Element[] | GraphModel, elementsIfGraphPassed?: Element[]) {
    this.name = name;

    // Handle overloaded constructor:
    // new Layer(name) - create with empty graph
    // new Layer(name, elements) - create with elements array
    // new Layer(name, graph) - create with provided graph
    // new Layer(name, undefined, elements) - create with elements
    // new Layer(name, graph, elements) - create with provided graph and elements
    let actualGraph: GraphModel | undefined;
    let elementsToAdd: Element[] = [];

    if (elementsOrGraph instanceof GraphModel) {
      // Called with graph as second parameter
      actualGraph = elementsOrGraph;
      // Elements are in the third parameter if provided
      if (Array.isArray(elementsIfGraphPassed)) {
        elementsToAdd = elementsIfGraphPassed;
      }
    } else if (Array.isArray(elementsOrGraph)) {
      // Called with elements as second parameter
      elementsToAdd = elementsOrGraph;
    } else if (elementsOrGraph === undefined && Array.isArray(elementsIfGraphPassed)) {
      // Called with undefined graph and elements in third parameter
      elementsToAdd = elementsIfGraphPassed;
    }

    // Use provided graph or create a new one
    this.graph = actualGraph || new GraphModel();

    // Add elements to the graph (without marking as dirty during construction)
    for (const element of elementsToAdd) {
      // Ensure element has the correct layer
      element.layer = this.name;
      const node = GraphModel.fromElement(element);

      // Store references and relationships as node properties for preservation
      if (element.references && element.references.length > 0) {
        node.properties['__references__'] = element.references;
      }
      if (element.relationships && element.relationships.length > 0) {
        node.properties['__relationships__'] = element.relationships;
      }

      this.graph.addNode(node);
      // Don't mark as dirty during construction - elements added in constructor are initial state
    }
  }

  /**
   * Get all elements in this layer from the graph
   * Converts graph nodes back to Elements for backward compatibility
   */
  get elements(): Map<string, Element> {
    const result = new Map<string, Element>();
    const nodes = this.graph.getNodesByLayer(this.name);

    for (const node of nodes) {
      const element = new Element({
        id: node.id,
        type: node.type,
        name: node.name,
        description: node.description,
        properties: node.properties,
        layer: node.layer,
        references: (node.properties['__references__'] ?? []) as any,
        relationships: (node.properties['__relationships__'] ?? []) as any,
      });
      result.set(node.id, element);
    }

    return result;
  }

  /**
   * Add an element to the layer (stores in graph)
   */
  addElement(element: Element): void {
    // Ensure element has the correct layer
    element.layer = this.name;
    const node = GraphModel.fromElement(element);

    // Store references and relationships as node properties for preservation
    if (element.references && element.references.length > 0) {
      node.properties['__references__'] = element.references;
    }
    if (element.relationships && element.relationships.length > 0) {
      node.properties['__relationships__'] = element.relationships;
    }

    this.graph.addNode(node);
    this.dirty = true;
  }

  /**
   * Get an element by ID from the graph
   */
  getElement(id: string): Element | undefined {
    const node = this.graph.nodes.get(id);
    if (!node || node.layer !== this.name) {
      return undefined;
    }

    return new Element({
      id: node.id,
      type: node.type,
      name: node.name,
      description: node.description,
      properties: node.properties,
      layer: node.layer,
      references: (node.properties['__references__'] ?? []) as any,
      relationships: (node.properties['__relationships__'] ?? []) as any,
    });
  }

  /**
   * Update an element in the graph
   */
  updateElement(element: Element): boolean {
    const node = this.graph.nodes.get(element.id);
    if (!node || node.layer !== this.name) {
      return false;
    }

    // Convert element to graph node and update in place
    const updated = this.graph.updateNode(element.id, {
      name: element.name,
      description: element.description,
      properties: element.properties,
    });

    if (updated) {
      this.dirty = true;
    }
    return updated;
  }

  /**
   * Delete an element by ID from the graph
   */
  deleteElement(id: string): boolean {
    const node = this.graph.nodes.get(id);
    if (!node || node.layer !== this.name) {
      return false;
    }

    const result = this.graph.removeNode(id);
    if (result) {
      this.dirty = true;
    }
    return result;
  }

  /**
   * List all elements in the layer from the graph
   */
  listElements(): Element[] {
    const nodes = this.graph.getNodesByLayer(this.name);
    return nodes.map((node) =>
      new Element({
        id: node.id,
        type: node.type,
        name: node.name,
        description: node.description,
        properties: node.properties,
        layer: node.layer,
        references: (node.properties['__references__'] ?? []) as any,
        relationships: (node.properties['__relationships__'] ?? []) as any,
      })
    );
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
      elements: this.listElements().map((e) => e.toJSON()),
    };

    if (this.metadata) {
      result.metadata = this.metadata;
    }

    return result;
  }

  /**
   * Create Layer from JSON data
   */
  static fromJSON(name: string, data: LayerData, graph?: GraphModel): Layer {
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
          layer: name,
        })
    );
    const layer = new Layer(name, graph, elements);
    layer.metadata = data.metadata;
    return layer;
  }
}
