/**
 * Integration tests for CLI commands
 * These tests verify complete command workflows using temporary directories
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'fs/promises';
import { Model } from '@/core/model.js';
import { fileExists, readJSON } from '@/utils/file-io.js';
const TEMP_DIR = '/tmp/dr-cli-test';
/**
 * Helper to run dr commands using Bun
 */
async function runDr(...args) {
    try {
        const result = await Bun.spawnSync({
            cmd: ['bun', 'run', 'dist/cli.js', ...args],
            cwd: TEMP_DIR,
        });
        return { exitCode: result.exitCode };
    }
    catch (error) {
        return { exitCode: 1 };
    }
}
describe('CLI Commands Integration Tests', () => {
    beforeEach(async () => {
        try {
            await rm(TEMP_DIR, { recursive: true, force: true });
        }
        catch (e) {
            // ignore
        }
        await mkdir(TEMP_DIR, { recursive: true });
    });
    afterEach(async () => {
        try {
            await rm(TEMP_DIR, { recursive: true, force: true });
        }
        catch (e) {
            // ignore
        }
    });
    describe('init command', () => {
        it('should create a new model', async () => {
            const result = await runDr('init', '--name', 'Test Model');
            expect(result.exitCode).toBe(0);
            // Verify .dr directory was created
            expect(await fileExists(`${TEMP_DIR}/.dr/manifest.json`)).toBe(true);
            expect(await fileExists(`${TEMP_DIR}/.dr/layers`)).toBe(true);
            // Verify manifest contents
            const manifest = await readJSON(`${TEMP_DIR}/.dr/manifest.json`);
            expect(manifest.name).toBe('Test Model');
            expect(manifest.version).toBe('0.1.0');
        });
        it('should fail if model already exists', async () => {
            // Initialize once
            await runDr('init', '--name', 'First Model');
            // Try to initialize again
            const result = await runDr('init', '--name', 'Second Model');
            expect(result.exitCode).toBe(1);
        });
        it('should fail if no model found for other commands', async () => {
            const result = await runDr('list', 'motivation');
            expect(result.exitCode).toBe(1);
        });
    });
    describe('add command', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
        });
        it('should add an element to a layer', async () => {
            const result = await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
            expect(result.exitCode).toBe(0);
            // Verify element was created
            const model = await Model.load(TEMP_DIR);
            const layer = await model.getLayer('motivation');
            expect(layer).toBeDefined();
            const element = layer.getElement('motivation-goal-test');
            expect(element).toBeDefined();
            expect(element.name).toBe('Test Goal');
        });
        it('should add element with properties', async () => {
            const result = await runDr('add', 'data-model', 'entity', 'data-model-entity-user', '--name', 'User', '--properties', JSON.stringify({ required: true }));
            expect(result.exitCode).toBe(0);
            const model = await Model.load(TEMP_DIR);
            const layer = await model.getLayer('data-model');
            const element = layer.getElement('data-model-entity-user');
            expect(element.properties.required).toBe(true);
        });
        it('should fail if element already exists', async () => {
            // Add element first
            await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
            // Try to add again
            const result = await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Duplicate');
            expect(result.exitCode).toBe(1);
        });
        it('should fail with invalid JSON properties', async () => {
            const result = await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--properties', 'not-json');
            expect(result.exitCode).toBe(1);
        });
    });
    describe('update command', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Original Name');
        });
        it('should update element name', async () => {
            const result = await runDr('update', 'motivation-goal-test', '--name', 'Updated Name');
            expect(result.exitCode).toBe(0);
            const model = await Model.load(TEMP_DIR);
            const layer = await model.getLayer('motivation');
            const element = layer.getElement('motivation-goal-test');
            expect(element.name).toBe('Updated Name');
        });
        it('should fail if element not found', async () => {
            const result = await runDr('update', 'nonexistent-element', '--name', 'Test');
            expect(result.exitCode).toBe(1);
        });
    });
    describe('delete command', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
        });
        it('should delete element with force flag', async () => {
            const result = await runDr('delete', 'motivation-goal-test', '--force');
            expect(result.exitCode).toBe(0);
            const model = await Model.load(TEMP_DIR);
            const layer = await model.getLayer('motivation');
            expect(layer.getElement('motivation-goal-test')).toBeUndefined();
        });
        it('should fail if element not found', async () => {
            const result = await runDr('delete', 'nonexistent-element', '--force');
            expect(result.exitCode).toBe(1);
        });
    });
    describe('show command', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
        });
        it('should display element details', async () => {
            const result = await runDr('show', 'motivation-goal-test');
            expect(result.exitCode).toBe(0);
        });
        it('should fail if element not found', async () => {
            const result = await runDr('show', 'nonexistent-element');
            expect(result.exitCode).toBe(1);
        });
    });
    describe('list command', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-2', '--name', 'Goal 2');
            await runDr('add', 'motivation', 'driver', 'motivation-driver-1', '--name', 'Driver 1');
        });
        it('should list all elements in layer', async () => {
            const result = await runDr('list', 'motivation');
            expect(result.exitCode).toBe(0);
        });
        it('should filter by type', async () => {
            const result = await runDr('list', 'motivation', '--type', 'goal');
            expect(result.exitCode).toBe(0);
        });
        it('should fail if layer not found', async () => {
            const result = await runDr('list', 'nonexistent-layer');
            expect(result.exitCode).toBe(1);
        });
    });
    describe('search command', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-improve', '--name', 'Improve System');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-enhance', '--name', 'Enhance Security');
            await runDr('add', 'business', 'process', 'business-process-user-auth', '--name', 'User Authentication');
        });
        it('should search by id pattern', async () => {
            const result = await runDr('search', 'goal');
            expect(result.exitCode).toBe(0);
        });
        it('should search by name pattern', async () => {
            const result = await runDr('search', 'Enhance');
            expect(result.exitCode).toBe(0);
        });
        it('should filter by layer', async () => {
            const result = await runDr('search', 'User', '--layer', 'business');
            expect(result.exitCode).toBe(0);
        });
        it('should return empty results for no matches', async () => {
            const result = await runDr('search', 'nonexistent');
            expect(result.exitCode).toBe(0);
        });
    });
    describe('validate command', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
        });
        it('should validate valid model', async () => {
            const result = await runDr('validate');
            expect(result.exitCode).toBe(0);
        });
    });
    describe('element subcommands', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
        });
        it('should add element via element subcommand', async () => {
            const result = await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-test', '--name', 'Test Goal');
            expect(result.exitCode).toBe(0);
            const model = await Model.load(TEMP_DIR);
            const element = (await model.getLayer('motivation')).getElement('motivation-goal-test');
            expect(element).toBeDefined();
        });
        it('should list elements via element subcommand', async () => {
            await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
            await runDr('element', 'add', 'motivation', 'goal', 'motivation-goal-2', '--name', 'Goal 2');
            const result = await runDr('element', 'list', 'motivation');
            expect(result.exitCode).toBe(0);
        });
    });
    describe('relationship subcommands', () => {
        beforeEach(async () => {
            await runDr('init', '--name', 'Test Model');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-1', '--name', 'Goal 1');
            await runDr('add', 'motivation', 'goal', 'motivation-goal-2', '--name', 'Goal 2');
        });
        it('should add relationship between elements', async () => {
            const result = await runDr('relationship', 'add', 'motivation-goal-1', 'motivation-goal-2', '--predicate', 'depends-on');
            expect(result.exitCode).toBe(0);
            const model = await Model.load(TEMP_DIR);
            const layer = await model.getLayer('motivation');
            const element = layer.getElement('motivation-goal-1');
            expect(element.relationships.length).toBe(1);
            expect(element.relationships[0].predicate).toBe('depends-on');
        });
        it('should fail to add cross-layer relationship', async () => {
            await runDr('add', 'business', 'process', 'business-process-test', '--name', 'Test Process');
            const result = await runDr('relationship', 'add', 'motivation-goal-1', 'business-process-test', '--predicate', 'depends-on');
            expect(result.exitCode).toBe(1);
        });
        it('should list relationships', async () => {
            await runDr('relationship', 'add', 'motivation-goal-1', 'motivation-goal-2', '--predicate', 'depends-on');
            const result = await runDr('relationship', 'list', 'motivation-goal-1');
            expect(result.exitCode).toBe(0);
        });
        it('should delete relationship', async () => {
            await runDr('relationship', 'add', 'motivation-goal-1', 'motivation-goal-2', '--predicate', 'depends-on');
            const result = await runDr('relationship', 'delete', 'motivation-goal-1', 'motivation-goal-2', '--force');
            expect(result.exitCode).toBe(0);
            const model = await Model.load(TEMP_DIR);
            const element = (await model.getLayer('motivation')).getElement('motivation-goal-1');
            expect(element.relationships.length).toBe(0);
        });
    });
});
//# sourceMappingURL=commands.test.js.map
