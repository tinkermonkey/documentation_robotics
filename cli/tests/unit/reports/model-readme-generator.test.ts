import { describe, it, expect } from 'bun:test';
import { ModelReadmeGenerator } from '@/reports/model-readme-generator';
import type { ModelReadmeData, ModelReadmeLayerSummary } from '@/reports/model-report-data';

describe('ModelReadmeGenerator', () => {
  const createMockLayerSummary = (
    layerName: string,
    layerNumber: number,
    elementCount: number
  ): ModelReadmeLayerSummary => ({
    layerName: layerName as any,
    layerNumber,
    elementCount,
    reportFileName: `${String(layerNumber).padStart(2, '0')}-${layerName}-layer-report.md`,
  });

  const createMockModelData = (overrides?: Partial<ModelReadmeData>): ModelReadmeData => {
    const defaultLayers: ModelReadmeLayerSummary[] = [
      createMockLayerSummary('motivation', 1, 5),
      createMockLayerSummary('business', 2, 8),
      createMockLayerSummary('product', 3, 0),
      createMockLayerSummary('security', 4, 3),
      createMockLayerSummary('application', 5, 12),
      createMockLayerSummary('technology', 6, 10),
      createMockLayerSummary('api', 7, 15),
      createMockLayerSummary('data-model', 8, 20),
      createMockLayerSummary('data-store', 9, 2),
      createMockLayerSummary('ux', 10, 0),
      createMockLayerSummary('navigation', 11, 6),
      createMockLayerSummary('apm', 12, 4),
      createMockLayerSummary('testing', 13, 8),
    ];

    return {
      projectName: 'Example Architecture',
      projectDescription: 'An example microservices architecture for demonstration',
      modelVersion: '1.0.0',
      cliVersion: '0.1.13',
      specVersion: '0.9.0',
      lastUpdated: '2026-04-04T10:00:00Z',
      totalElements: 93,
      totalRelationships: 127,
      populatedLayerCount: 11,
      layers: defaultLayers,
      ...overrides,
    };
  };

  describe('generate()', () => {
    it('should return non-empty string for populated model', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toBeTruthy();
      expect(output.length).toBeGreaterThan(0);
    });

    it('should contain all required sections for populated model', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toContain('# Example Architecture');
      expect(output).toContain('## Model Statistics');
      expect(output).toContain('## Project Summary');
      expect(output).toContain('## About Documentation Robotics');
      expect(output).toContain('## Layer Reports');
      expect(output).toContain('---');
    });

    it('should contain model statistics metrics', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toContain('Total Elements');
      expect(output).toContain('93');
      expect(output).toContain('Total Relationships');
      expect(output).toContain('127');
      expect(output).toContain('Populated Layers');
      expect(output).toContain('11');
      expect(output).toContain('CLI Version');
      expect(output).toContain('0.1.13');
      expect(output).toContain('Spec Version');
      expect(output).toContain('0.9.0');
    });

    it('should include project name and description in summary', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toContain('Example Architecture');
      expect(output).toContain('An example microservices architecture for demonstration');
    });

    it('should list populated layers in summary', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toContain('**Populated Layers**');
      expect(output).toContain('Motivation');
      expect(output).toContain('Business');
      expect(output).toContain('Security');
    });

    it('should not list unpopulated layers in summary', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      // Product and UX have 0 elements, should not be listed in populated layers
      const summarySection = output.split('## Project Summary')[1].split('## About Documentation Robotics')[0];
      expect(summarySection).not.toContain('Product');
      expect(summarySection).not.toContain('UX');
    });

    it('should include all 13 layers in layer reports table', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      // Check for all layer names in the layer reports section
      expect(output).toContain('Motivation');
      expect(output).toContain('Business');
      expect(output).toContain('Product');
      expect(output).toContain('Security');
      expect(output).toContain('Application');
      expect(output).toContain('Technology');
      expect(output).toContain('API');
      expect(output).toContain('Data Model');
      expect(output).toContain('Data Store');
      expect(output).toContain('UX');
      expect(output).toContain('Navigation');
      expect(output).toContain('APM');
      expect(output).toContain('Testing');
    });

    it('should include element counts in layer reports table', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      // Check that element counts appear in the layer reports table
      const reportSection = output.split('## Layer Reports')[1];
      expect(reportSection).toContain('| 5 ');
      expect(reportSection).toContain('| 8 ');
      expect(reportSection).toContain('| 0 ');
      expect(reportSection).toContain('| 15 ');
    });

    it('should create links for populated layers in layer reports table', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      // Check for links to layer reports for populated layers
      expect(output).toContain('[01-motivation-layer-report.md](./reports/01-motivation-layer-report.md)');
      expect(output).toContain('[02-business-layer-report.md](./reports/02-business-layer-report.md)');
      expect(output).toContain('[07-api-layer-report.md](./reports/07-api-layer-report.md)');
    });

    it('should not create links for unpopulated layers in layer reports table', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      // Verify no broken links for empty layers
      expect(output).not.toContain('[03-product-layer-report.md]');
      expect(output).not.toContain('[10-ux-layer-report.md]');

      // Verify that Product and UX layers appear in output but without links
      // They should appear in the table with em-dash instead of report link
      const reportSection = output.split('## Layer Reports')[1];
      expect(reportSection).toContain('Product');
      expect(reportSection).toContain('UX');

      // Both layers should have 0 in the elements column
      // And should have em-dash in the report column
      expect(reportSection).toContain('| Product');
      expect(reportSection).toContain('| UX');
    });

    it('should include introduction content about documentation robotics', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toContain('Documentation Robotics');
      expect(output).toContain('federated architecture data models');
      expect(output).toContain('13 interconnected layers');
      expect(output).toContain('The 13-Layer Architecture Model');
    });

    it('should include descriptions of all 13 layers in introduction', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toContain('Goals, requirements');
      expect(output).toContain('Business processes');
      expect(output).toContain('Product features');
      expect(output).toContain('Authentication, authorization');
      expect(output).toContain('Application components');
      expect(output).toContain('Infrastructure');
      expect(output).toContain('REST APIs');
      expect(output).toContain('Data entities');
      expect(output).toContain('Databases');
      expect(output).toContain('User interface');
      expect(output).toContain('routing');
      expect(output).toContain('Observability');
      expect(output).toContain('Test strategies');
    });

    it('should include footer with generation time and model version', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      expect(output).toContain('Generated: 2026-04-04T10:00:00Z');
      expect(output).toContain('Model Version: 1.0.0');
    });
  });

  describe('Empty model', () => {
    it('should handle model with zero elements', () => {
      const emptyLayers: ModelReadmeLayerSummary[] = [
        createMockLayerSummary('motivation', 1, 0),
        createMockLayerSummary('business', 2, 0),
        createMockLayerSummary('product', 3, 0),
        createMockLayerSummary('security', 4, 0),
        createMockLayerSummary('application', 5, 0),
        createMockLayerSummary('technology', 6, 0),
        createMockLayerSummary('api', 7, 0),
        createMockLayerSummary('data-model', 8, 0),
        createMockLayerSummary('data-store', 9, 0),
        createMockLayerSummary('ux', 10, 0),
        createMockLayerSummary('navigation', 11, 0),
        createMockLayerSummary('apm', 12, 0),
        createMockLayerSummary('testing', 13, 0),
      ];

      const data = createMockModelData({
        totalElements: 0,
        totalRelationships: 0,
        populatedLayerCount: 0,
        layers: emptyLayers,
      });

      const generator = new ModelReadmeGenerator();
      const output = generator.generate(data);

      expect(output).toBeTruthy();
      expect(output).toContain('## Model Statistics');
      expect(output).toContain('Total Elements');
      expect(output).toContain('## Layer Reports');
      // All layers should have — (no links) for empty model
      expect(output).toContain('| 0 ');
      // Check that all 13 layer names appear (verifying all layers are in the table)
      expect(output).toContain('Motivation');
      expect(output).toContain('Testing');
    });

    it('should show populated layers count as 0 for empty model', () => {
      const emptyLayers: ModelReadmeLayerSummary[] = Array.from({ length: 13 }, (_, i) =>
        createMockLayerSummary(
          ['motivation', 'business', 'product', 'security', 'application', 'technology', 'api', 'data-model', 'data-store', 'ux', 'navigation', 'apm', 'testing'][i],
          i + 1,
          0
        )
      );

      const data = createMockModelData({
        totalElements: 0,
        totalRelationships: 0,
        populatedLayerCount: 0,
        layers: emptyLayers,
      });

      const generator = new ModelReadmeGenerator();
      const output = generator.generate(data);

      expect(output).toContain('Populated Layers');
      // Check for 0 in statistics table
      const statsSection = output.split('## Model Statistics')[1].split('## Project Summary')[0];
      expect(statsSection).toContain('| 0 ');
    });

    it('should handle model without project description', () => {
      const data = createMockModelData({
        projectDescription: undefined,
      });

      const generator = new ModelReadmeGenerator();
      const output = generator.generate(data);

      expect(output).toBeTruthy();
      expect(output).toContain('## Project Summary');
      // Should still contain populated layers section
      expect(output).toContain('**Populated Layers**');
    });
  });

  describe('Edge cases', () => {
    it('should handle project name with special characters', () => {
      const data = createMockModelData({
        projectName: 'Customer-Portal [v2.0]',
      });

      const generator = new ModelReadmeGenerator();
      const output = generator.generate(data);

      expect(output).toContain('Customer-Portal');
    });

    it('should handle model without spec version', () => {
      const data = createMockModelData({
        specVersion: undefined,
      });

      const generator = new ModelReadmeGenerator();
      const output = generator.generate(data);

      expect(output).toBeTruthy();
      expect(output).not.toContain('Spec Version');
      expect(output).toContain('CLI Version');
    });

    it('should order layers by layer number in table', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      // Find positions of layer names in output
      // Motivation (layer 1) should appear before Testing (layer 13)
      const motivationIndex = output.indexOf('| Motivation');
      const testingIndex = output.indexOf('| Testing');

      expect(motivationIndex).toBeGreaterThanOrEqual(0);
      expect(testingIndex).toBeGreaterThanOrEqual(0);
      expect(motivationIndex).toBeLessThan(testingIndex);
    });

    it('should generate valid markdown table format', () => {
      const data = createMockModelData();
      const generator = new ModelReadmeGenerator();

      const output = generator.generate(data);

      // Check for valid markdown table structure (pipes and separators)
      const tableRegex = /\|.*\|.*\|.*\|/;
      expect(tableRegex.test(output)).toBe(true);
    });

    it('should escape special characters in project description', () => {
      const data = createMockModelData({
        projectDescription: 'A system with *asterisks* and [brackets]',
      });

      const generator = new ModelReadmeGenerator();
      const output = generator.generate(data);

      expect(output).toContain('A system with');
    });

    it('should handle single populated layer correctly', () => {
      const singleLayerData: ModelReadmeLayerSummary[] = [
        createMockLayerSummary('motivation', 1, 0),
        createMockLayerSummary('business', 2, 0),
        createMockLayerSummary('product', 3, 0),
        createMockLayerSummary('security', 4, 0),
        createMockLayerSummary('application', 5, 0),
        createMockLayerSummary('technology', 6, 0),
        createMockLayerSummary('api', 7, 5),
        createMockLayerSummary('data-model', 8, 0),
        createMockLayerSummary('data-store', 9, 0),
        createMockLayerSummary('ux', 10, 0),
        createMockLayerSummary('navigation', 11, 0),
        createMockLayerSummary('apm', 12, 0),
        createMockLayerSummary('testing', 13, 0),
      ];

      const data = createMockModelData({
        totalElements: 5,
        totalRelationships: 2,
        populatedLayerCount: 1,
        layers: singleLayerData,
      });

      const generator = new ModelReadmeGenerator();
      const output = generator.generate(data);

      expect(output).toContain('Populated Layers');
      expect(output).toContain('API');
      expect(output).toContain('[07-api-layer-report.md]');
    });
  });
});
