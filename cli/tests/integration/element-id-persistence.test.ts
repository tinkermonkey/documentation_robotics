/**
 * Integration tests for element id/path persistence
 *
 * Verifies that after `dr add`, the saved YAML file contains:
 * - id: a UUIDv4
 * - path: the human-readable slug {layer}.{type}.{kebab-name}
 * - spec_node_id: {layer}.{type}
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir, GOLDEN_COPY_HOOK_TIMEOUT } from "../helpers/golden-copy.js";
import { spawn } from "child_process";
import * as path from "path";
import { readdir, readFile } from "fs/promises";

interface TestWorkdir {
  path: string;
  cleanup: () => Promise<void>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runCLICommand(
  workdir: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const cliPath = path.join(process.cwd(), "dist", "cli.js");
    const proc = spawn("node", [cliPath, ...args], { cwd: workdir });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });

    proc.on("error", (err) => {
      stderr += err.toString();
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

describe("Element id/path persistence", () => {
  let workdir: TestWorkdir;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  }, GOLDEN_COPY_HOOK_TIMEOUT);

  afterEach(async () => {
    if (workdir) {
      await workdir.cleanup();
    }
  });

  it("should write UUID id and slug path to YAML after dr add", async () => {
    const result = await runCLICommand(workdir.path, [
      "add",
      "motivation",
      "goal",
      "Customer Satisfaction",
      "--description",
      "Increase customer satisfaction score",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain("customer-satisfaction");

    // Find the motivation layer YAML file
    const motivationLayerPath = path.join(
      workdir.path,
      "documentation-robotics",
      "model",
      "01_motivation"
    );

    const files = await readdir(motivationLayerPath);
    const goalFiles = files.filter((f) => f.endsWith(".yaml"));
    expect(goalFiles.length).toBeGreaterThan(0);

    // Read all YAML files and find the new element
    const yaml = await import("yaml");
    let foundElement: any = null;

    for (const file of goalFiles) {
      const filePath = path.join(motivationLayerPath, file);
      const content = await readFile(filePath, "utf-8");
      const data = yaml.parse(content);

      if (data && typeof data === "object") {
        for (const [, value] of Object.entries(data)) {
          const el = value as any;
          if (el && el.path === "motivation.goal.customer-satisfaction") {
            foundElement = el;
            break;
          }
        }
      }

      if (foundElement) break;
    }

    expect(foundElement).not.toBeNull();
    expect(foundElement.path).toBe("motivation.goal.customer-satisfaction");
    expect(foundElement.id).toMatch(UUID_REGEX);
    expect(foundElement.spec_node_id).toBe("motivation.goal");
  });

  it("should use path as YAML key for the element entry", async () => {
    const result = await runCLICommand(workdir.path, [
      "add",
      "motivation",
      "goal",
      "increase-revenue",
    ]);

    expect(result.exitCode).toBe(0);

    const motivationLayerPath = path.join(
      workdir.path,
      "documentation-robotics",
      "model",
      "01_motivation"
    );

    const files = await readdir(motivationLayerPath);
    const yaml = await import("yaml");

    let foundKey: string | null = null;
    let foundElement: any = null;

    for (const file of files.filter((f) => f.endsWith(".yaml"))) {
      const filePath = path.join(motivationLayerPath, file);
      const content = await readFile(filePath, "utf-8");
      const data = yaml.parse(content);

      if (data && typeof data === "object") {
        for (const [key, value] of Object.entries(data)) {
          const el = value as any;
          if (el && el.path === "motivation.goal.increase-revenue") {
            foundKey = key;
            foundElement = el;
            break;
          }
        }
      }

      if (foundElement) break;
    }

    expect(foundElement).not.toBeNull();
    // YAML key should be the path (slug), not a UUID
    expect(foundKey).toBe("motivation.goal.increase-revenue");
    // id inside the element should be a UUID
    expect(foundElement.id).toMatch(UUID_REGEX);
    expect(foundElement.path).toBe("motivation.goal.increase-revenue");
  });
});
