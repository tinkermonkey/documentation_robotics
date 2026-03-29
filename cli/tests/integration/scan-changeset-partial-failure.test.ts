import { describe, it, expect, beforeAll, afterEach, afterAll, spyOn } from "bun:test";
import { stageChangeset } from "../../src/commands/scan.js";
import { StagedChangesetStorage } from "../../src/core/staged-changeset-storage.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import { type ElementCandidate, type RelationshipCandidate } from "../../src/scan/pattern-loader.js";
import * as path from "path";
import * as fs from "fs";

describe("stageChangeset - Partial Failure Path", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;

  beforeAll(async () => {
    workdir = await createTestWorkdir();
  });

  afterEach(async () => {
    // Clean up changesets between tests
    const changesetsDir = path.join(
      workdir.path,
      "documentation-robotics",
      "changesets"
    );
    if (fs.existsSync(changesetsDir)) {
      const entries = fs.readdirSync(changesetsDir);
      for (const entry of entries) {
        const entryPath = path.join(changesetsDir, entry);
        if (fs.statSync(entryPath).isDirectory()) {
          fs.rmSync(entryPath, { recursive: true });
        }
      }
    }
  });

  afterAll(async () => {
    await workdir.cleanup();
  });

  describe("success path", () => {
    it("stages all candidates successfully when no errors occur", async () => {
      const elementCandidates: ElementCandidate[] = [
        {
          id: "api.endpoint.get-users",
          type: "endpoint",
          layer: "api",
          name: "Get Users",
          confidence: 0.95,
          attributes: { method: "GET", path: "/users" },
          source: { file: "routes.ts", line: 10 }
        },
        {
          id: "api.endpoint.create-user",
          type: "endpoint",
          layer: "api",
          name: "Create User",
          confidence: 0.9,
          attributes: { method: "POST", path: "/users" },
          source: { file: "routes.ts", line: 20 }
        }
      ];

      const relationshipCandidates: RelationshipCandidate[] = [
        {
          id: "api.endpoint.get-users::calls::api.endpoint.create-user",
          sourceId: "api.endpoint.get-users",
          targetId: "api.endpoint.create-user",
          relationshipType: "calls",
          layer: "api",
          confidence: 0.85,
          attributes: { category: "functional" },
          source: { file: "routes.ts", line: 15 }
        }
      ];

      const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

      // Should have no warnings in success path
      expect(warnings.length).toBe(0);

      // Verify the changeset was created
      const storage = new StagedChangesetStorage(workdir.path);
      const changesets = fs.readdirSync(path.join(workdir.path, "documentation-robotics", "changesets"));
      expect(changesets.length).toBe(1);

      const changesetId = changesets[0];
      const changeset = await storage.load(changesetId);
      expect(changeset).toBeDefined();
      expect(changeset?.changes.length).toBe(3); // 2 elements + 1 relationship
    });
  });

  describe("partial failure - element candidates", () => {
    it("handles failure to stage specific element candidates", async () => {
      const elementCandidates: ElementCandidate[] = [
        {
          id: "api.endpoint.valid-1",
          type: "endpoint",
          layer: "api",
          name: "Valid Endpoint 1",
          confidence: 0.95,
          attributes: {}
        },
        {
          id: "api.endpoint.valid-2",
          type: "endpoint",
          layer: "api",
          name: "Valid Endpoint 2",
          confidence: 0.9,
          attributes: {}
        }
      ];

      const relationshipCandidates: RelationshipCandidate[] = [];

      // Mock the storage's create method to return a changeset with a failing addChange method
      // We'll use a test spy to track calls and simulate failures
      let callCount = 0;
      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        const originalAddChange = changeset.addChange.bind(changeset);

        // Mock addChange to fail on the second call
        changeset.addChange = function(...args: any[]) {
          callCount++;
          if (callCount === 2) {
            throw new Error("Simulated failure: element validation failed");
          }
          return originalAddChange(...args);
        };

        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // Should have warnings about the failed element
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.includes("Failed to stage"))).toBe(true);
        expect(warnings.some((w) => w.includes("element"))).toBe(true);

        // Verify the successful candidate was still staged
        const storage = new StagedChangesetStorage(workdir.path);
        const changesets = fs.readdirSync(path.join(workdir.path, "documentation-robotics", "changesets"));
        expect(changesets.length).toBe(1);

        const changeset = await storage.load(changesets[0]);
        expect(changeset).toBeDefined();
        // Should have 1 successful element change (the second one failed)
        expect(changeset?.changes.length).toBe(1);
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });

    it("returns warning messages detailing which elements failed", async () => {
      const elementCandidates: ElementCandidate[] = [
        {
          id: "api.endpoint.test-1",
          type: "endpoint",
          layer: "api",
          name: "Test 1",
          confidence: 0.9,
          attributes: {}
        }
      ];

      const relationshipCandidates: RelationshipCandidate[] = [];

      // Mock the changeset to always fail
      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        changeset.addChange = function() {
          throw new Error("Schema validation error");
        };
        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // Should have warning about failed element
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]).toContain("Failed to stage 1 element");
        expect(warnings.some((w) => w.includes("api.endpoint.test-1"))).toBe(true);
        expect(warnings.some((w) => w.includes("Schema validation error"))).toBe(true);
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });
  });

  describe("partial failure - relationship candidates", () => {
    it("handles failure to stage specific relationship candidates", async () => {
      const elementCandidates: ElementCandidate[] = [];

      const relationshipCandidates: RelationshipCandidate[] = [
        {
          id: "api.endpoint.a::calls::api.endpoint.b",
          sourceId: "api.endpoint.a",
          targetId: "api.endpoint.b",
          relationshipType: "calls",
          layer: "api",
          confidence: 0.9,
          attributes: {}
        },
        {
          id: "api.endpoint.b::calls::api.endpoint.c",
          sourceId: "api.endpoint.b",
          targetId: "api.endpoint.c",
          relationshipType: "calls",
          layer: "api",
          confidence: 0.85,
          attributes: {}
        }
      ];

      let callCount = 0;
      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        const originalAddChange = changeset.addChange.bind(changeset);

        // Mock addChange to fail on the second call (first relationship)
        changeset.addChange = function(...args: any[]) {
          callCount++;
          if (callCount === 2) { // Second call is the first relationship
            throw new Error("Simulated failure: relationship target not found");
          }
          return originalAddChange(...args);
        };

        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // Should have warnings about failed relationship
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.includes("Failed to stage"))).toBe(true);
        expect(warnings.some((w) => w.includes("relationship"))).toBe(true);

        // Verify the successful relationship was still staged
        const storage = new StagedChangesetStorage(workdir.path);
        const changesets = fs.readdirSync(path.join(workdir.path, "documentation-robotics", "changesets"));
        expect(changesets.length).toBe(1);

        const changeset = await storage.load(changesets[0]);
        expect(changeset?.changes.length).toBe(1); // One successful relationship
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });

    it("returns warning messages detailing which relationships failed", async () => {
      const elementCandidates: ElementCandidate[] = [];

      const relationshipCandidates: RelationshipCandidate[] = [
        {
          id: "api.endpoint.x::calls::api.endpoint.y",
          sourceId: "api.endpoint.x",
          targetId: "api.endpoint.y",
          relationshipType: "calls",
          layer: "api",
          confidence: 0.9,
          attributes: {}
        }
      ];

      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        changeset.addChange = function() {
          throw new Error("Invalid relationship predicate");
        };
        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // Should have warning about failed relationship with details
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]).toContain("Failed to stage 1 relationship");
        expect(warnings.some((w) => w.includes("api.endpoint.x"))).toBe(true);
        expect(warnings.some((w) => w.includes("api.endpoint.y"))).toBe(true);
        expect(warnings.some((w) => w.includes("Invalid relationship predicate"))).toBe(true);
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });
  });

  describe("mixed failures - elements and relationships", () => {
    it("handles failures in both element and relationship candidates", async () => {
      const elementCandidates: ElementCandidate[] = [
        {
          id: "api.endpoint.e1",
          type: "endpoint",
          layer: "api",
          name: "Endpoint 1",
          confidence: 0.9,
          attributes: {}
        },
        {
          id: "api.endpoint.e2",
          type: "endpoint",
          layer: "api",
          name: "Endpoint 2",
          confidence: 0.85,
          attributes: {}
        }
      ];

      const relationshipCandidates: RelationshipCandidate[] = [
        {
          id: "api.endpoint.e1::calls::api.endpoint.e2",
          sourceId: "api.endpoint.e1",
          targetId: "api.endpoint.e2",
          relationshipType: "calls",
          layer: "api",
          confidence: 0.9,
          attributes: {}
        }
      ];

      let callCount = 0;
      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        const originalAddChange = changeset.addChange.bind(changeset);

        // Fail on second element and the relationship
        changeset.addChange = function(...args: any[]) {
          callCount++;
          // callCount 1: first element (succeeds)
          // callCount 2: second element (fails)
          // callCount 3: first relationship (fails)
          if (callCount === 2 || callCount === 3) {
            throw new Error("Simulated failure");
          }
          return originalAddChange(...args);
        };

        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // Should have warnings for both elements and relationships
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.includes("element"))).toBe(true);
        expect(warnings.some((w) => w.includes("relationship"))).toBe(true);

        // Verify changesets with partial success
        const storage = new StagedChangesetStorage(workdir.path);
        const changesets = fs.readdirSync(path.join(workdir.path, "documentation-robotics", "changesets"));
        const changeset = await storage.load(changesets[0]);

        // Should have 1 successful change (1 element only, relationship failed)
        expect(changeset?.changes.length).toBe(1);
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });
  });

  describe("changeset persistence", () => {
    it("saves changeset even when some candidates fail", async () => {
      const elementCandidates: ElementCandidate[] = [
        {
          id: "api.endpoint.persist-test-1",
          type: "endpoint",
          layer: "api",
          name: "Test 1",
          confidence: 0.9,
          attributes: {}
        }
      ];

      const relationshipCandidates: RelationshipCandidate[] = [];

      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        changeset.addChange = function() {
          throw new Error("Processing error");
        };
        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // Changeset directory should exist even though all candidates failed
        const changesetsDir = path.join(workdir.path, "documentation-robotics", "changesets");
        const changesets = fs.readdirSync(changesetsDir);
        expect(changesets.length).toBe(1);

        // The changeset should be loadable (empty changes array is valid)
        const storage = new StagedChangesetStorage(workdir.path);
        const changeset = await storage.load(changesets[0]);
        expect(changeset).toBeDefined();
        expect(changeset?.changes.length).toBe(0); // No successful changes
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });
  });

  describe("warning message formatting", () => {
    it("formats warning messages with proper pluralization for relationships", async () => {
      const elementCandidates: ElementCandidate[] = [];

      const relationshipCandidates: RelationshipCandidate[] = [
        {
          id: "api.endpoint.single::calls::api.endpoint.target",
          sourceId: "api.endpoint.single",
          targetId: "api.endpoint.target",
          relationshipType: "calls",
          layer: "api",
          confidence: 0.9,
          attributes: {}
        }
      ];

      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        changeset.addChange = function() {
          throw new Error("Test error");
        };
        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // With singular count, should use singular form
        expect(warnings.some((w) => w.includes("1 relationship"))).toBe(true);
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });

    it("formats warning messages with proper pluralization for elements", async () => {
      const elementCandidates: ElementCandidate[] = [
        {
          id: "api.endpoint.plural-1",
          type: "endpoint",
          layer: "api",
          name: "Endpoint 1",
          confidence: 0.9,
          attributes: {}
        },
        {
          id: "api.endpoint.plural-2",
          type: "endpoint",
          layer: "api",
          name: "Endpoint 2",
          confidence: 0.9,
          attributes: {}
        }
      ];

      const relationshipCandidates: RelationshipCandidate[] = [];

      const originalCreate = StagedChangesetStorage.prototype.create;

      const mockCreate = async function (this: StagedChangesetStorage, id: string, name: string, description: string | undefined, baseSnapshot: string) {
        const changeset = await originalCreate.call(this, id, name, description, baseSnapshot);
        changeset.addChange = function() {
          throw new Error("Test error");
        };
        return changeset;
      };

      spyOn(StagedChangesetStorage.prototype, "create").mockImplementation(mockCreate as any);

      try {
        const warnings = await stageChangeset(elementCandidates, relationshipCandidates, workdir.path);

        // With plural count, should use plural form
        expect(warnings.some((w) => w.includes("2 element(s)"))).toBe(true);
      } finally {
        (StagedChangesetStorage.prototype.create as any).mockRestore?.();
      }
    });
  });
});
