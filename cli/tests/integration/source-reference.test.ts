/**
 * Integration tests for source reference CLI functionality
 * Tests the add, update, and show commands with source reference options
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTempWorkdir, runDr as runDrHelper } from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> };

/**
 * Wrapper around the cli-runner helper
 */
async function runDr(
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runDrHelper(args, { cwd: tempDir.path });
}

describe("Source Reference CLI Integration Tests", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
    // Initialize a model for testing
    await runDr("init", "--name", "Test Model");
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("add command with source references", () => {
    it("should add element with source-file and source-provenance", async () => {
      const result = await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-validate",
        "--name",
        "Auth Validation",
        "--source-file",
        "src/auth/validator.ts",
        "--source-provenance",
        "extracted"
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Added element");
    });

    it("should add element with all source reference options", async () => {
      const result = await runDr(
        "add",
        "api",
        "operation",
        "create-customer",
        "--name",
        "Create Customer Operation",
        "--source-file",
        "src/api/endpoints/customer.ts",
        "--source-symbol",
        "createCustomer",
        "--source-provenance",
        "extracted",
        "--source-repo-remote",
        "https://github.com/example/repo.git",
        "--source-repo-commit",
        "1234567890123456789012345678901234567890"
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Added element");
    });

    it("should fail when source-file is missing but other source options provided", async () => {
      const result = await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-policy",
        "--source-symbol",
        "validateAuth",
        "--source-provenance",
        "extracted"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--source-file is required");
    });

    it("should fail when source-provenance is missing but source-file provided", async () => {
      const result = await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-policy",
        "--source-file",
        "src/auth/policy.ts"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--source-provenance is required");
    });

    it("should fail with invalid provenance value", async () => {
      const result = await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "invalid"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --source-provenance");
    });

    it("should fail with invalid commit SHA", async () => {
      const result = await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted",
        "--source-repo-remote",
        "https://github.com/example/repo.git",
        "--source-repo-commit",
        "not-a-valid-sha"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --source-repo-commit value");
    });

    it("should fail when source-repo-commit provided without source-repo-remote", async () => {
      const result = await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted",
        "--source-repo-commit",
        "1234567890123456789012345678901234567890"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--source-repo-remote is required");
    });

    it("should fail when source-repo-remote provided without source-repo-commit", async () => {
      const result = await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted",
        "--source-repo-remote",
        "https://github.com/example/repo.git"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--source-repo-commit is required");
    });

    it("should support all valid provenance types", async () => {
      const provenanceTypes = ["extracted", "manual", "inferred", "generated"];

      for (let i = 0; i < provenanceTypes.length; i++) {
        const result = await runDr(
          "add",
          "security",
          "securitypolicy",
          `policy-${provenanceTypes[i]}`,
          "--name",
          `Policy ${provenanceTypes[i]}`,
          "--source-file",
          "src/auth/policy.ts",
          "--source-provenance",
          provenanceTypes[i]
        );

        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe("update command with source references", () => {
    beforeEach(async () => {
      // Create an element to update
      await runDr("add", "security", "securitypolicy", "auth-policy", "--name", "Auth Policy");
    });

    it("should update element to add source reference", async () => {
      const result = await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted"
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Updated element");
    });

    it("should update element with all source reference options", async () => {
      const result = await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--source-file",
        "src/auth/updated-policy.ts",
        "--source-symbol",
        "PolicyValidator",
        "--source-provenance",
        "manual",
        "--source-repo-remote",
        "https://github.com/example/repo.git",
        "--source-repo-commit",
        "1234567890123456789012345678901234567890"
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Updated element");
    });

    it("should clear source reference when --clear-source-reference provided", async () => {
      // First add source reference
      await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted"
      );

      // Then clear it
      const result = await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--clear-source-reference"
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Updated element");
    });

    it("should fail when using --clear-source-reference with other source options", async () => {
      const result = await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--clear-source-reference",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Cannot use --clear-source-reference");
    });

    it("should fail with invalid commit SHA during update", async () => {
      const result = await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted",
        "--source-repo-remote",
        "https://github.com/example/repo.git",
        "--source-repo-commit",
        "invalid-sha"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid --source-repo-commit value");
    });

    it("should allow updating only some source reference fields", async () => {
      // Add initial source reference
      await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--source-file",
        "src/auth/policy.ts",
        "--source-provenance",
        "extracted",
        "--source-symbol",
        "OldFunction"
      );

      // Update to different file and provenance
      const result = await runDr(
        "update",
        "security.securitypolicy.auth-policy",
        "--source-file",
        "src/auth/new-policy.ts",
        "--source-provenance",
        "manual"
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("show command displaying source references", () => {
    beforeEach(async () => {
      // Create element with source reference
      await runDr(
        "add",
        "security",
        "securitypolicy",
        "auth-policy",
        "--name",
        "Auth Policy",
        "--source-file",
        "src/auth/validator.ts",
        "--source-symbol",
        "validateToken",
        "--source-provenance",
        "extracted",
        "--source-repo-remote",
        "https://github.com/example/repo.git",
        "--source-repo-commit",
        "1234567890123456789012345678901234567890"
      );
    });

    it("should display source reference information in show command", async () => {
      const result = await runDr("show", "security.securitypolicy.auth-policy");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Source Code Location");
      expect(result.stdout).toContain("Provenance");
      expect(result.stdout).toContain("extracted");
      expect(result.stdout).toContain("src/auth/validator.ts");
      expect(result.stdout).toContain("validateToken");
    });

    it("should display repository context in show command", async () => {
      const result = await runDr("show", "security.securitypolicy.auth-policy");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Repository Context");
      expect(result.stdout).toContain("https://github.com/example/repo.git");
      expect(result.stdout).toContain("1234567890123456789012345678901234567890");
    });

    it("should not display source section when element has no source reference", async () => {
      // Create element without source reference
      await runDr(
        "add",
        "security",
        "securitypolicy",
        "no-source-policy",
        "--name",
        "Policy Without Source"
      );

      const result = await runDr("show", "security.securitypolicy.no-source-policy");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("Source Code Location");
    });

    it("should display source reference without symbol when not provided", async () => {
      // Create element with source reference but no symbol
      await runDr(
        "add",
        "security",
        "securitypolicy",
        "simple-policy",
        "--name",
        "Simple Policy",
        "--source-file",
        "src/policy.ts",
        "--source-provenance",
        "manual"
      );

      const result = await runDr("show", "security.securitypolicy.simple-policy");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Source Code Location");
      expect(result.stdout).toContain("src/policy.ts");
      // Symbol should not be in output
      expect(result.stdout).not.toContain("Symbol:");
    });

    it("should display source reference without repository when not provided", async () => {
      // Create element with source reference but no repository context
      await runDr(
        "add",
        "security",
        "securitypolicy",
        "no-repo-policy",
        "--name",
        "Policy Without Repo",
        "--source-file",
        "src/policy.ts",
        "--source-provenance",
        "manual"
      );

      const result = await runDr("show", "security.securitypolicy.no-repo-policy");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Source Code Location");
      expect(result.stdout).not.toContain("Repository Context");
    });
  });

  describe("end-to-end workflow with source references", () => {
    it("should support complete workflow: add, update, and display", async () => {
      // Step 1: Add element with initial source reference
      const addResult = await runDr(
        "add",
        "application",
        "applicationcomponent",
        "auth-service",
        "--name",
        "Authentication Service",
        "--description",
        "Core authentication component",
        "--source-file",
        "src/services/auth.ts",
        "--source-provenance",
        "extracted"
      );
      expect(addResult.exitCode).toBe(0);

      // Step 2: Update to add symbol and repository context
      const updateResult = await runDr(
        "update",
        "application.applicationcomponent.auth-service",
        "--source-file",
        "src/services/auth.ts",
        "--source-symbol",
        "AuthService",
        "--source-provenance",
        "extracted",
        "--source-repo-remote",
        "https://github.com/example/app.git",
        "--source-repo-commit",
        "abcdef1234567890abcdef1234567890abcdef12"
      );
      expect(updateResult.exitCode).toBe(0);

      // Step 3: Display and verify all information
      const showResult = await runDr("show", "application.applicationcomponent.auth-service");
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stdout).toContain("Authentication Service");
      expect(showResult.stdout).toContain("Core authentication component");
      expect(showResult.stdout).toContain("Source Code Location");
      expect(showResult.stdout).toContain("extracted");
      expect(showResult.stdout).toContain("src/services/auth.ts");
      expect(showResult.stdout).toContain("AuthService");
      expect(showResult.stdout).toContain("Repository Context");
      expect(showResult.stdout).toContain("https://github.com/example/app.git");
    });
  });
});
