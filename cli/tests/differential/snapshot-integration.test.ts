import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { captureSnapshot, diffSnapshots, formatComparisonResults } from "./snapshot-engine";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { cp } from "node:fs/promises";

/**
 * Integration test example showing how to use snapshot engine
 * to compare model states before and after CLI command execution
 */

/**
 * Create a temporary directory
 */
function createTempDir(): string {
  const dir = join(tmpdir(), `snapshot-integration-${randomBytes(8).toString("hex")}`);
  return dir;
}

/**
 * Clean up temporary directory
 */
async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a simple test model structure (simulating baseline model)
 */
async function createTestModel(baseDir: string): Promise<void> {
  // Create directory structure
  const modelDir = join(baseDir, "documentation-robotics", "model");
  await mkdir(join(modelDir, "01_motivation"), { recursive: true });
  await mkdir(join(modelDir, "02_business"), { recursive: true });

  // Create manifest
  await writeFile(
    join(baseDir, "documentation-robotics", "model", "manifest.yaml"),
    `name: Test Model
version: 0.1.0
layers:
  motivation:
    count: 1
  business:
    count: 0
`
  );

  // Create motivation layer
  await writeFile(
    join(modelDir, "01_motivation", "goals.yaml"),
    `goal-001:
  id: motivation-goal-goal-001
  name: Initial Goal
  description: This is a test goal
`
  );

  // Create empty business layer
  await writeFile(join(modelDir, "02_business", "services.yaml"), "# No services yet\n");
}

describe("Snapshot Engine Integration", () => {
  let baseDir: string;
  let pythonCliDir: string;
  let tsCliDir: string;

  beforeEach(async () => {
    baseDir = createTempDir();
    pythonCliDir = join(baseDir, "python-cli");
    tsCliDir = join(baseDir, "ts-cli");

    // Create baseline model
    await mkdir(pythonCliDir, { recursive: true });
    await mkdir(tsCliDir, { recursive: true });

    await createTestModel(pythonCliDir);
    await cp(pythonCliDir, tsCliDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupDir(baseDir);
  });

  test("captures baseline model state", async () => {
    const snapshot = await captureSnapshot(pythonCliDir);

    // Should have captured the manifest and layer files
    expect(snapshot.files.size).toBeGreaterThan(0);
    expect(snapshot.files.has("documentation-robotics/model/manifest.yaml")).toBe(true);
    expect(snapshot.files.has("documentation-robotics/model/01_motivation/goals.yaml")).toBe(true);

    // Verify file metadata is captured
    const manifest = snapshot.files.get("documentation-robotics/model/manifest.yaml")!;
    expect(manifest.exists).toBe(true);
    expect(manifest.hash).toBeDefined();
    expect(manifest.size).toBeGreaterThan(0);
    expect(manifest.mtime).toBeGreaterThan(0);
  });

  test("detects additions in model", async () => {
    // Capture initial state
    const before = await captureSnapshot(pythonCliDir);

    // Simulate adding a new element to the model
    const goalsFile = join(
      pythonCliDir,
      "documentation-robotics",
      "model",
      "01_motivation",
      "goals.yaml"
    );
    const newContent = `goal-001:
  id: motivation-goal-goal-001
  name: Initial Goal
  description: This is a test goal

goal-002:
  id: motivation-goal-goal-002
  name: New Goal
  description: This is a new goal added by the CLI
`;
    await writeFile(goalsFile, newContent);

    // Capture state after modification
    const after = await captureSnapshot(pythonCliDir);

    // Compare snapshots
    const changes = await diffSnapshots(before, after, pythonCliDir);

    // Should detect the modified goals file
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe("modified");
    expect(changes[0].path).toContain("goals.yaml");
    expect(changes[0].beforeHash).toBeDefined();
    expect(changes[0].afterHash).toBeDefined();
    expect(changes[0].beforeHash).not.toBe(changes[0].afterHash);
  });

  test("compares parallel CLI executions", async () => {
    // Capture baseline for both CLIs
    const pythonBefore = await captureSnapshot(pythonCliDir);
    const tsBefore = await captureSnapshot(tsCliDir);

    // Both should be identical initially
    expect(pythonBefore.files.size).toBe(tsBefore.files.size);

    // Simulate Python CLI adding a new business service
    const pythonServicesFile = join(
      pythonCliDir,
      "documentation-robotics",
      "model",
      "02_business",
      "services.yaml"
    );
    await writeFile(
      pythonServicesFile,
      `service-001:
  id: business-service-service-001
  name: Customer Service
  description: Service to manage customers
`
    );

    // Simulate TypeScript CLI adding a new business service (with slightly different format)
    const tsServicesFile = join(
      tsCliDir,
      "documentation-robotics",
      "model",
      "02_business",
      "services.yaml"
    );
    await writeFile(
      tsServicesFile,
      `service-001:
  id: business-service-service-001
  name: Customer Service
  description: Service to manage customers
`
    );

    // Capture after changes
    const pythonAfter = await captureSnapshot(pythonCliDir);
    const tsAfter = await captureSnapshot(tsCliDir);

    // Compare each CLI's changes
    const pythonChanges = await diffSnapshots(pythonBefore, pythonAfter, pythonCliDir);
    const tsChanges = await diffSnapshots(tsBefore, tsAfter, tsCliDir);

    // Both should detect the same files changed
    expect(pythonChanges.length).toBe(tsChanges.length);
    expect(pythonChanges[0].path).toBe(tsChanges[0].path);

    // Check if both CLIs produced the same hash
    // If hashes match, this indicates perfect compatibility
    if (pythonChanges[0].afterHash === tsChanges[0].afterHash) {
      // CLIs produced identical output - verify the hash is set
      expect(pythonChanges[0].afterHash).toBeDefined();
      expect(tsChanges[0].afterHash).toBeDefined();
    }
  });

  test("filters comparison to specific layers", async () => {
    // Capture initial state
    const before = await captureSnapshot(pythonCliDir);

    // Modify files in both layers
    await writeFile(
      join(pythonCliDir, "documentation-robotics", "model", "01_motivation", "goals.yaml"),
      "modified goals"
    );
    await writeFile(
      join(pythonCliDir, "documentation-robotics", "model", "02_business", "services.yaml"),
      "modified services"
    );

    const after = await captureSnapshot(pythonCliDir);

    // Filter to only motivation layer
    const motivationChanges = await diffSnapshots(before, after, pythonCliDir, {
      filterPaths: ["documentation-robotics/model/01_motivation/"],
    });

    expect(motivationChanges.length).toBe(1);
    expect(motivationChanges[0].path).toContain("01_motivation");
    expect(motivationChanges.some((c) => c.path.includes("02_business"))).toBe(false);

    // Filter to both layers
    const allChanges = await diffSnapshots(before, after, pythonCliDir, {
      filterPaths: [
        "documentation-robotics/model/01_motivation/",
        "documentation-robotics/model/02_business/",
      ],
    });

    expect(allChanges.length).toBe(2);
  });

  test("generates detailed diff output", async () => {
    const before = await captureSnapshot(pythonCliDir);

    // Modify the goals file
    const goalsFile = join(
      pythonCliDir,
      "documentation-robotics",
      "model",
      "01_motivation",
      "goals.yaml"
    );
    const newContent = `goal-001:
  id: motivation-goal-goal-001
  name: Updated Goal Name
  description: Updated description
`;
    await writeFile(goalsFile, newContent);

    const after = await captureSnapshot(pythonCliDir);
    const changes = await diffSnapshots(before, after, pythonCliDir, { generateDiffs: true });

    // Should have generated a diff
    expect(changes.length).toBe(1);
    expect(changes[0].diff).toBeDefined();

    // Format for display
    const summary = formatComparisonResults(changes);
    expect(summary).toContain("Modified");
    expect(summary).toContain("goals.yaml");
  });

  test("detects file creation and deletion", async () => {
    const before = await captureSnapshot(pythonCliDir);

    // Add a new file in the model (not in hidden directory)
    const newElementFile = join(
      pythonCliDir,
      "documentation-robotics",
      "model",
      "01_motivation",
      "constraints.yaml"
    );
    await writeFile(newElementFile, "constraint-001:\n  name: Test Constraint\n");

    const after = await captureSnapshot(pythonCliDir);
    const changes = await diffSnapshots(before, after, pythonCliDir);

    // Should detect the new file
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe("added");
    expect(changes[0].path).toContain("constraints.yaml");
  });

  test("performance with realistic model structure", async () => {
    const modelDir = join(pythonCliDir, "documentation-robotics", "model");

    // Create ~60 files to simulate realistic model
    const startTime = Date.now();

    for (let layer = 1; layer <= 12; layer++) {
      const layerName = `0${String(layer).padStart(2, "0")}_layer`;
      const layerDir = join(modelDir, layerName);
      await mkdir(layerDir, { recursive: true });

      // Create 5 files per layer
      const types = ["goals", "actors", "services", "components", "operations"];
      for (const type of types) {
        await writeFile(
          join(layerDir, `${type}.yaml`),
          `# ${layerName} - ${type}\n${"item: item\n".repeat(10)}`
        );
      }
    }

    const created = Date.now() - startTime;

    // Capture snapshot
    const snapshotStart = Date.now();
    const snapshot = await captureSnapshot(pythonCliDir);
    const snapshotTime = Date.now() - snapshotStart;

    // Should capture all files
    expect(snapshot.files.size).toBeGreaterThanOrEqual(60);

    // Snapshot should complete in reasonable time
    expect(snapshotTime).toBeLessThan(2000);
  });
});
