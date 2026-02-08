import { describe, test, expect, beforeEach } from 'bun:test';
import { GraphModel, type GraphNode, type GraphEdge } from '../../src/core/graph-model.js';

describe('GraphModel', () => {
  let graph: GraphModel;

  beforeEach(() => {
    graph = new GraphModel();
  });

  describe('Node Management', () => {
    test('addNode should add a node to the graph', () => {
      const node: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test Goal',
        properties: { key: 'value' },
      };

      graph.addNode(node);
      expect(graph.getNode('node-1')).toBeDefined();
      expect(graph.getNode('node-1')?.name).toBe('Test Goal');
    });

    test('addNode should update layer index', () => {
      const node: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test Goal',
        properties: {},
      };

      graph.addNode(node);
      const nodes = graph.getNodesByLayer('motivation');
      expect(nodes.length).toBe(1);
      expect(nodes[0].id).toBe('node-1');
    });

    test('addNode should update type index', () => {
      const node: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test Goal',
        properties: {},
      };

      graph.addNode(node);
      const nodes = graph.getNodesByType('goal');
      expect(nodes.length).toBe(1);
      expect(nodes[0].id).toBe('node-1');
    });

    test('addNode with same ID should overwrite and clean up old indices', () => {
      const node1: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Original',
        properties: {},
      };

      const node2: GraphNode = {
        id: 'node-1',
        layer: 'business',
        type: 'service',
        name: 'Updated',
        properties: {},
      };

      graph.addNode(node1);
      expect(graph.getNodesByLayer('motivation').length).toBe(1);
      expect(graph.getNodesByType('goal').length).toBe(1);

      graph.addNode(node2);

      // Should have updated the node
      expect(graph.getNode('node-1')?.name).toBe('Updated');

      // Old layer index should be cleaned up
      expect(graph.getNodesByLayer('motivation').length).toBe(0);

      // New layer should have the node
      expect(graph.getNodesByLayer('business').length).toBe(1);

      // Old type index should be cleaned up
      expect(graph.getNodesByType('goal').length).toBe(0);

      // New type should have the node
      expect(graph.getNodesByType('service').length).toBe(1);
    });

    test('removeNode should delete the node and clean up indices', () => {
      const node: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test Goal',
        properties: {},
      };

      graph.addNode(node);
      expect(graph.getNode('node-1')).toBeDefined();

      const result = graph.removeNode('node-1');
      expect(result).toBe(true);
      expect(graph.getNode('node-1')).toBeUndefined();
      expect(graph.getNodesByLayer('motivation').length).toBe(0);
      expect(graph.getNodesByType('goal').length).toBe(0);
    });

    test('updateNode should modify node properties', () => {
      const node: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Original',
        properties: {},
      };

      graph.addNode(node);

      const updated = graph.updateNode('node-1', {
        name: 'Updated Name',
        properties: { key: 'value' },
      });

      expect(updated).toBe(true);
      const current = graph.getNode('node-1');
      expect(current?.name).toBe('Updated Name');
      expect(current?.properties.key).toBe('value');
    });

    test('updateNode should handle layer changes and clean up old indices', () => {
      const node: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test',
        properties: {},
      };

      graph.addNode(node);
      expect(graph.getNodesByLayer('motivation').length).toBe(1);
      expect(graph.getNodesByLayer('business').length).toBe(0);

      graph.updateNode('node-1', { layer: 'business' });

      expect(graph.getNodesByLayer('motivation').length).toBe(0);
      expect(graph.getNodesByLayer('business').length).toBe(1);
      expect(graph.getNode('node-1')?.layer).toBe('business');
    });

    test('updateNode should handle type changes and clean up old indices', () => {
      const node: GraphNode = {
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test',
        properties: {},
      };

      graph.addNode(node);
      expect(graph.getNodesByType('goal').length).toBe(1);
      expect(graph.getNodesByType('requirement').length).toBe(0);

      graph.updateNode('node-1', { type: 'requirement' });

      expect(graph.getNodesByType('goal').length).toBe(0);
      expect(graph.getNodesByType('requirement').length).toBe(1);
      expect(graph.getNode('node-1')?.type).toBe('requirement');
    });

    test('getNodesByLayer should return empty array for non-existent layer', () => {
      const nodes = graph.getNodesByLayer('nonexistent');
      expect(nodes).toEqual([]);
    });

    test('getNodesByType should return empty array for non-existent type', () => {
      const nodes = graph.getNodesByType('nonexistent');
      expect(nodes).toEqual([]);
    });
  });

  describe('Edge Management', () => {
    beforeEach(() => {
      // Add test nodes
      graph.addNode({
        id: 'source-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Source',
        properties: {},
      });
      graph.addNode({
        id: 'dest-1',
        layer: 'business',
        type: 'service',
        name: 'Destination',
        properties: {},
      });
    });

    test('addEdge should add an edge when both nodes exist', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);
      expect(graph.getAllEdges().length).toBe(1);
      expect(graph.getAllEdges()[0].id).toBe('edge-1');
    });

    test('addEdge should throw error if source node does not exist', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'nonexistent',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      expect(() => graph.addEdge(edge)).toThrow('source node');
    });

    test('addEdge should throw error if destination node does not exist', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'nonexistent',
        predicate: 'references',
        properties: {},
      };

      expect(() => graph.addEdge(edge)).toThrow('destination node');
    });

    test('addEdge should update source index', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);
      const edges = graph.getEdgesFrom('source-1');
      expect(edges.length).toBe(1);
      expect(edges[0].id).toBe('edge-1');
    });

    test('addEdge should update destination index', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);
      const edges = graph.getEdgesTo('dest-1');
      expect(edges.length).toBe(1);
      expect(edges[0].id).toBe('edge-1');
    });

    test('addEdge should update predicate index', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);

      // Get edges filtered by predicate
      const allEdges = graph.getEdgesFrom('source-1', 'references');
      expect(allEdges.length).toBe(1);
    });

    test('removeEdge should delete the edge and clean up indices', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);
      expect(graph.getAllEdges().length).toBe(1);

      const result = graph.removeEdge('edge-1');
      expect(result).toBe(true);
      expect(graph.getAllEdges().length).toBe(0);
      expect(graph.getEdgesFrom('source-1').length).toBe(0);
      expect(graph.getEdgesTo('dest-1').length).toBe(0);
    });

    test('updateEdge should modify edge properties', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);

      const updated = graph.updateEdge('edge-1', {
        properties: { key: 'value' },
      });

      expect(updated).toBe(true);
      const current = graph.getAllEdges()[0];
      expect(current.properties?.key).toBe('value');
    });

    test('updateEdge should handle predicate changes', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);

      graph.updateEdge('edge-1', { predicate: 'extends' });

      const current = graph.getAllEdges()[0];
      expect(current.predicate).toBe('extends');
    });

    test('removeNode should also remove associated edges', () => {
      const edge: GraphEdge = {
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      };

      graph.addEdge(edge);
      expect(graph.getAllEdges().length).toBe(1);

      graph.removeNode('source-1');
      expect(graph.getAllEdges().length).toBe(0);
    });

    test('getEdgesFrom should return edges filtered by predicate', () => {
      graph.addEdge({
        id: 'edge-1',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'references',
        properties: {},
      });

      graph.addEdge({
        id: 'edge-2',
        source: 'source-1',
        destination: 'dest-1',
        predicate: 'extends',
        properties: {},
      });

      const references = graph.getEdgesFrom('source-1', 'references');
      const extends_ = graph.getEdgesFrom('source-1', 'extends');

      expect(references.length).toBe(1);
      expect(references[0].predicate).toBe('references');

      expect(extends_.length).toBe(1);
      expect(extends_[0].predicate).toBe('extends');
    });
  });

  describe('Query Methods', () => {
    test('getEdgesBetween should return edges between two specific nodes', () => {
      graph.addNode({
        id: 'a',
        layer: 'motivation',
        type: 'goal',
        name: 'A',
        properties: {},
      });
      graph.addNode({
        id: 'b',
        layer: 'business',
        type: 'service',
        name: 'B',
        properties: {},
      });

      graph.addEdge({
        id: 'edge-1',
        source: 'a',
        destination: 'b',
        predicate: 'references',
        properties: {},
      });

      const edges = graph.getEdgesBetween('a', 'b');
      expect(edges.length).toBe(1);
      expect(edges[0].source).toBe('a');
      expect(edges[0].destination).toBe('b');
    });

    test('traverse should perform BFS from a starting node', () => {
      // Create a chain: a -> b -> c
      graph.addNode({
        id: 'a',
        layer: 'motivation',
        type: 'goal',
        name: 'A',
        properties: {},
      });
      graph.addNode({
        id: 'b',
        layer: 'business',
        type: 'service',
        name: 'B',
        properties: {},
      });
      graph.addNode({
        id: 'c',
        layer: 'application',
        type: 'component',
        name: 'C',
        properties: {},
      });

      graph.addEdge({
        id: 'edge-1',
        source: 'a',
        destination: 'b',
        predicate: 'references',
        properties: {},
      });

      graph.addEdge({
        id: 'edge-2',
        source: 'b',
        destination: 'c',
        predicate: 'references',
        properties: {},
      });

      const visited = graph.traverse('a');
      expect(visited.length).toBeGreaterThan(0);
      expect(visited.some((n) => n.id === 'a')).toBe(true);
      expect(visited.some((n) => n.id === 'b')).toBe(true);
      expect(visited.some((n) => n.id === 'c')).toBe(true);
    });

    test('traverse with maxDepth should respect depth limit', () => {
      // Create a chain: a -> b -> c -> d
      ['a', 'b', 'c', 'd'].forEach((id) => {
        graph.addNode({
          id,
          layer: 'motivation',
          type: 'goal',
          name: id.toUpperCase(),
          properties: {},
        });
      });

      graph.addEdge({
        id: 'e1',
        source: 'a',
        destination: 'b',
        predicate: 'references',
      });
      graph.addEdge({
        id: 'e2',
        source: 'b',
        destination: 'c',
        predicate: 'references',
      });
      graph.addEdge({
        id: 'e3',
        source: 'c',
        destination: 'd',
        predicate: 'references',
      });

      const visited = graph.traverse('a', undefined, 1);
      expect(visited.length).toBeGreaterThan(0);
      expect(visited.some((n) => n.id === 'a')).toBe(true);
      expect(visited.some((n) => n.id === 'b')).toBe(true);
    });
  });

  describe('Version Tracking for Caching', () => {
    test('getNodesVersion should increment when node is added', () => {
      const version1 = graph.getNodesVersion();

      graph.addNode({
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test',
        properties: {},
      });

      const version2 = graph.getNodesVersion();
      expect(version2).toBeGreaterThan(version1);
    });

    test('getNodesVersion should increment when node is removed', () => {
      graph.addNode({
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test',
        properties: {},
      });

      const version1 = graph.getNodesVersion();
      graph.removeNode('node-1');
      const version2 = graph.getNodesVersion();

      expect(version2).toBeGreaterThan(version1);
    });

    test('getNodesVersion should increment when node is updated', () => {
      graph.addNode({
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test',
        properties: {},
      });

      const version1 = graph.getNodesVersion();
      graph.updateNode('node-1', { name: 'Updated' });
      const version2 = graph.getNodesVersion();

      expect(version2).toBeGreaterThan(version1);
    });
  });

  describe('Edge Cases', () => {
    test('getNode with non-existent ID should return undefined', () => {
      expect(graph.getNode('nonexistent')).toBeUndefined();
    });

    test('removeNode with non-existent ID should return false', () => {
      expect(graph.removeNode('nonexistent')).toBe(false);
    });

    test('updateNode with non-existent ID should return false', () => {
      expect(graph.updateNode('nonexistent', { name: 'test' })).toBe(false);
    });

    test('removeEdge with non-existent ID should return false', () => {
      expect(graph.removeEdge('nonexistent')).toBe(false);
    });

    test('updateEdge with non-existent ID should return false', () => {
      expect(graph.updateEdge('nonexistent', { predicate: 'test' })).toBe(false);
    });

    test('getEdgesFrom non-existent node should return empty array', () => {
      expect(graph.getEdgesFrom('nonexistent')).toEqual([]);
    });

    test('getEdgesTo non-existent node should return empty array', () => {
      expect(graph.getEdgesTo('nonexistent')).toEqual([]);
    });

    test('clear should remove all nodes and edges', () => {
      graph.addNode({
        id: 'node-1',
        layer: 'motivation',
        type: 'goal',
        name: 'Test',
        properties: {},
      });
      graph.addNode({
        id: 'node-2',
        layer: 'business',
        type: 'service',
        name: 'Test',
        properties: {},
      });

      expect(graph.getNodeCount()).toBe(2);

      graph.clear();
      expect(graph.getNodeCount()).toBe(0);
      expect(graph.getEdgeCount()).toBe(0);
    });
  });
});
