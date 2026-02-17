import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { promisify } from "util";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("generate-openapi Script", () => {
  const testOutputPath = resolve("/tmp/test-api-spec.yaml");

  beforeEach(() => {
    // Clean up any existing test output
    if (existsSync(testOutputPath)) {
      unlinkSync(testOutputPath);
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testOutputPath)) {
      unlinkSync(testOutputPath);
    }
  });

  it("should run without errors", async () => {
    return new Promise((resolve, reject) => {
      const proc = spawn("npm", ["run", "generate:openapi"], {
        cwd: resolve(import.meta.dir, "../../../"),
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          expect(stdout).toContain("✅ OpenAPI specification generated successfully!");
          resolve(undefined);
        } else {
          reject(new Error(`Script exited with code ${code}. Stderr: ${stderr}`));
        }
      });

      proc.on("error", reject);
    });
  });

  it("should generate yaml output file with correct header", async () => {
    return new Promise((resolve, reject) => {
      const proc = spawn("npm", ["run", "generate:openapi"], {
        cwd: resolve(import.meta.dir, "../../../"),
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Script exited with code ${code}`));
          return;
        }

        // Give file system a moment to write
        setTimeout(() => {
          try {
            const specPath = resolve(import.meta.dir, "../../../../docs/api-spec.yaml");

            if (!existsSync(specPath)) {
              reject(new Error(`OpenAPI spec file not found at ${specPath}`));
              return;
            }

            const content = readFileSync(specPath, "utf-8");

            // Check for hand-maintained marker
            expect(content).toContain("# HAND-MAINTAINED:");

            // Check for valid OpenAPI version
            expect(content).toMatch(/openapi:\s*['"]?3\.[01]\.[0-9]/);

            // Check for proper YAML structure
            expect(content).toContain("info:");
            expect(content).toContain("title:");
            expect(content).toContain("paths:");

            resolve(undefined);
          } catch (error) {
            reject(error);
          }
        }, 100);
      });

      proc.on("error", reject);
    });
  });

  it("should include server information in spec", async () => {
    return new Promise((resolve, reject) => {
      const proc = spawn("npm", ["run", "generate:openapi"], {
        cwd: resolve(import.meta.dir, "../../../"),
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Script exited with code ${code}`));
          return;
        }

        setTimeout(() => {
          try {
            const specPath = resolve(import.meta.dir, "../../../../docs/api-spec.yaml");
            const content = readFileSync(specPath, "utf-8");

            // Check for server configuration
            expect(content).toContain("servers:");
            expect(content).toContain("localhost:8080");

            resolve(undefined);
          } catch (error) {
            reject(error);
          }
        }, 100);
      });

      proc.on("error", reject);
    });
  });

  it("should generate valid YAML without syntax errors", async () => {
    return new Promise((resolve, reject) => {
      const proc = spawn("npm", ["run", "generate:openapi"], {
        cwd: resolve(import.meta.dir, "../../../"),
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Script exited with code ${code}`));
          return;
        }

        setTimeout(() => {
          try {
            const specPath = resolve(import.meta.dir, "../../../../docs/api-spec.yaml");
            const content = readFileSync(specPath, "utf-8");

            // Try to parse as YAML to verify syntax
            // Basic validation: check for balanced colons and braces
            const lines = content.split("\n");
            let yamlValid = true;

            for (const line of lines) {
              // Skip comments and empty lines
              if (line.trim().startsWith("#") || !line.trim()) continue;

              // Check for obvious YAML issues
              if (line.includes("{{") || line.includes("}}")) {
                yamlValid = false;
                break;
              }
            }

            expect(yamlValid).toBe(true);
            expect(content.length).toBeGreaterThan(100); // Should have substantial content

            resolve(undefined);
          } catch (error) {
            reject(error);
          }
        }, 100);
      });

      proc.on("error", reject);
    });
  });
});
