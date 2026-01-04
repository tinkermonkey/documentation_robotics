import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Model } from "@/core/model";
import { Layer } from "@/core/layer";
import { Element } from "@/core/element";
import { Manifest } from "@/core/manifest";
import { readFile, fileExists } from "@/utils/file-io";
import { $ } from "bun";
describe("Model", () => {
    let testDir;
    beforeEach(async () => {
        testDir = `/tmp/dr-test-${Date.now()}-${Math.random()}`;
        await $ `mkdir -p ${testDir}`;
    });
    afterEach(async () => {
        if (await fileExists(testDir)) {
            await $ `rm -rf ${testDir}`;
        }
    });
    it("should create a model with manifest", () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        expect(model.rootPath).toBe(testDir);
        expect(model.manifest.name).toBe("Test Model");
        expect(model.layers.size).toBe(0);
        expect(model.lazyLoad).toBe(false);
    });
    it("should create a model with lazy loading enabled", () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest, { lazyLoad: true });
        expect(model.lazyLoad).toBe(true);
    });
    it("should add layers to model", () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        const layer = new Layer("motivation");
        model.addLayer(layer);
        expect(model.layers.size).toBe(1);
        expect(model.getLayerNames()).toContain("motivation");
    });
    it("should get layer by name", () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        const layer = new Layer("motivation");
        model.addLayer(layer);
        const retrieved = model.layers.get("motivation");
        expect(retrieved).toEqual(layer);
    });
    it("should return undefined for nonexistent layer", async () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        const retrieved = await model.getLayer("nonexistent");
        expect(retrieved).toBeUndefined();
    });
    it("should save and load manifest", async () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
            description: "A test model",
            author: "Test Author",
        });
        const model = new Model(testDir, manifest);
        await model.saveManifest();
        const manifestPath = `${testDir}/documentation-robotics/model/manifest.yaml`;
        expect(await fileExists(manifestPath)).toBe(true);
        const content = await readFile(manifestPath);
        expect(content).toContain("name: Test Model");
        expect(content).toContain("version: 1.0.0");
    });
    it("should save layer to disk", async () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        const element = new Element({
            id: "motivation-goal-test",
            type: "Goal",
            name: "Test Goal",
            description: "A test goal",
        });
        const layer = new Layer("motivation", [element]);
        model.addLayer(layer);
        await model.saveLayer("motivation");
        const layerPath = `${testDir}/documentation-robotics/model/01_motivation/Goals.yaml`;
        expect(await fileExists(layerPath)).toBe(true);
    });
    it("should throw error when saving nonexistent layer", async () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        try {
            await model.saveLayer("nonexistent");
            expect.unreachable("Should have thrown error");
        }
        catch (error) {
            expect(error).toBeInstanceOf(Error);
            if (error instanceof Error) {
                expect(error.message).toContain("not found");
            }
        }
    });
    it("should load layer from disk", async () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        const element = new Element({
            id: "motivation-goal-test",
            type: "Goal",
            name: "Test Goal",
            description: "A test goal",
        });
        const layer = new Layer("motivation", [element]);
        layer.metadata = { layer: "motivation", version: "1.0" };
        model.addLayer(layer);
        await model.saveLayer("motivation");
        // Create new model and load layer
        const model2 = new Model(testDir, manifest);
        await model2.loadLayer("motivation");
        expect(model2.layers.has("motivation")).toBe(true);
        const loadedLayer = model2.layers.get("motivation");
        expect(loadedLayer?.listElements()).toHaveLength(1);
        expect(loadedLayer?.getElement("motivation-goal-test")?.name).toBe("Test Goal");
    });
    it("should save all dirty layers", async () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        const element1 = new Element({
            id: "motivation-goal-test1",
            type: "Goal",
            name: "Goal 1",
        });
        const element2 = new Element({
            id: "business-process-test1",
            type: "Process",
            name: "Process 1",
        });
        const layer1 = new Layer("motivation", [element1]);
        const layer2 = new Layer("business", [element2]);
        model.addLayer(layer1);
        model.addLayer(layer2);
        // Save initial state
        await model.saveLayer("motivation");
        layer2.markClean(); // Mark layer2 as clean without saving
        // Modify layer1
        layer1.addElement(new Element({
            id: "motivation-goal-test2",
            type: "Goal",
            name: "Goal 2",
        }));
        // Only layer1 should be dirty
        expect(layer1.isDirty()).toBe(true);
        expect(layer2.isDirty()).toBe(false);
        await model.saveDirtyLayers();
        expect(layer1.isDirty()).toBe(false);
        expect(layer2.isDirty()).toBe(false);
    });
    it("should initialize a new model", async () => {
        const model = await Model.init(testDir, {
            name: "Test Model",
            version: "1.0.0",
            description: "A test model",
        });
        expect(model.rootPath).toBe(testDir);
        expect(model.manifest.name).toBe("Test Model");
        const manifestPath = `${testDir}/documentation-robotics/model/manifest.yaml`;
        expect(await fileExists(manifestPath)).toBe(true);
    });
    it("should load an existing model", async () => {
        // First, initialize a model
        await Model.init(testDir, {
            name: "Test Model",
            version: "1.0.0",
            description: "A test model",
        });
        // Load the model
        const loadedModel = await Model.load(testDir);
        expect(loadedModel.manifest.name).toBe("Test Model");
        expect(loadedModel.manifest.version).toBe("1.0.0");
    });
    it("should get layer names", () => {
        const manifest = new Manifest({
            name: "Test Model",
            version: "1.0.0",
        });
        const model = new Model(testDir, manifest);
        model.addLayer(new Layer("motivation"));
        model.addLayer(new Layer("business"));
        model.addLayer(new Layer("application"));
        const names = model.getLayerNames();
        expect(names).toContain("motivation");
        expect(names).toContain("business");
        expect(names).toContain("application");
        expect(names).toHaveLength(3);
    });
});
//# sourceMappingURL=model.test.js.map
