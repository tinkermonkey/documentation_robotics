import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { CopilotIntegrationManager } from "@/integrations/copilot-manager";

/**
 * Test implementation of CopilotIntegrationManager that allows mocking getProjectRoot
 */
class TestableCopilotIntegrationManager extends CopilotIntegrationManager {
  private mockProjectRoot: string | null = null;

  setMockProjectRoot(root: string): void {
    this.mockProjectRoot = root;
  }

  protected async getProjectRoot(): Promise<string> {
    if (this.mockProjectRoot) {
      return this.mockProjectRoot;
    }
    return super.getProjectRoot();
  }
}

/**
 * Test suite for CopilotIntegrationManager non-TTY guard implementation
 * Tests that the manager properly handles non-TTY environments for:
 * - install() - requires --force flag
 * - upgrade() - requires --force flag
 * - remove() - requires --force flag
 */
describe.serial("CopilotIntegrationManager - Non-TTY Guards", () => {
  let tempDir: string;
  let targetDir: string;
  let projectRoot: string;
  let manager: TestableCopilotIntegrationManager;

  beforeEach(async () => {
    // Create temporary directories
    tempDir = await mkdtemp(join(tmpdir(), "dr-copilot-manager-test-"));
    projectRoot = tempDir;
    targetDir = join(projectRoot, ".github");

    // Create project structure
    await mkdir(targetDir, { recursive: true });

    // Mock the manager
    manager = new TestableCopilotIntegrationManager();
    manager.setMockProjectRoot(projectRoot);
  });

  afterEach(async () => {
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("install() - non-TTY behavior", () => {
    it("should throw error in non-TTY when confirming overwrite without --force", async () => {
      // Setup: Create version file to trigger overwrite prompt
      const versionFile = join(targetDir, ".dr-copilot-version");
      await mkdir(dirname(versionFile), { recursive: true });
      await writeFile(versionFile, 'version: "0.1.0"\ninstalled_at: "2024-01-01T00:00:00Z"', "utf-8");

      // Mock stdin/stdout to be non-TTY
      const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

      try {
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

        // Should throw error because non-TTY can't show confirmation prompt
        let threwError = false;
        let errorMessage = "";
        try {
          await manager.install({ force: false });
        } catch (error) {
          threwError = true;
          errorMessage = (error as Error).message;
        }

        expect(threwError).toBe(true);
        expect(errorMessage).toContain("Interactive confirmation");
        expect(errorMessage).toContain("non-TTY");
        expect(errorMessage).toContain("--force");
      } finally {
        // Restore original properties
        if (originalIsTTY) {
          Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
        }
        if (originalStdoutIsTTY) {
          Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
        }
      }
    });

    it("should skip TTY check when --force is used in non-TTY", async () => {
      // Setup: Create version file to trigger overwrite prompt
      const versionFile = join(targetDir, ".dr-copilot-version");
      await mkdir(dirname(versionFile), { recursive: true });
      await writeFile(versionFile, 'version: "0.1.0"\ninstalled_at: "2024-01-01T00:00:00Z"', "utf-8");

      // Mock stdin/stdout to be non-TTY
      const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

      try {
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

        // With --force, it should skip the TTY check (may fail for other reasons)
        let ttyErrorThrown = false;
        try {
          await manager.install({ force: true });
        } catch (error) {
          // Check that it's not a TTY error - that's the key test
          const message = (error as Error).message;
          if (message.includes("Interactive confirmation")) {
            ttyErrorThrown = true;
          }
        }

        expect(ttyErrorThrown).toBe(false);
      } finally {
        // Restore original properties
        if (originalIsTTY) {
          Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
        }
        if (originalStdoutIsTTY) {
          Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
        }
      }
    });
  });

  describe("upgrade() - non-TTY behavior", () => {
    beforeEach(async () => {
      // Setup: Create a version file so isInstalled() returns true
      const versionFile = join(targetDir, ".dr-copilot-version");
      await mkdir(dirname(versionFile), { recursive: true });
      await writeFile(
        versionFile,
        `version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  agents: {}
  skills: {}
`,
        "utf-8"
      );
    });

    it("should not silently exit in non-TTY without --force (throws error instead)", async () => {
      // Mock stdin/stdout to be non-TTY
      const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

      try {
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

        // The key requirement: should NOT silently exit with code 0
        // It should throw an error instead of returning gracefully
        let threwError = false;
        try {
          await manager.upgrade({ force: false });
        } catch (error) {
          threwError = true;
        }

        // Must throw an error (not silently exit)
        expect(threwError).toBe(true);
      } finally {
        // Restore original properties
        if (originalIsTTY) {
          Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
        }
        if (originalStdoutIsTTY) {
          Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
        }
      }
    });

    it("should skip TTY check when --force is used in non-TTY", async () => {
      // Mock stdin/stdout to be non-TTY
      const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

      try {
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

        // With --force, it should skip the TTY check (may fail for other reasons)
        let ttyErrorThrown = false;
        try {
          await manager.upgrade({ force: true });
        } catch (error) {
          // Check that it's not a TTY error - that's the key test
          const message = (error as Error).message;
          if (message.includes("Interactive confirmation")) {
            ttyErrorThrown = true;
          }
        }

        expect(ttyErrorThrown).toBe(false);
      } finally {
        // Restore original properties
        if (originalIsTTY) {
          Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
        }
        if (originalStdoutIsTTY) {
          Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
        }
      }
    });
  });

  describe("remove() - non-TTY behavior", () => {
    beforeEach(async () => {
      // Setup: Create a version file so isInstalled() returns true
      const versionFile = join(targetDir, ".dr-copilot-version");
      await mkdir(dirname(versionFile), { recursive: true });
      await writeFile(
        versionFile,
        `version: "0.1.0"
installed_at: "2024-01-01T00:00:00Z"
components:
  agents: {}
  skills: {}
`,
        "utf-8"
      );

      // Create component directories so they can be removed
      await mkdir(join(targetDir, "agents"), { recursive: true });
      await mkdir(join(targetDir, "skills"), { recursive: true });
    });

    it("should throw error in non-TTY when confirming removal without --force", async () => {
      // Mock stdin/stdout to be non-TTY
      const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

      try {
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

        // Should throw error because non-TTY can't show confirmation prompt
        let threwError = false;
        let errorMessage = "";
        try {
          await manager.remove({ force: false });
        } catch (error) {
          threwError = true;
          errorMessage = (error as Error).message;
        }

        expect(threwError).toBe(true);
        expect(errorMessage).toContain("Interactive confirmation");
        expect(errorMessage).toContain("non-TTY");
        expect(errorMessage).toContain("--force");
      } finally {
        // Restore original properties
        if (originalIsTTY) {
          Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
        }
        if (originalStdoutIsTTY) {
          Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
        }
      }
    });

    it("should not throw error when --force is used in non-TTY", async () => {
      // Mock stdin/stdout to be non-TTY
      const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

      try {
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

        // Should NOT throw because --force skips the confirmation
        let threwError = false;
        try {
          await manager.remove({ force: true });
        } catch (error) {
          // Any error is a failure - remove with --force should succeed even in non-TTY
          threwError = true;
          console.error("Unexpected error:", error);
        }

        // We expect the remove to proceed
        expect(threwError).toBe(false);
      } finally {
        // Restore original properties
        if (originalIsTTY) {
          Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
        }
        if (originalStdoutIsTTY) {
          Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
        }
      }
    });
  });
});
