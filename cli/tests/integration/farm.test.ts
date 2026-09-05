/**
 * Farm Command Tests - Test farm initialization, project management, and status
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { FarmManifest } from "../../src/core/farm-manifest.js";
import { fileExists, ensureDir, writeFile } from "../../src/utils/file-io.js";
import { ComposedReferenceValidator } from "../../src/validators/composed-reference-validator.js";
import { Model } from "../../src/core/model.js";

describe("FarmManifest", () => {
  let testDir: string;
  let farmYamlPath: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join("/tmp", `farm-test-${Date.now()}`);
    await ensureDir(testDir);
    farmYamlPath = path.join(testDir, "farm.yaml");
  });

  afterEach(async () => {
    // Clean up test directory
    if (await fileExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should create a new farm manifest", async () => {
    const manifest = FarmManifest.create("Test Farm");

    expect(manifest.name).toBe("Test Farm");
    expect(manifest.projects.size).toBe(0);
    expect(manifest.created).toBeDefined();
    expect(manifest.modified).toBeDefined();
  });

  it("should save and load farm manifest", async () => {
    const manifest = FarmManifest.create("Test Farm");
    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);

    expect(loaded.name).toBe("Test Farm");
    expect(loaded.projects.size).toBe(0);
    expect(loaded.created).toBeDefined();
    expect(loaded.modified).toBeDefined();
  });

  it("should add projects to farm", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
      remote_url: "https://github.com/org/service-a.git",
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "services/service-b",
      model_folder: "service-b-model",
    });

    expect(manifest.projects.size).toBe(2);
    expect(manifest.getProject("service-a")).toBeDefined();
    expect(manifest.getProject("service-b")).toBeDefined();
  });

  it("should remove projects from farm", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    expect(manifest.projects.size).toBe(1);

    const removed = manifest.removeProject("service-a");

    expect(removed).toBe(true);
    expect(manifest.projects.size).toBe(0);
    expect(manifest.getProject("service-a")).toBeUndefined();
  });

  it("should return undefined for non-existent project", async () => {
    const manifest = FarmManifest.create("Test Farm");
    const project = manifest.getProject("non-existent");

    expect(project).toBeUndefined();
  });

  it("should get all projects", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "services/service-b",
      model_folder: "service-b-model",
    });

    const projects = manifest.getAllProjects();

    expect(projects.length).toBe(2);
    expect(projects[0].name).toBe("service-a");
    expect(projects[1].name).toBe("service-b");
  });

  it("should persist and restore full farm state", async () => {
    const manifest = FarmManifest.create("Architecture Farm", {
      platform_view: true,
      sync: { enabled: true, interval: 300 },
    });

    manifest.addProject("api-service", {
      name: "api-service",
      codebase_path: "services/api",
      model_folder: "api-service-model",
      remote_url: "https://github.com/org/api-service.git",
    });

    manifest.addProject("web-service", {
      name: "web-service",
      codebase_path: "services/web",
      model_folder: "web-service-model",
      remote_url: "https://github.com/org/web-service.git",
    });

    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);

    expect(loaded.name).toBe("Architecture Farm");
    expect(loaded.platform_view).toBe(true);
    expect(loaded.sync?.enabled).toBe(true);
    expect(loaded.sync?.interval).toBe(300);
    expect(loaded.projects.size).toBe(2);

    const apiService = loaded.getProject("api-service");
    expect(apiService).toBeDefined();
    expect(apiService?.codebase_path).toBe("services/api");
    expect(apiService?.model_folder).toBe("api-service-model");
    expect(apiService?.remote_url).toBe("https://github.com/org/api-service.git");
  });

  it("should update modified timestamp when adding projects", async () => {
    const manifest = FarmManifest.create("Test Farm");
    const originalModified = manifest.modified;

    // Small delay to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    expect(manifest.modified).not.toBe(originalModified);
  });

  it("should update modified timestamp when removing projects", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    const afterAdd = manifest.modified;
    await new Promise((resolve) => setTimeout(resolve, 10));

    manifest.removeProject("service-a");

    expect(manifest.modified).not.toBe(afterAdd);
  });

  it("should serialize to JSON correctly", async () => {
    const manifest = FarmManifest.create("Test Farm");

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
      remote_url: "https://github.com/org/service-a.git",
    });

    const json = manifest.toJSON();

    expect(json.name).toBe("Test Farm");
    expect(json.projects.hasOwnProperty("service-a")).toBe(true);
    expect(json.projects["service-a"].codebase_path).toBe("services/service-a");
  });

  it("should handle farm with optional fields", async () => {
    const manifest = FarmManifest.create("Simple Farm");
    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);

    expect(loaded.platform_view).toBeUndefined();
    expect(loaded.sync).toBeUndefined();
  });

  it("should throw error on missing name", async () => {
    const invalidYamlPath = path.join(testDir, "invalid.yaml");
    const invalidContent = `
id: test-id
projects: {}
`;

    await fs.writeFile(invalidYamlPath, invalidContent, "utf-8");

    try {
      await FarmManifest.load(invalidYamlPath);
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).toContain("must have a 'name' field");
    }
  });
});

describe("Farm integration with model paths", () => {
  let testDir: string;
  let farmRoot: string;

  beforeEach(async () => {
    testDir = path.join("/tmp", `farm-integration-${Date.now()}`);
    farmRoot = testDir;
    await ensureDir(farmRoot);
  });

  afterEach(async () => {
    if (await fileExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should create farm with multiple projects", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Multi-Project Farm");

    // Add first project
    const serviceACodebase = path.join(farmRoot, "services/service-a");
    const serviceAModel = path.join(farmRoot, "service-a-model");
    await ensureDir(serviceACodebase);
    await ensureDir(serviceAModel);

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    // Add second project
    const serviceBCodebase = path.join(farmRoot, "services/service-b");
    const serviceBModel = path.join(farmRoot, "service-b-model");
    await ensureDir(serviceBCodebase);
    await ensureDir(serviceBModel);

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "services/service-b",
      model_folder: "service-b-model",
    });

    await manifest.save(farmYamlPath);

    // Verify both projects exist
    expect(await fileExists(serviceACodebase)).toBe(true);
    expect(await fileExists(serviceAModel)).toBe(true);
    expect(await fileExists(serviceBCodebase)).toBe(true);
    expect(await fileExists(serviceBModel)).toBe(true);

    // Load and verify
    const loaded = await FarmManifest.load(farmYamlPath);
    expect(loaded.projects.size).toBe(2);
    expect(loaded.getProject("service-a")).toBeDefined();
    expect(loaded.getProject("service-b")).toBeDefined();
  });

  it("should handle nested codebase paths", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Nested Farm");

    const codebasePath = "backend/services/auth-service";
    const modelFolder = "auth-service-model";

    manifest.addProject("auth-service", {
      name: "auth-service",
      codebase_path: codebasePath,
      model_folder: modelFolder,
    });

    await manifest.save(farmYamlPath);

    const loaded = await FarmManifest.load(farmYamlPath);
    const project = loaded.getProject("auth-service");

    expect(project?.codebase_path).toBe(codebasePath);
    expect(project?.model_folder).toBe(modelFolder);
  });
});

describe("Farm validation with cross-model references", () => {
  let testDir: string;
  let farmRoot: string;

  beforeEach(async () => {
    testDir = path.join("/tmp", `farm-validation-${Date.now()}`);
    farmRoot = testDir;
    await ensureDir(farmRoot);
  });

  afterEach(async () => {
    if (await fileExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should create ComposedReferenceValidator from farm", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Test Farm");

    // Create codebase and model directories
    const serviceACodebase = path.join(farmRoot, "service-a");
    const serviceAModel = path.join(farmRoot, "service-a-model");
    const serviceBCodebase = path.join(farmRoot, "service-b");
    const serviceBModel = path.join(farmRoot, "service-b-model");

    await ensureDir(serviceACodebase);
    await ensureDir(serviceAModel);
    await ensureDir(serviceBCodebase);
    await ensureDir(serviceBModel);

    // Create minimal manifest.yaml in each model directory
    const serviceAManifestContent = `
project: service-a
`;
    const serviceBManifestContent = `
project: service-b
`;
    await writeFile(path.join(serviceAModel, "manifest.yaml"), serviceAManifestContent);
    await writeFile(path.join(serviceBModel, "manifest.yaml"), serviceBManifestContent);

    // Add projects to farm
    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "service-a",
      model_folder: "service-a-model",
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "service-b",
      model_folder: "service-b-model",
    });

    await manifest.save(farmYamlPath);

    // Create validator from farm
    const validator = await ComposedReferenceValidator.fromFarm(farmRoot);

    // Verify validator was created
    expect(validator).toBeDefined();
  });

  it("should resolve model paths from farm manifest", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Test Farm");

    // Create codebase and model directories
    const serviceACodebase = path.join(farmRoot, "services", "service-a");
    const serviceAModel = path.join(farmRoot, "service-a-model");
    await ensureDir(serviceACodebase);
    await ensureDir(serviceAModel);

    // Create minimal manifest.yaml in model directory
    const manifestContent = `
project: service-a
`;
    await writeFile(path.join(serviceAModel, "manifest.yaml"), manifestContent);

    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "services/service-a",
      model_folder: "service-a-model",
    });

    await manifest.save(farmYamlPath);

    // Create validator from farm
    const validator = await ComposedReferenceValidator.fromFarm(farmRoot);

    // Verify validator was created for farm with service-a project
    expect(validator).toBeDefined();
  });

  it("should handle farm with multiple projects", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Multi-Service Farm");

    // Create multiple services
    const services = ["auth-service", "api-service", "web-service"];
    for (const service of services) {
      const codebase = path.join(farmRoot, service);
      const modelFolder = path.join(farmRoot, `${service}-model`);
      await ensureDir(codebase);
      await ensureDir(modelFolder);

      // Create minimal manifest.yaml in each model directory
      const manifestContent = `
project: ${service}
`;
      await writeFile(path.join(modelFolder, "manifest.yaml"), manifestContent);

      manifest.addProject(service, {
        name: service,
        codebase_path: service,
        model_folder: `${service}-model`,
      });
    }

    await manifest.save(farmYamlPath);

    // Create validator from farm
    const validator = await ComposedReferenceValidator.fromFarm(farmRoot);

    // Verify validator was created for farm with multiple projects
    expect(validator).toBeDefined();
  });

  it("should validate farm models with cross-model references", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Test Farm");

    // Create two service projects
    const serviceACodebase = path.join(farmRoot, "service-a");
    const serviceADocRobotics = path.join(serviceACodebase, "documentation-robotics");
    const serviceAModel = path.join(serviceADocRobotics, "model");
    const serviceADataModel = path.join(serviceAModel, "08_data-model");

    const serviceBCodebase = path.join(farmRoot, "service-b");
    const serviceBDocRobotics = path.join(serviceBCodebase, "documentation-robotics");
    const serviceBModel = path.join(serviceBDocRobotics, "model");
    const serviceBApi = path.join(serviceBModel, "07_api");

    await ensureDir(serviceADataModel);
    await ensureDir(serviceBApi);

    // Create manifest.yaml for service-a
    const serviceAManifestContent = `
project: service-a
`;
    await writeFile(path.join(serviceAModel, "manifest.yaml"), serviceAManifestContent);

    // Create manifest.yaml for service-b
    const serviceBManifestContent = `
project: service-b
models:
  service-a: {}
`;
    await writeFile(path.join(serviceBModel, "manifest.yaml"), serviceBManifestContent);

    // Create a data entity in service-a (layer 8)
    const entityContent = `user:
  id: user
  path: data-model.entity.user
  spec_node_id: data-model.entity
  type: entity
  layer_id: data-model
  name: User
  description: User entity
`;
    await writeFile(path.join(serviceADataModel, "entity.yaml"), entityContent);

    // Create an API operation in service-b (layer 7) that references service-a's data model (layer 8)
    // This is valid: lower layer (7) references higher layer (8)
    const operationContent = `get-user:
  id: get-user
  path: api.operation.get-user
  spec_node_id: api.operation
  type: operation
  layer_id: api
  name: Get User
  description: Retrieves a user
  attributes:
    operationId: getUser
    summary: Get a user by ID
    tags: users
  references:
    - target: "@service-a/data-model.entity.user"
      relationship: returns
`;
    await writeFile(path.join(serviceBApi, "operation.yaml"), operationContent);

    // Register projects in farm manifest
    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "service-a",
      model_folder: "service-a", // Will use documentation-robotics/model path
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "service-b",
      model_folder: "service-b",
    });

    await manifest.save(farmYamlPath);

    // Create validator from farm
    const validator = await ComposedReferenceValidator.fromFarm(farmRoot);

    // Load service-b's model and validate cross-model references
    const model = await Model.load(serviceBModel);
    const result = await validator.validateModel(model);

    // Validation should pass because the referenced element exists in service-a
    expect(result.isValid()).toBe(true);
  });

  it("should detect broken cross-model references", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Test Farm");

    // Create two service projects
    const serviceACodebase = path.join(farmRoot, "service-a");
    const serviceADocRobotics = path.join(serviceACodebase, "documentation-robotics");
    const serviceAModel = path.join(serviceADocRobotics, "model");
    const serviceADataModel = path.join(serviceAModel, "08_data-model");

    const serviceBCodebase = path.join(farmRoot, "service-b");
    const serviceBDocRobotics = path.join(serviceBCodebase, "documentation-robotics");
    const serviceBModel = path.join(serviceBDocRobotics, "model");
    const serviceBApi = path.join(serviceBModel, "07_api");

    await ensureDir(serviceADataModel);
    await ensureDir(serviceBApi);

    // Create manifest.yaml for service-a
    const serviceAManifestContent = `
project: service-a
`;
    await writeFile(path.join(serviceAModel, "manifest.yaml"), serviceAManifestContent);

    // Create manifest.yaml for service-b
    const serviceBManifestContent = `
project: service-b
models:
  service-a: {}
`;
    await writeFile(path.join(serviceBModel, "manifest.yaml"), serviceBManifestContent);

    // Create a data entity in service-a
    const entityContent = `user:
  id: user
  path: data-model.entity.user
  spec_node_id: data-model.entity
  type: entity
  layer_id: data-model
  name: User
`;
    await writeFile(path.join(serviceADataModel, "entity.yaml"), entityContent);

    // Create an API operation in service-b that references a NON-EXISTENT entity in service-a
    const operationContent = `get-user:
  id: get-user
  path: api.operation.get-user
  spec_node_id: api.operation
  type: operation
  layer_id: api
  name: Get User
  references:
    - target: "@service-a/data-model.entity.non-existent"
      relationship: returns
`;
    await writeFile(path.join(serviceBApi, "operation.yaml"), operationContent);

    // Register projects in farm
    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "service-a",
      model_folder: "service-a",
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "service-b",
      model_folder: "service-b",
    });

    await manifest.save(farmYamlPath);

    // Create validator from farm
    const validator = await ComposedReferenceValidator.fromFarm(farmRoot);

    // Load service-b's model and validate
    const model = await Model.load(serviceBModel);
    const result = await validator.validateModel(model);

    // Should have an error for the broken reference
    expect(result.isValid()).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    // Find the error related to the broken reference
    const brokenRefError = result.errors.find((e) =>
      e.message.includes("Broken qualified reference") || e.message.includes("does not exist")
    );
    expect(brokenRefError).toBeDefined();
  });

  it("should support platform-view project that aggregates and validates across subfolder models", async () => {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = FarmManifest.create("Test Farm");

    // Create service-a project with data model
    const serviceACodebase = path.join(farmRoot, "service-a");
    const serviceADocRobotics = path.join(serviceACodebase, "documentation-robotics");
    const serviceAModel = path.join(serviceADocRobotics, "model");
    const serviceADataModel = path.join(serviceAModel, "08_data-model");

    await ensureDir(serviceADataModel);

    // Create manifest.yaml for service-a
    const serviceAManifestContent = `
project: service-a
`;
    await writeFile(path.join(serviceAModel, "manifest.yaml"), serviceAManifestContent);

    // Create a data entity in service-a
    const entityContent = `user:
  id: user
  path: data-model.entity.user
  spec_node_id: data-model.entity
  type: entity
  layer_id: data-model
  name: User
  description: User entity
`;
    await writeFile(path.join(serviceADataModel, "entity.yaml"), entityContent);

    // Create service-b project with API operation
    const serviceBCodebase = path.join(farmRoot, "service-b");
    const serviceBDocRobotics = path.join(serviceBCodebase, "documentation-robotics");
    const serviceBModel = path.join(serviceBDocRobotics, "model");
    const serviceBApi = path.join(serviceBModel, "07_api");

    await ensureDir(serviceBApi);

    // Create manifest.yaml for service-b
    const serviceBManifestContent = `
project: service-b
`;
    await writeFile(path.join(serviceBModel, "manifest.yaml"), serviceBManifestContent);

    // Create an API operation in service-b
    const operationContent = `get-user:
  id: get-user
  path: api.operation.get-user
  spec_node_id: api.operation
  type: operation
  layer_id: api
  name: Get User
  description: User management API
`;
    await writeFile(path.join(serviceBApi, "operation.yaml"), operationContent);

    // Create platform-view project that references both services
    const platformViewCodebase = path.join(farmRoot, "platform-view");
    const platformViewDocRobotics = path.join(platformViewCodebase, "documentation-robotics");
    const platformViewModel = path.join(platformViewDocRobotics, "model");
    const platformViewBusiness = path.join(platformViewModel, "02_business");

    await ensureDir(platformViewBusiness);

    // Create manifest.yaml for platform-view that declares service-a and service-b
    const platformViewManifestContent = `
project: platform-view
models:
  service-a: {}
  service-b: {}
`;
    await writeFile(path.join(platformViewModel, "manifest.yaml"), platformViewManifestContent);

    // Create a business service that references elements from both services
    // Layer 2 (business) can reference layers 3-13, so it can reference layer 7 (api) and layer 8 (data-model)
    const businessServiceContent = `customer-management:
  id: customer-management
  path: business.service.customer-management
  spec_node_id: business.service
  type: service
  layer_id: business
  name: Customer Management
  description: Manages customer data and interactions
  references:
    - target: "@service-a/data-model.entity.user"
      relationship: manages
    - target: "@service-b/api.operation.get-user"
      relationship: uses
`;
    await writeFile(path.join(platformViewBusiness, "service.yaml"), businessServiceContent);

    // Register all three projects in farm manifest
    manifest.addProject("service-a", {
      name: "service-a",
      codebase_path: "service-a",
      model_folder: "service-a",
    });

    manifest.addProject("service-b", {
      name: "service-b",
      codebase_path: "service-b",
      model_folder: "service-b",
    });

    manifest.addProject("platform-view", {
      name: "platform-view",
      codebase_path: "platform-view",
      model_folder: "platform-view",
    });

    await manifest.save(farmYamlPath);

    // Create validator from farm
    const validator = await ComposedReferenceValidator.fromFarm(farmRoot);

    // Load platform-view model and validate cross-model references
    const platformModel = await Model.load(platformViewModel);
    const result = await validator.validateModel(platformModel);

    // Validation should pass because both referenced elements exist in their respective services
    expect(result.isValid()).toBe(true);
  });
});

describe("Farm model initialization and git setup", () => {
  let testDir: string;
  let farmRoot: string;

  beforeEach(async () => {
    testDir = path.join("/tmp", `farm-model-init-${Date.now()}`);
    farmRoot = testDir;
    await ensureDir(farmRoot);
  });

  afterEach(async () => {
    if (await fileExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it("should initialize model with proper scaffold when adding project", async () => {
    const { farmAddCommand } = await import("../../src/commands/farm.js");
    const farmYamlPath = path.join(farmRoot, "farm.yaml");

    // Initialize farm first
    const farmManifest = FarmManifest.create("Test Farm");
    await farmManifest.save(farmYamlPath);

    // Mock process.cwd to return farm root
    const originalCwd = process.cwd;
    process.cwd = () => farmRoot;

    try {
      // Run farm add command
      await farmAddCommand("test-service", {
        format: "text",
      });

      // Verify model directory structure was created
      const modelPath = path.join(farmRoot, "test-service-model");
      expect(await fileExists(modelPath)).toBe(true);

      // Verify manifest.yaml was created inside documentation-robotics/model/
      const manifestPath = path.join(
        modelPath,
        "documentation-robotics",
        "model",
        "manifest.yaml"
      );
      expect(await fileExists(manifestPath)).toBe(true);

      // Verify layer directories were created
      const layerPaths = [
        "01_motivation",
        "02_business",
        "03_product",
        "04_security",
        "05_application",
        "06_technology",
        "07_api",
        "08_data-model",
        "09_data-store",
        "10_ux",
        "11_navigation",
        "12_apm",
        "13_testing",
      ];

      for (const layer of layerPaths) {
        const layerPath = path.join(modelPath, "documentation-robotics", "model", layer);
        expect(await fileExists(layerPath)).toBe(true);
      }

      // Verify relationships.yaml was created
      const relationshipsPath = path.join(
        modelPath,
        "documentation-robotics",
        "model",
        "relationships.yaml"
      );
      expect(await fileExists(relationshipsPath)).toBe(true);

      // Verify git repository was initialized
      const gitPath = path.join(modelPath, ".git");
      expect(await fileExists(gitPath)).toBe(true);
    } finally {
      process.cwd = originalCwd;
    }
  });
});
