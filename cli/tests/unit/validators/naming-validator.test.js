import { describe, it, expect } from 'bun:test';
import { NamingValidator } from '@/validators/naming-validator';
import { Layer } from '@/core/layer';
import { Element } from '@/core/element';
describe('NamingValidator', () => {
    it('should validate correct element IDs', () => {
        const validator = new NamingValidator();
        const layer = new Layer('motivation', [
            new Element({
                id: 'motivation-goal-increase-revenue',
                type: 'Goal',
                name: 'Increase Revenue',
            }),
            new Element({
                id: 'motivation-requirement-user-login',
                type: 'Requirement',
                name: 'User Login',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
    it('should detect invalid ID format (too few parts)', () => {
        const validator = new NamingValidator();
        const layer = new Layer('motivation', [
            new Element({
                id: 'invalid-id',
                type: 'Goal',
                name: 'Test',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain("Element ID layer prefix 'invalid' does not match layer 'motivation'");
    });
    it('should detect mismatched layer prefix', () => {
        const validator = new NamingValidator();
        const layer = new Layer('motivation', [
            new Element({
                id: 'business-goal-test',
                type: 'Goal',
                name: 'Test',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('does not match layer');
        expect(result.errors[0].fixSuggestion).toContain('motivation');
    });
    it('should detect missing type component', () => {
        const validator = new NamingValidator();
        const layer = new Layer('motivation', [
            new Element({
                id: 'motivation--test',
                type: 'Goal',
                name: 'Test',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(false);
        expect(result.errors).toHaveLength(1);
    });
    it('should detect missing name component', () => {
        const validator = new NamingValidator();
        const layer = new Layer('business', [
            new Element({
                id: 'business-process-',
                type: 'Process',
                name: 'Test',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
    it('should validate multi-word kebab-case names', () => {
        const validator = new NamingValidator();
        const layer = new Layer('technology', [
            new Element({
                id: 'technology-infrastructure-kubernetes-cluster',
                type: 'Infrastructure',
                name: 'Kubernetes Cluster',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(true);
    });
    it('should detect uppercase characters in ID', () => {
        const validator = new NamingValidator();
        const layer = new Layer('motivation', [
            new Element({
                id: 'motivation-Goal-test',
                type: 'Goal',
                name: 'Test',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(false);
        expect(result.errors).toHaveLength(1);
    });
    it('should validate multiple elements', () => {
        const validator = new NamingValidator();
        const layer = new Layer('api', [
            new Element({
                id: 'api-endpoint-get-users',
                type: 'Endpoint',
                name: 'Get Users',
            }),
            new Element({
                id: 'api-endpoint-create-user',
                type: 'Endpoint',
                name: 'Create User',
            }),
            new Element({
                id: 'invalid-format',
                type: 'Endpoint',
                name: 'Invalid',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].elementId).toBe('invalid-format');
    });
    it('should handle numeric characters in IDs', () => {
        const validator = new NamingValidator();
        const layer = new Layer('data-model', [
            new Element({
                id: 'data-model-entity-user-v2',
                type: 'Entity',
                name: 'User V2',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(true);
    });
    it('should validate data-store layer elements', () => {
        const validator = new NamingValidator();
        const layer = new Layer('data-store', [
            new Element({
                id: 'data-store-table-users',
                type: 'Table',
                name: 'Users Table',
            }),
            new Element({
                id: 'data-store-schema-inventory',
                type: 'Schema',
                name: 'Inventory Schema',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
    it('should reject data-store elements with wrong layer prefix', () => {
        const validator = new NamingValidator();
        const layer = new Layer('data-store', [
            new Element({
                id: 'data-model-table-users',
                type: 'Table',
                name: 'Users Table',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain('data-model');
        expect(result.errors[0].message).toContain('data-store');
    });
    it('should validate data-model elements with complex names', () => {
        const validator = new NamingValidator();
        const layer = new Layer('data-model', [
            new Element({
                id: 'data-model-relationship-user-to-order',
                type: 'Relationship',
                name: 'User To Order',
            }),
        ]);
        const result = validator.validateLayer(layer);
        expect(result.isValid()).toBe(true);
    });
    it('should handle all hyphenated layer names correctly', () => {
        const validator = new NamingValidator();
        const testCases = [
            { layerName: 'data-model', elementId: 'data-model-entity-customer', valid: true },
            { layerName: 'data-store', elementId: 'data-store-table-orders', valid: true },
            { layerName: 'data-model', elementId: 'data-store-entity-customer', valid: false },
            { layerName: 'data-store', elementId: 'data-model-table-orders', valid: false },
        ];
        for (const testCase of testCases) {
            const layer = new Layer(testCase.layerName, [
                new Element({
                    id: testCase.elementId,
                    type: 'Type',
                    name: 'Test',
                }),
            ]);
            const validator_instance = new NamingValidator();
            const result = validator_instance.validateLayer(layer);
            expect(result.isValid()).toBe(testCase.valid, `Expected ${testCase.elementId} in layer ${testCase.layerName} to be ${testCase.valid ? 'valid' : 'invalid'}`);
        }
    });
});
//# sourceMappingURL=naming-validator.test.js.map
