import { Element } from "./element.js";
import { GraphModel } from "./graph-model.js";
import type { LayerData, Reference, Relationship } from "../types/index.js";

/**
 * Layer class - thin wrapper over graph model for backward compatibility
 * Queries the graph for elements in a specific layer
 */
export class Layer {
  name: string;
  graph: GraphModel;
  metadata?: { layer: string; version: string };
  private dirty: boolean = false;
  private cachedElements: Map<string, Element> | null = null;
  private cachedNodesVersion: number = 0;

  constructor(
    name: string,
    elementsOrGraph?: Element[] | GraphModel,
    elementsIfGraphPassed?: Element[]
  ) {
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
      // Also set layer_id to maintain consistency with layer name
      if (!element.layer_id || element.layer_id === "") {
        element.layer_id = this.name;
      }
      const node = GraphModel.fromElement(element);

      // Store references and relationships as node properties for preservation
      if (element.references && element.references.length > 0) {
        node.properties["__references__"] = element.references;
      }
      if (element.relationships && element.relationships.length > 0) {
        node.properties["__relationships__"] = element.relationships;
      }

      this.graph.addNode(node);
      // Don't mark as dirty during construction - elements added in constructor are initial state
    }
  }

  /**
   * Get all elements in this layer from the graph
   * Converts graph nodes back to Elements for backward compatibility
   * Results are cached and invalidated when the underlying graph changes
   */
  get elements(): Map<string, Element> {
    const currentVersion = this.graph.getNodesVersion();

    // Return cached result if graph hasn't changed
    if (this.cachedElements !== null && this.cachedNodesVersion === currentVersion) {
      return this.cachedElements;
    }

    // Rebuild cache
    const result = new Map<string, Element>();
    const nodes = this.graph.getNodesByLayer(this.name);

    for (const node of nodes) {
      const element = new Element({
        id: node.id,
        spec_node_id: node.spec_node_id,
        layer_id: node.layer_id,
        type: node.type,
        name: node.name,
        description: node.description,
        attributes: node.attributes,
        source_reference: node.source_reference,
        metadata: node.metadata,
        layer: node.layer,
        references: (node.properties["__references__"] ?? []) as Reference[],
        relationships: (node.properties["__relationships__"] ?? []) as Relationship[],
      });
      result.set(node.id, element);
    }

    this.cachedElements = result;
    this.cachedNodesVersion = currentVersion;
    return result;
  }

  /**
   * Add an element to the layer (stores in graph)
   */
  addElement(element: Element): void {
    // Ensure element has the correct layer
    element.layer = this.name;
    // Also set layer_id to maintain consistency with layer name
    if (!element.layer_id || element.layer_id === "") {
      element.layer_id = this.name;
    }
    const node = GraphModel.fromElement(element);

    // Store references and relationships as node properties for preservation
    if (element.references && element.references.length > 0) {
      node.properties["__references__"] = element.references;
    }
    if (element.relationships && element.relationships.length > 0) {
      node.properties["__relationships__"] = element.relationships;
    }

    // Add node to graph first
    this.graph.addNode(node);

    // Create graph edges from references for export compatibility
    // Only create edges if both source and destination nodes exist
    if (element.references && element.references.length > 0) {
      for (const ref of element.references) {
        if (this.graph.nodes.has(ref.source) && this.graph.nodes.has(ref.target)) {
          this.graph.addEdge({
            id: `${ref.source}-${ref.type}-${ref.target}`,
            source: ref.source,
            destination: ref.target,
            predicate: ref.type,
            properties: {},
          });
        }
      }
    }

    // Create graph edges from relationships for export compatibility
    // Only create edges if both source and destination nodes exist
    if (element.relationships && element.relationships.length > 0) {
      for (const rel of element.relationships) {
        if (this.graph.nodes.has(rel.source) && this.graph.nodes.has(rel.target)) {
          this.graph.addEdge({
            id: `${rel.source}-${rel.predicate}-${rel.target}`,
            source: rel.source,
            destination: rel.target,
            predicate: rel.predicate,
            properties: {},
          });
        }
      }
    }

    this.dirty = true;
  }

  /**
   * Get an element by ID from the graph.
   * Supports both UUID and semantic ID (layer.type.kebab-name or layer-type-kebab-name) lookup.
   *
   * @param id - UUID or semantic ID of the element to get
   * @returns The element if found, undefined if not found
   */
  getElement(id: string): Element | undefined {
    // First try direct UUID lookup (O(1))
    let node = this.graph.nodes.get(id);

    // If not found by UUID, try semantic ID (elementId) lookup
    // Semantic IDs have format:
    // 1. Dot-separated: {layer}.{type}.{kebab-name} (contains 2+ dots)
    // 2. Hyphen-separated legacy: {layer}-{type}-{kebab-name}
    if (!node) {
      const dotCount = (id.match(/\./g) || []).length;
      const isDotSeparated = dotCount >= 2;
      const isHyphenSeparated = id.includes("-") && id.startsWith(this.name) && id.length > this.name.length + 1;

      if (isDotSeparated || isHyphenSeparated) {
        // Try to find by semantic ID by searching all nodes
        for (const candidate of this.graph.nodes.values()) {
          if (candidate.layer === this.name) {
            // Build both formats and compare
            const kebabName = candidate.name
              .replace(/[\s_]+/g, "-")
              .replace(/([a-z])([A-Z])/g, "$1-$2")
              .toLowerCase()
              .replace(/-+/g, "-")
              .replace(/^-+|-+$/g, "");

            // Dot-separated semantic ID: layer.type.kebab-name
            const dotSemanticId = `${candidate.layer_id || this.name}.${candidate.type}.${kebabName}`;

            // Hyphen-separated legacy ID: layer-type-kebab-name
            const hyphenSemanticId = `${candidate.layer_id || this.name}-${candidate.type}-${kebabName}`;

            if (dotSemanticId === id || hyphenSemanticId === id) {
              node = candidate;
              break;
            }
          }
        }
      }
    }

    if (!node || node.layer !== this.name) {
      return undefined;
    }

    return new Element({
      id: node.id,
      spec_node_id: node.spec_node_id,
      layer_id: node.layer_id,
      type: node.type,
      name: node.name,
      description: node.description,
      attributes: node.attributes,
      source_reference: node.source_reference,
      metadata: node.metadata,
      layer: node.layer,
      references: (node.properties["__references__"] ?? []) as Reference[],
      relationships: (node.properties["__relationships__"] ?? []) as Relationship[],
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

    // Prepare properties including references and relationships
    // Start with existing node properties to preserve graph metadata fields like __references__ and __relationships__
    const properties = { ...node.properties };

    // Persist references and relationships as node properties
    if (element.references && element.references.length > 0) {
      properties["__references__"] = element.references;
    } else {
      delete properties["__references__"];
    }

    if (element.relationships && element.relationships.length > 0) {
      properties["__relationships__"] = element.relationships;
    } else {
      delete properties["__relationships__"];
    }

    // Convert element to graph node and update in place, including spec-node fields
    // so that source_reference and attributes changes aren't lost on the next save cycle
    const updated = this.graph.updateNode(element.id, {
      name: element.name,
      description: element.description,
      properties,
      spec_node_id: element.spec_node_id || undefined,
      layer_id: element.layer_id || undefined,
      attributes: element.attributes,
      source_reference: element.source_reference,
      metadata: element.metadata,
    });

    if (updated) {
      this.dirty = true;
    }
    return updated;
  }

  /**
   * Delete an element by ID from the graph
   *
   * @param id - UUID of the element to delete
   * @returns true if element was deleted, false if not found
   */
  deleteElement(id: string): boolean {
    const node = this.graph.nodes.get(id);

    if (!node || node.layer !== this.name) {
      return false;
    }

    const result = this.graph.removeNode(node.id);
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
    return nodes.map(
      (node) =>
        new Element({
          id: node.id,
          spec_node_id: node.spec_node_id,
          layer_id: node.layer_id,
          type: node.type,
          name: node.name,
          description: node.description,
          attributes: node.attributes,
          source_reference: node.source_reference,
          metadata: node.metadata,
          layer: node.layer,
          references: (node.properties["__references__"] ?? []) as Reference[],
          relationships: (node.properties["__relationships__"] ?? []) as Relationship[],
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
          spec_node_id: e.spec_node_id,
          layer_id: e.layer_id,
          type: e.type,
          name: e.name,
          description: e.description,
          attributes: e.attributes,
          source_reference: e.source_reference,
          metadata: e.metadata,
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
