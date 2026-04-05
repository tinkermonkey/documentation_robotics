import { describe, it, expect } from 'bun:test';
import { ModelLayerReportGenerator } from '@/reports/model-layer-report-generator';
import type { ModelLayerReportData } from '@/reports/model-report-data';
import type { Element } from '@/core/element';
import type { Relationship } from '@/core/relationships';

describe('ModelLayerReportGenerator', () => {
  const createMockElement = (
    path: string,
    name: string,
    type: string,
    attributes: Record<string, unknown> = {}
  ): Element => ({
    id: `uuid-${path}`,
    path,
    spec_node_id: `${path.split('.')[0]}.${type}`,
    type,
    name,
    layer_id: path.split('.')[0],
    layer: path.split('.')[0],
    attributes,
  });

  const createMockRelationship = (
    source: string,
    predicate: string,
    target: string,
    layer: string,
    targetLayer?: string
  ): Relationship => ({
    source,
    predicate,
    target,
    layer,
    targetLayer,
  });

  const createMockReportData = (
    layerName: string,
    elements: Element[] = [],
    intraRelationships: Relationship[] = [],
    interRelationships: Relationship[] = []
  ): ModelLayerReportData => ({
    layerName,
    layerNumber: 6, // Example: API layer
    elements,
    intraRelationships,
    interRelationships,
    upstreamLayers: [],
    downstreamLayers: [],
    statistics: {
      elementCount: elements.length,
      intraRelationshipCount: intraRelationships.length,
      interRelationshipCount: interRelationships.length,
      inboundRelationshipCount: 0,
      outboundRelationshipCount: 0,
    },
  });

  describe('generate()', () => {
    it('should return non-empty string for populated layer', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const relationship = createMockRelationship(
        'api.endpoint.get-users',
        'uses',
        'api.service.user-service',
        'api'
      );

      const data = createMockReportData('api', [element], [relationship]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(0);
    });

    it('should contain all required sections for populated layer', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const intraRel = createMockRelationship(
        'api.endpoint.get-users',
        'uses',
        'api.service.user-service',
        'api'
      );
      const interRel = createMockRelationship(
        'api.endpoint.get-users',
        'calls',
        'application.service.user-app',
        'api',
        'application'
      );

      const data = createMockReportData('api', [element], [intraRel], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Check for all required sections
      expect(output).toContain('# API');
      expect(output).toContain('## Report Index');
      expect(output).toContain('## Layer Introduction');
      expect(output).toContain('## Intra-Layer Relationships');
      expect(output).toContain('## Inter-Layer Dependencies');
      expect(output).toContain('## Inter-Layer Relationships Table');
      expect(output).toContain('## Element Reference');
      expect(output).toContain('---');
    });
  });

  describe('Intra-layer diagram', () => {
    it('should use flowchart LR with subgraph for populated layer', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const relationship = createMockRelationship(
        'api.endpoint.get-users',
        'uses',
        'api.service.user-service',
        'api'
      );

      const data = createMockReportData('api', [element], [relationship]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('flowchart LR');
      expect(output).toContain('subgraph api');
    });

    it('should include element names in intra-layer diagram', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('Get Users');
    });

    it('should show placeholder text for empty layer', () => {
      const data = createMockReportData('api', []);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('No elements in this layer');
      expect(output).not.toContain('flowchart LR');
    });

    it('should render mermaid diagram for large layer (>30 elements)', () => {
      // Create 31 elements
      const elements: Element[] = [];
      for (let i = 0; i < 31; i++) {
        elements.push(
          createMockElement(`api.endpoint.endpoint-${i}`, `Endpoint ${i}`, 'endpoint')
        );
      }

      const data = createMockReportData('api', elements);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Mermaid diagram should be rendered for all layers (including large ones)
      expect(output).toContain('flowchart LR');
      expect(output).not.toContain('Element Overview');
      // All elements should be represented in the diagram
      for (let i = 0; i < 31; i++) {
        expect(output).toContain(`Endpoint ${i}`);
      }
    });

    it('should render mermaid diagram for layer with exactly 30 elements', () => {
      // Create exactly 30 elements
      const elements: Element[] = [];
      for (let i = 0; i < 30; i++) {
        elements.push(
          createMockElement(`api.endpoint.endpoint-${i}`, `Endpoint ${i}`, 'endpoint')
        );
      }

      const data = createMockReportData('api', elements);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Mermaid diagram should be rendered for all layers
      expect(output).toContain('flowchart LR');
      expect(output).not.toContain('Element Overview');
    });

    it('should handle relationships with special characters in predicate', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const relationship = createMockRelationship(
        'api.endpoint.get-users',
        'invokes*',
        'api.service.user-service',
        'api'
      );

      const data = createMockReportData('api', [element], [relationship]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Should escape the asterisk
      expect(output).toContain('invokes\\*');
    });
  });

  describe('Inter-layer diagram', () => {
    it('should use flowchart TB with classDef current', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const interRel = createMockRelationship(
        'api.endpoint.get-users',
        'calls',
        'application.service.user-app',
        'api',
        'application'
      );

      const data = createMockReportData('api', [element], [], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('flowchart TB');
      expect(output).toContain('classDef current fill:#f9f,stroke:#333,stroke-width:2px');
      expect(output).toContain('class api current');
    });

    it('should show placeholder for empty layer', () => {
      const data = createMockReportData('api', []);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      const intraSection = output.split('## Intra-Layer Relationships')[1];
      const interSection = output.split('## Inter-Layer Dependencies')[1];

      expect(intraSection).toContain('No elements in this layer');
      expect(interSection).toContain('No elements in this layer');
    });
  });

  describe('Inter-layer relationships table', () => {
    it('should include table with all required columns when inter-relationships exist', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const interRel = createMockRelationship(
        'api.endpoint.get-users',
        'calls',
        'application.service.user-app',
        'api',
        'application'
      );

      const data = createMockReportData('api', [element], [], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('## Inter-Layer Relationships Table');
      // Check for all required columns per spec
      expect(output).toContain('Relationship ID');
      expect(output).toContain('Source Node');
      expect(output).toContain('Dest Node');
      expect(output).toContain('Dest Layer');
      expect(output).toContain('Predicate');
      expect(output).toContain('Cardinality');
      expect(output).toContain('Strength');
    });

    it('should not include table when no inter-relationships exist', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).not.toContain('## Inter-Layer Relationships Table');
    });

    it('should include destination layer in table', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const interRel = createMockRelationship(
        'api.endpoint.get-users',
        'calls',
        'application.service.user-app',
        'api',
        'application'
      );

      const data = createMockReportData('api', [element], [], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Destination layer should appear in the table
      expect(output).toContain('application');
    });

    it('should include relationship identifier in table', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const interRel = createMockRelationship(
        'api.endpoint.get-users',
        'calls',
        'application.service.user-app',
        'api',
        'application'
      );

      const data = createMockReportData('api', [element], [], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Relationship ID should be in format: source-predicate-target
      expect(output).toContain('api.endpoint.get-users-calls-application.service.user-app');
    });

    it('should populate cardinality and strength with real values from spec', () => {
      // Use a relationship that exists in the spec
      // api.callback aggregates api.pathitem has cardinality: many-to-many, strength: medium
      const callback = createMockElement('api.callback.order-created', 'Order Created Callback', 'callback');
      const pathitem = createMockElement('api.pathitem.order-status', 'Order Status Path', 'pathitem');

      const interRel = createMockRelationship(
        'api.callback.order-created',
        'aggregates',
        'api.pathitem.order-status',
        'api',
        'api'
      );

      const data = createMockReportData('api', [callback, pathitem], [], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Table should be present
      expect(output).toContain('## Inter-Layer Relationships Table');

      // Should contain the actual cardinality value (not 'unknown')
      expect(output).toContain('many-to-many');

      // Should contain the actual strength value (not 'unknown')
      expect(output).toContain('medium');

      // Should use the spec relationship ID format
      expect(output).toContain('api.callback.aggregates.api.pathitem');
    });
  });

  describe('Element Reference section', () => {
    it('should include element reference only when elements exist', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('## Element Reference');
      expect(output).toContain('### Get Users');
    });

    it('should not include element reference section for empty layer', () => {
      const data = createMockReportData('api', []);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).not.toContain('## Element Reference');
    });

    it('should include element ID and type', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('**ID**: `api.endpoint.get-users`');
      expect(output).toContain('**Type**: `endpoint`');
    });

    it('should include attributes table if attributes exist', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint', {
        method: 'GET',
        path: '/users',
      });
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('#### Attributes');
      expect(output).toContain('Name');
      expect(output).toContain('Value');
      expect(output).toContain('GET');
      expect(output).toContain('/users');
    });

    it('should properly format different attribute value types', () => {
      const element = createMockElement('api.endpoint.test', 'Test Endpoint', 'endpoint', {
        stringAttr: 'hello world',
        numberAttr: 42,
        booleanAttr: true,
        arrayAttr: [1, 2, 3],
        objectAttr: { key: 'value' },
      });
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // valueToMarkdown should handle each type correctly
      expect(output).toContain('stringAttr');
      expect(output).toContain('hello world');
      expect(output).toContain('numberAttr');
      expect(output).toContain('42');
      expect(output).toContain('booleanAttr');
      expect(output).toContain('true');
      expect(output).toContain('arrayAttr');
      expect(output).toContain('[1, 2, 3]');
      expect(output).toContain('objectAttr');
    });

    it('should include relationships table if relationships exist', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      const relationship = createMockRelationship(
        'api.endpoint.get-users',
        'uses',
        'api.service.user-service',
        'api'
      );

      const data = createMockReportData('api', [element], [relationship]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('#### Relationships');
      expect(output).toContain('Type');
      expect(output).toContain('Related Element');
      expect(output).toContain('Predicate');
      expect(output).toContain('Direction');
      expect(output).toContain('intra-layer');
    });

    it('should handle element descriptions', () => {
      const element = createMockElement('api.endpoint.get-users', 'Get Users', 'endpoint');
      element.description = 'Retrieves a list of all users';
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('Retrieves a list of all users');
    });
  });

  describe('Deterministic output', () => {
    it('should produce identical output for same input', () => {
      const element1 = createMockElement('api.endpoint.a', 'Endpoint A', 'endpoint');
      const element2 = createMockElement('api.endpoint.b', 'Endpoint B', 'endpoint');
      const data = createMockReportData('api', [element1, element2]);

      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');
      const output1 = generator.generate(data);
      const output2 = generator.generate(data);

      expect(output1).toBe(output2);
    });

    it('should sort relationships consistently', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const rel1 = createMockRelationship(
        'api.endpoint.test',
        'zebra',
        'api.service.a',
        'api'
      );
      const rel2 = createMockRelationship(
        'api.service.a',
        'alpha',
        'api.endpoint.test',
        'api'
      );
      const rel3 = createMockRelationship(
        'api.endpoint.test',
        'beta',
        'api.service.b',
        'api'
      );

      const data = createMockReportData('api', [element], [rel3, rel1, rel2]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output1 = generator.generate(data);
      const output2 = generator.generate(data);

      // Generate multiple times and verify consistency
      expect(output1).toBe(output2);

      // Check that all relationships are present
      expect(output1).toContain('alpha');
      expect(output1).toContain('beta');
      expect(output1).toContain('zebra');
    });

    it('should sort elements consistently', () => {
      const element1 = createMockElement('api.endpoint.c', 'C Endpoint', 'endpoint');
      const element2 = createMockElement('api.endpoint.a', 'A Endpoint', 'endpoint');
      const element3 = createMockElement('api.endpoint.b', 'B Endpoint', 'endpoint');

      const data = createMockReportData('api', [element3, element1, element2]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // All elements should be present
      expect(output).toContain('A Endpoint');
      expect(output).toContain('B Endpoint');
      expect(output).toContain('C Endpoint');
    });
  });

  describe('Markdown validity', () => {
    it('should not have unclosed code fences', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Count opening and closing markdown code fences
      const opening = (output.match(/```/g) || []).length;
      expect(opening % 2).toBe(0);
    });

    it('should have valid table structure', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Check for proper markdown table structure
      expect(output).toMatch(/\| .* \|\n\| -+(\s*\| -+)* \|/);
    });
  });

  describe('Layer name formatting', () => {
    it('should format layer names correctly', () => {
      const element = createMockElement('data-model.entity.customer', 'Customer', 'entity');
      const data = createMockReportData('data-model', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('# Data Model');
    });

    it('should format acronym layer names correctly', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('# API');
    });
  });

  describe('Report Index', () => {
    it('should include links to all sections', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const relationship = createMockRelationship(
        'api.endpoint.test',
        'uses',
        'api.service.a',
        'api'
      );
      const interRel = createMockRelationship(
        'api.endpoint.test',
        'calls',
        'application.service.a',
        'api',
        'application'
      );

      const data = createMockReportData('api', [element], [relationship], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('[Layer Introduction](#layer-introduction)');
      expect(output).toContain('[Intra-Layer Relationships](#intra-layer-relationships)');
      expect(output).toContain('[Inter-Layer Dependencies](#inter-layer-dependencies)');
      expect(output).toContain('[Inter-Layer Relationships Table](#inter-layer-relationships-table)');
      expect(output).toContain('[Element Reference](#element-reference)');
    });

    it('should not include inter-layer table link when no inter-relationships', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).not.toContain('[Inter-Layer Relationships Table]');
    });
  });

  describe('Footer', () => {
    it('should include version and timestamp', () => {
      const data = createMockReportData('api', []);
      const generator = new ModelLayerReportGenerator('2.1.0', '2026-04-04T15:30:45Z');

      const output = generator.generate(data);

      expect(output).toContain('Generated: 2026-04-04T15:30:45Z');
      expect(output).toContain('Model Version: 2.1.0');
    });
  });

  describe('Special characters handling', () => {
    it('should escape markdown special characters in element names', () => {
      const element = createMockElement(
        'api.endpoint.test',
        'Get *User* [Details]',
        'endpoint'
      );
      const data = createMockReportData('api', [element]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toContain('Get \\*User\\* \\[Details\\]');
    });

    it('should escape special characters in predicates', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const relationship = createMockRelationship(
        'api.endpoint.test',
        'calls [with retry]',
        'api.service.a',
        'api'
      );

      const data = createMockReportData('api', [element], [relationship]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      // Should escape special characters
      expect(output).toContain('calls \\[with retry\\]');
    });
  });

  describe('Layer with only inter-layer relationships', () => {
    it('should handle layer with no intra-layer relationships', () => {
      const element = createMockElement('api.endpoint.test', 'Test', 'endpoint');
      const interRel = createMockRelationship(
        'api.endpoint.test',
        'calls',
        'application.service.a',
        'api',
        'application'
      );

      const data = createMockReportData('api', [element], [], [interRel]);
      const generator = new ModelLayerReportGenerator('1.0.0', '2026-04-04T10:00:00Z');

      const output = generator.generate(data);

      expect(output).toBeTruthy();
      expect(output).toContain('## Element Reference');
      expect(output).toContain('## Inter-Layer Relationships Table');
    });
  });
});
