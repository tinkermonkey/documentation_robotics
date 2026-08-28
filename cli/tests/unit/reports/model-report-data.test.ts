import { describe, it, expect } from 'bun:test';
import { ModelReportDataCollector } from '@/reports/model-report-data';
import { Model } from '@/core/model';
import { Element } from '@/core/element';
import { Relationships } from '@/core/relationships';
import { Manifest } from '@/core/manifest';
import { GraphModel } from '@/core/graph-model';
import type { Relationship } from '@/core/relationships';

describe('ModelReportDataCollector', () => {
  const createMockModel = (
    elements: Map<string, Element> = new Map(),
    relationships: Relationship[] = []
  ): Model => {
    const manifest = new Manifest({
      name: 'test-model',
      version: '1.0.0',
      description: 'Test model',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    const model = new Model('/test/path', manifest);

    // Add elements to the graph
    for (const [, element] of elements) {
      const node = {
        id: element.path || element.id,
        uuid: element.id,
        layer: element.layer || element.layer_id,
        type: element.type,
        name: element.name,
        description: element.description,
        spec_node_id: element.spec_node_id,
        layer_id: element.layer_id,
        attributes: element.attributes,
        source_reference: element.source_reference,
        metadata: element.metadata,
        properties: {
          '__references__': element.references || [],
          '__relationships__': element.relationships || [],
        },
      };
      model.graph.addNode(node);
    }

    // Bypass normal model loading path for unit testing - we're directly setting relationships
    // to test the collector in isolation without requiring full model initialization
    model.relationships = new Relationships(relationships);

    return model;
  };

  it('should handle empty layer', () => {
    const model = createMockModel(new Map());
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'api');

    expect(data.layerName).toBe('api');
    expect(data.layerNumber).toBe(7);
    expect(data.elements).toEqual([]);
    expect(data.intraRelationships).toEqual([]);
    expect(data.interRelationships).toEqual([]);
    expect(data.upstreamLayers).toEqual([]);
    expect(data.downstreamLayers).toEqual([]);
    expect(data.statistics.elementCount).toBe(0);
    expect(data.statistics.intraRelationshipCount).toBe(0);
    expect(data.statistics.interRelationshipCount).toBe(0);
    expect(data.statistics.inboundRelationshipCount).toBe(0);
    expect(data.statistics.outboundRelationshipCount).toBe(0);
  });

  it('should correctly return layer number from getLayerOrder', () => {
    const model = createMockModel();
    const collector = new ModelReportDataCollector();

    const motivationData = collector.collectLayerData(model, 'motivation');
    expect(motivationData.layerNumber).toBe(1);

    const dataModelData = collector.collectLayerData(model, 'data-model');
    expect(dataModelData.layerNumber).toBe(8);

    const testingData = collector.collectLayerData(model, 'testing');
    expect(testingData.layerNumber).toBe(13);
  });

  it('should return correct element list with deterministic sorting', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.c', new Element({
      id: 'uuid-c',
      path: 'api.endpoint.c',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'C Endpoint',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.a', new Element({
      id: 'uuid-a',
      path: 'api.endpoint.a',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'A Endpoint',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.b', new Element({
      id: 'uuid-b',
      path: 'api.endpoint.b',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'B Endpoint',
      layer_id: 'api',
    }));

    const model = createMockModel(elements);
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'api');

    expect(data.elements.length).toBe(3);
    expect(data.elements[0].path).toBe('api.endpoint.a');
    expect(data.elements[1].path).toBe('api.endpoint.b');
    expect(data.elements[2].path).toBe('api.endpoint.c');
  });

  it('should correctly classify intra-layer relationships', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.e2', new Element({
      id: 'uuid-e2',
      path: 'api.endpoint.e2',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E2',
      layer_id: 'api',
    }));

    const relationships: Relationship[] = [
      {
        source: 'api.endpoint.e1',
        predicate: 'depends-on',
        target: 'api.endpoint.e2',
        layer: 'api',
        targetLayer: 'api',
      },
      {
        source: 'api.endpoint.e2',
        predicate: 'references',
        target: 'api.endpoint.e1',
        layer: 'api',
        targetLayer: 'api',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'api');

    expect(data.intraRelationships.length).toBe(2);
    expect(data.interRelationships.length).toBe(0);
    expect(data.upstreamLayers).toEqual([]);
    expect(data.downstreamLayers).toEqual([]);
  });

  it('should correctly classify inter-layer relationships', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));
    elements.set('data-model.entity.customer', new Element({
      id: 'uuid-customer',
      path: 'data-model.entity.customer',
      spec_node_id: 'data-model.entity',
      type: 'entity',
      name: 'Customer',
      layer_id: 'data-model',
    }));

    const relationships: Relationship[] = [
      {
        source: 'api.endpoint.e1',
        predicate: 'references',
        target: 'data-model.entity.customer',
        layer: 'api',
        targetLayer: 'data-model',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const apiData = collector.collectLayerData(model, 'api');
    expect(apiData.intraRelationships.length).toBe(0);
    expect(apiData.interRelationships.length).toBe(1);
    expect(apiData.downstreamLayers).toContain('data-model');
    expect(apiData.upstreamLayers).toEqual([]);

    const dataModelData = collector.collectLayerData(model, 'data-model');
    expect(dataModelData.intraRelationships.length).toBe(0);
    expect(dataModelData.interRelationships.length).toBe(1);
    expect(dataModelData.upstreamLayers).toContain('api');
    expect(dataModelData.downstreamLayers).toEqual([]);
  });

  it('should correctly compute upstream layers', () => {
    const elements = new Map<string, Element>();
    elements.set('data-model.entity.customer', new Element({
      id: 'uuid-customer',
      path: 'data-model.entity.customer',
      spec_node_id: 'data-model.entity',
      type: 'entity',
      name: 'Customer',
      layer_id: 'data-model',
    }));

    const relationships: Relationship[] = [
      {
        source: 'api.endpoint.e1',
        predicate: 'references',
        target: 'data-model.entity.customer',
        layer: 'api',
        targetLayer: 'data-model',
      },
      {
        source: 'application.service.order',
        predicate: 'uses',
        target: 'data-model.entity.customer',
        layer: 'application',
        targetLayer: 'data-model',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'data-model');

    expect(data.upstreamLayers).toContain('api');
    expect(data.upstreamLayers).toContain('application');
    expect(data.upstreamLayers.length).toBe(2);
  });

  it('should correctly compute downstream layers', () => {
    const elements = new Map<string, Element>();
    elements.set('application.service.order', new Element({
      id: 'uuid-order',
      path: 'application.service.order',
      spec_node_id: 'application.service',
      type: 'service',
      name: 'Order Service',
      layer_id: 'application',
    }));

    const relationships: Relationship[] = [
      {
        source: 'application.service.order',
        predicate: 'references',
        target: 'data-model.entity.customer',
        layer: 'application',
        targetLayer: 'data-model',
      },
      {
        source: 'application.service.order',
        predicate: 'uses',
        target: 'data-store.table.orders',
        layer: 'application',
        targetLayer: 'data-store',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'application');

    expect(data.downstreamLayers).toContain('data-model');
    expect(data.downstreamLayers).toContain('data-store');
    expect(data.downstreamLayers.length).toBe(2);
  });

  it('should match statistics counts with relationship lists', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.e2', new Element({
      id: 'uuid-e2',
      path: 'api.endpoint.e2',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E2',
      layer_id: 'api',
    }));

    const relationships: Relationship[] = [
      {
        source: 'api.endpoint.e1',
        predicate: 'depends-on',
        target: 'api.endpoint.e2',
        layer: 'api',
        targetLayer: 'api',
      },
      {
        source: 'api.endpoint.e1',
        predicate: 'references',
        target: 'data-model.entity.customer',
        layer: 'api',
        targetLayer: 'data-model',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'api');

    expect(data.statistics.elementCount).toBe(data.elements.length);
    expect(data.statistics.intraRelationshipCount).toBe(data.intraRelationships.length);
    expect(data.statistics.interRelationshipCount).toBe(data.interRelationships.length);
    expect(data.statistics.outboundRelationshipCount).toBe(1);
  });

  it('should return deterministic output on repeated calls', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.c', new Element({
      id: 'uuid-c',
      path: 'api.endpoint.c',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'C',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.a', new Element({
      id: 'uuid-a',
      path: 'api.endpoint.a',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'A',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.b', new Element({
      id: 'uuid-b',
      path: 'api.endpoint.b',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'B',
      layer_id: 'api',
    }));

    const relationships: Relationship[] = [
      {
        source: 'api.endpoint.c',
        predicate: 'z-predicate',
        target: 'api.endpoint.a',
        layer: 'api',
        targetLayer: 'api',
      },
      {
        source: 'api.endpoint.a',
        predicate: 'a-predicate',
        target: 'api.endpoint.b',
        layer: 'api',
        targetLayer: 'api',
      },
      {
        source: 'api.endpoint.b',
        predicate: 'm-predicate',
        target: 'api.endpoint.c',
        layer: 'api',
        targetLayer: 'api',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data1 = collector.collectLayerData(model, 'api');
    const data2 = collector.collectLayerData(model, 'api');

    // Elements should be in same order
    expect(data1.elements.map(e => e.path)).toEqual(data2.elements.map(e => e.path));
    expect(data1.elements.map(e => e.path)).toEqual([
      'api.endpoint.a',
      'api.endpoint.b',
      'api.endpoint.c',
    ]);

    // Relationships should be in same order (sorted by ${source}-${predicate}-${target})
    expect(
      data1.intraRelationships.map(r => `${r.source}-${r.predicate}-${r.target}`)
    ).toEqual(
      data2.intraRelationships.map(r => `${r.source}-${r.predicate}-${r.target}`)
    );
    expect(
      data1.intraRelationships.map(r => `${r.source}-${r.predicate}-${r.target}`)
    ).toEqual([
      'api.endpoint.a-a-predicate-api.endpoint.b',
      'api.endpoint.b-m-predicate-api.endpoint.c',
      'api.endpoint.c-z-predicate-api.endpoint.a',
    ]);
  });

  it('should handle layer with mixed intra and inter relationships', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.e2', new Element({
      id: 'uuid-e2',
      path: 'api.endpoint.e2',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E2',
      layer_id: 'api',
    }));

    const relationships: Relationship[] = [
      // Intra-layer
      {
        source: 'api.endpoint.e1',
        predicate: 'depends-on',
        target: 'api.endpoint.e2',
        layer: 'api',
        targetLayer: 'api',
      },
      // Inter-layer outbound
      {
        source: 'api.endpoint.e1',
        predicate: 'references',
        target: 'data-model.entity.customer',
        layer: 'api',
        targetLayer: 'data-model',
      },
      // Inter-layer inbound
      {
        source: 'application.service.order',
        predicate: 'calls',
        target: 'api.endpoint.e2',
        layer: 'application',
        targetLayer: 'api',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'api');

    expect(data.intraRelationships.length).toBe(1);
    expect(data.interRelationships.length).toBe(2);
    expect(data.statistics.intraRelationshipCount).toBe(1);
    expect(data.statistics.interRelationshipCount).toBe(2);
    expect(data.upstreamLayers).toContain('application');
    expect(data.downstreamLayers).toContain('data-model');
    expect(data.statistics.inboundRelationshipCount).toBe(1);
    expect(data.statistics.outboundRelationshipCount).toBe(1);
  });

  it('should handle relationships without targetLayer (assumed intra-layer)', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.e2', new Element({
      id: 'uuid-e2',
      path: 'api.endpoint.e2',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E2',
      layer_id: 'api',
    }));

    const relationships: Relationship[] = [
      {
        source: 'api.endpoint.e1',
        predicate: 'depends-on',
        target: 'api.endpoint.e2',
        layer: 'api',
        // No targetLayer field - should be treated as intra-layer
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data = collector.collectLayerData(model, 'api');

    expect(data.intraRelationships.length).toBe(1);
    expect(data.interRelationships.length).toBe(0);
  });
});

describe('ModelReportDataCollector.collectModelData', () => {
  const createMockModel = (
    elements: Map<string, Element> = new Map(),
    relationships: Relationship[] = []
  ): Model => {
    const manifest = new Manifest({
      name: 'test-project',
      version: '1.0.0',
      description: 'Test project description',
      specVersion: '0.9.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    const model = new Model('/test/path', manifest);

    // Add elements to the graph
    for (const [, element] of elements) {
      const node = {
        id: element.path || element.id,
        uuid: element.id,
        layer: element.layer || element.layer_id,
        type: element.type,
        name: element.name,
        description: element.description,
        spec_node_id: element.spec_node_id,
        layer_id: element.layer_id,
        attributes: element.attributes,
        source_reference: element.source_reference,
        metadata: element.metadata,
        properties: {
          '__references__': element.references || [],
          '__relationships__': element.relationships || [],
        },
      };
      model.graph.addNode(node);
    }

    model.relationships = new Relationships(relationships);

    return model;
  };

  it('should collect data for an empty model', () => {
    const model = createMockModel();
    const collector = new ModelReportDataCollector();

    const data = collector.collectModelData(model);

    expect(data.projectName).toBe('test-project');
    expect(data.projectDescription).toBe('Test project description');
    expect(data.modelVersion).toBe('1.0.0');
    expect(data.specVersion).toBe('0.9.0');
    expect(data.totalElements).toBe(0);
    expect(data.totalRelationships).toBe(0);
    expect(data.populatedLayerCount).toBe(0);
    expect(data.layers.length).toBe(13);
    expect(data.cliVersion).toBeDefined();
    expect(data.lastUpdated).toBeDefined();
  });

  it('should include all 13 layers in the summary', () => {
    const model = createMockModel();
    const collector = new ModelReportDataCollector();

    const data = collector.collectModelData(model);

    expect(data.layers.length).toBe(13);
    expect(data.layers[0].layerName).toBe('motivation');
    expect(data.layers[0].layerNumber).toBe(1);
    expect(data.layers[6].layerName).toBe('api');
    expect(data.layers[6].layerNumber).toBe(7);
    expect(data.layers[7].layerName).toBe('data-model');
    expect(data.layers[7].layerNumber).toBe(8);
    expect(data.layers[12].layerName).toBe('testing');
    expect(data.layers[12].layerNumber).toBe(13);
  });

  it('should generate correct report filenames', () => {
    const model = createMockModel();
    const collector = new ModelReportDataCollector();

    const data = collector.collectModelData(model);

    expect(data.layers[0].reportFileName).toBe('01-motivation-layer-report.md');
    expect(data.layers[6].reportFileName).toBe('07-api-layer-report.md');
    expect(data.layers[7].reportFileName).toBe('08-data-model-layer-report.md');
    expect(data.layers[12].reportFileName).toBe('13-testing-layer-report.md');
  });

  it('should aggregate element counts correctly across multiple layers', () => {
    const elements = new Map<string, Element>();
    // Add elements to different layers
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.e2', new Element({
      id: 'uuid-e2',
      path: 'api.endpoint.e2',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E2',
      layer_id: 'api',
    }));
    elements.set('data-model.entity.customer', new Element({
      id: 'uuid-customer',
      path: 'data-model.entity.customer',
      spec_node_id: 'data-model.entity',
      type: 'entity',
      name: 'Customer',
      layer_id: 'data-model',
    }));
    elements.set('motivation.goal.revenue', new Element({
      id: 'uuid-goal',
      path: 'motivation.goal.revenue',
      spec_node_id: 'motivation.goal',
      type: 'goal',
      name: 'Revenue',
      layer_id: 'motivation',
    }));

    const model = createMockModel(elements);
    const collector = new ModelReportDataCollector();

    const data = collector.collectModelData(model);

    expect(data.totalElements).toBe(4);
    expect(data.populatedLayerCount).toBe(3);
    expect(data.layers[0].elementCount).toBe(1); // motivation
    expect(data.layers[6].elementCount).toBe(2); // api
    expect(data.layers[7].elementCount).toBe(1); // data-model
  });

  it('should count total relationships correctly', () => {
    const elements = new Map<string, Element>();
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));
    elements.set('api.endpoint.e2', new Element({
      id: 'uuid-e2',
      path: 'api.endpoint.e2',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E2',
      layer_id: 'api',
    }));

    const relationships: Relationship[] = [
      {
        source: 'api.endpoint.e1',
        predicate: 'depends-on',
        target: 'api.endpoint.e2',
        layer: 'api',
        targetLayer: 'api',
      },
      {
        source: 'api.endpoint.e1',
        predicate: 'references',
        target: 'data-model.entity.customer',
        layer: 'api',
        targetLayer: 'data-model',
      },
      {
        source: 'api.endpoint.e2',
        predicate: 'calls',
        target: 'application.service.order',
        layer: 'api',
        targetLayer: 'application',
      },
    ];

    const model = createMockModel(elements, relationships);
    const collector = new ModelReportDataCollector();

    const data = collector.collectModelData(model);

    expect(data.totalRelationships).toBe(3);
  });

  it('should include all required fields in the returned data', () => {
    const model = createMockModel();
    const collector = new ModelReportDataCollector();

    const data = collector.collectModelData(model);

    expect(data.projectName).toBeDefined();
    expect(data.modelVersion).toBeDefined();
    expect(data.cliVersion).toBeDefined();
    expect(data.specVersion).toBeDefined();
    expect(data.lastUpdated).toBeDefined();
    expect(data.totalElements).toBeDefined();
    expect(data.totalRelationships).toBeDefined();
    expect(data.populatedLayerCount).toBeDefined();
    expect(data.layers).toBeDefined();
  });

  it('should preserve manifest metadata (name, description, version, specVersion)', () => {
    const manifest = new Manifest({
      name: 'my-architecture',
      version: '2.5.0',
      description: 'My system architecture',
      specVersion: '0.8.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    const model = new Model('/test/path', manifest);

    const collector = new ModelReportDataCollector();
    const data = collector.collectModelData(model);

    expect(data.projectName).toBe('my-architecture');
    expect(data.modelVersion).toBe('2.5.0');
    expect(data.projectDescription).toBe('My system architecture');
    expect(data.specVersion).toBe('0.8.0');
  });

  it('should use model manifest modified timestamp as lastUpdated', () => {
    const testTimestamp = '2026-08-20T10:30:45.123Z';
    const manifest = new Manifest({
      name: 'test-project',
      version: '1.0.0',
      created: '2026-08-15T10:00:00Z',
      modified: testTimestamp,
    });
    const model = new Model('/test/path', manifest);

    const collector = new ModelReportDataCollector();
    const data = collector.collectModelData(model);

    expect(data.lastUpdated).toBe(testTimestamp);
  });

  it('should count only populated layers correctly', () => {
    const elements = new Map<string, Element>();
    // Add elements to only 2 layers
    elements.set('motivation.goal.g1', new Element({
      id: 'uuid-g1',
      path: 'motivation.goal.g1',
      spec_node_id: 'motivation.goal',
      type: 'goal',
      name: 'Goal 1',
      layer_id: 'motivation',
    }));
    elements.set('api.endpoint.e1', new Element({
      id: 'uuid-e1',
      path: 'api.endpoint.e1',
      spec_node_id: 'api.endpoint',
      type: 'endpoint',
      name: 'E1',
      layer_id: 'api',
    }));

    const model = createMockModel(elements);
    const collector = new ModelReportDataCollector();

    const data = collector.collectModelData(model);

    expect(data.populatedLayerCount).toBe(2);
    expect(data.layers.filter(l => l.elementCount > 0).length).toBe(2);
  });
});
