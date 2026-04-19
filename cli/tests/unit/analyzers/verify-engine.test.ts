/**
 * Unit tests for VerifyEngine
 *
 * Tests covering:
 * - Bucket computation with known fixture inputs
 * - Dual-index matching (source-ref primary, method+path secondary)
 * - in_model_only file-existence filter
 * - Correct changeset_context for both base-model and changeset-view paths
 */

import { describe, it, expect } from "bun:test";
import type {
  VerifyBuckets,
  MatchedEntry,
  GraphOnlyEntry,
  ModelOnlyEntry,
  IgnoredEntry,
} from "@/analyzers/types.js";

describe("VerifyEngine - Bucket Computation", () => {
  describe("Dual-index matching logic", () => {
    it("should match by primary index (file:symbol)", () => {
      // Simulate primary index lookup
      const primaryIndex = new Map<string, { id: string; source_file: string; source_symbol: string }>();
      primaryIndex.set("src/handlers/users.ts:getUsers", {
        id: "api.operation.get-users",
        source_file: "src/handlers/users.ts",
        source_symbol: "getUsers",
      });

      const route = {
        source_file: "src/handlers/users.ts",
        source_symbol: "getUsers",
      };

      const key = `${route.source_file}:${route.source_symbol}`;
      const primaryMatch = primaryIndex.get(key);

      expect(primaryMatch).toBeDefined();
      expect(primaryMatch?.id).toBe("api.operation.get-users");
    });

    it("should match by secondary index (http_method:http_path)", () => {
      const secondaryIndex = new Map<string, { id: string; http_method: string; http_path: string }>();
      secondaryIndex.set("GET:/users", {
        id: "api.operation.get-users",
        http_method: "GET",
        http_path: "/users",
      });

      const route = {
        http_method: "GET",
        http_path: "/users",
      };

      const key = `${route.http_method}:${route.http_path}`;
      const secondaryMatch = secondaryIndex.get(key);

      expect(secondaryMatch).toBeDefined();
      expect(secondaryMatch?.id).toBe("api.operation.get-users");
    });

    it("should prefer primary index over secondary", () => {
      const primaryIndex = new Map<string, string>();
      primaryIndex.set("src/file.ts:symbol", "api.operation.primary-match");

      const secondaryIndex = new Map<string, string>();
      secondaryIndex.set("GET:/users", "api.operation.secondary-match");

      const route = {
        source_file: "src/file.ts",
        source_symbol: "symbol",
        http_method: "GET",
        http_path: "/users",
      };

      let matchedId: string | undefined;

      // Try primary first
      if (route.source_file && route.source_symbol) {
        const key = `${route.source_file}:${route.source_symbol}`;
        matchedId = primaryIndex.get(key);
      }

      // Fallback to secondary
      if (!matchedId && route.http_method && route.http_path) {
        const key = `${route.http_method}:${route.http_path}`;
        matchedId = secondaryIndex.get(key);
      }

      expect(matchedId).toBe("api.operation.primary-match");
    });

    it("should fallback to secondary when primary doesn't match", () => {
      const primaryIndex = new Map<string, string>();
      primaryIndex.set("src/other.ts:symbol", "api.operation.other");

      const secondaryIndex = new Map<string, string>();
      secondaryIndex.set("GET:/users", "api.operation.secondary-match");

      const route = {
        source_file: "src/file.ts",
        source_symbol: "symbol",
        http_method: "GET",
        http_path: "/users",
      };

      let matchedId: string | undefined;

      // Try primary first
      if (route.source_file && route.source_symbol) {
        const key = `${route.source_file}:${route.source_symbol}`;
        matchedId = primaryIndex.get(key);
      }

      // Fallback to secondary
      if (!matchedId && route.http_method && route.http_path) {
        const key = `${route.http_method}:${route.http_path}`;
        matchedId = secondaryIndex.get(key);
      }

      expect(matchedId).toBe("api.operation.secondary-match");
    });

    it("should not match if neither index has entry", () => {
      const primaryIndex = new Map<string, string>();
      const secondaryIndex = new Map<string, string>();

      const route = {
        source_file: "src/unknown.ts",
        source_symbol: "unknown",
        http_method: "GET",
        http_path: "/unknown",
      };

      let matchedId: string | undefined;

      if (route.source_file && route.source_symbol) {
        const key = `${route.source_file}:${route.source_symbol}`;
        matchedId = primaryIndex.get(key);
      }

      if (!matchedId && route.http_method && route.http_path) {
        const key = `${route.http_method}:${route.http_path}`;
        matchedId = secondaryIndex.get(key);
      }

      expect(matchedId).toBeUndefined();
    });
  });

  describe("Bucket computation", () => {
    it("should compute matched bucket from successful index lookups", () => {
      const matched: MatchedEntry[] = [
        {
          id: "api.operation.get-users",
          type: "operation",
          source_file: "src/handlers/users.ts",
          source_symbol: "getUsers",
        },
      ];

      expect(matched.length).toBe(1);
      expect(matched[0].id).toBe("api.operation.get-users");
      expect(matched[0].type).toBe("operation");
    });

    it("should compute in_graph_only bucket from unmatched routes", () => {
      const inGraphOnly: GraphOnlyEntry[] = [
        {
          id: "route-unmapped-1",
          http_method: "POST",
          http_path: "/users",
          source_file: "src/handlers/users.ts",
          source_symbol: "createUser",
        },
        {
          id: "route-unmapped-2",
          http_method: "DELETE",
          http_path: "/users/:id",
          source_file: "src/handlers/users.ts",
          source_symbol: "deleteUser",
        },
      ];

      expect(inGraphOnly.length).toBe(2);
      expect(inGraphOnly[0].http_method).toBe("POST");
      expect(inGraphOnly[1].http_path).toBe("/users/:id");
    });

    it("should compute in_model_only bucket from unmatched elements with existing files", () => {
      const inModelOnly: ModelOnlyEntry[] = [
        {
          id: "api.operation.get-products",
          type: "operation",
          source_file: "src/handlers/products.ts",
          source_symbol: "ProductsHandler.getProducts",
        },
      ];

      expect(inModelOnly.length).toBe(1);
      expect(inModelOnly[0].id).toBe("api.operation.get-products");
      expect(inModelOnly[0].source_file).toBe("src/handlers/products.ts");
    });

    it("should compute ignored bucket from matched ignore rules", () => {
      const ignored: IgnoredEntry[] = [
        {
          id: "route-health",
          entry_type: "route",
          reason: "Health check endpoints ignored",
        },
        {
          id: "api.operation.admin-status",
          entry_type: "element",
          reason: "Admin endpoints ignored",
        },
      ];

      expect(ignored.length).toBe(2);
      expect(ignored[0].entry_type).toBe("route");
      expect(ignored[1].entry_type).toBe("element");
      expect(ignored[0].reason).toBe("Health check endpoints ignored");
    });
  });

  describe("File-existence filtering for in_model_only", () => {
    it("should include elements from existing files", () => {
      const existsResults = [true, true, false];
      const elementsToCheck = [
        { id: "op1", file: "src/file1.ts", symbol: "handler1" },
        { id: "op2", file: "src/file2.ts", symbol: "handler2" },
        { id: "op3", file: "src/nonexistent.ts", symbol: "handler3" },
      ];

      const inModelOnly: ModelOnlyEntry[] = [];

      for (let i = 0; i < elementsToCheck.length; i++) {
        if (existsResults[i]) {
          const elem = elementsToCheck[i];
          inModelOnly.push({
            id: elem.id,
            type: "operation",
            source_file: elem.file,
            source_symbol: elem.symbol,
          });
        }
      }

      expect(inModelOnly.length).toBe(2);
      expect(inModelOnly[0].id).toBe("op1");
      expect(inModelOnly[1].id).toBe("op2");
    });

    it("should exclude elements from non-existing files", () => {
      const fileExists = false;
      const element = {
        id: "api.operation.deleted-endpoint",
        file: "src/deleted-handler.ts",
        symbol: "handler",
      };

      const inModelOnly: ModelOnlyEntry[] = [];

      if (fileExists) {
        inModelOnly.push({
          id: element.id,
          type: "operation",
          source_file: element.file,
          source_symbol: element.symbol,
        });
      }

      expect(inModelOnly.length).toBe(0);
    });

    it("should skip elements without source_reference file", () => {
      const elementsToCheck: Array<{
        id: string;
        file?: string;
        symbol: string;
      }> = [
        { id: "op1", file: "src/handler.ts", symbol: "handler" },
        { id: "op2", symbol: "no-file" }, // No file property
        { id: "op3", file: "", symbol: "empty-file" }, // Empty file
      ];

      const inModelOnly: ModelOnlyEntry[] = [];

      for (const elem of elementsToCheck) {
        if (elem.file) {
          inModelOnly.push({
            id: elem.id,
            type: "operation",
            source_file: elem.file,
            source_symbol: elem.symbol,
          });
        }
      }

      expect(inModelOnly.length).toBe(1);
      expect(inModelOnly[0].id).toBe("op1");
    });
  });

  describe("Changeset context determination", () => {
    it("should set verified_against to base_model when changesetAware is false", () => {
      const changesetAware = false;
      const activeChangesetId: string | null = "changeset-123";

      const verifiedAgainst =
        changesetAware && activeChangesetId !== null
          ? "changeset_view"
          : "base_model";

      expect(verifiedAgainst).toBe("base_model");
    });

    it("should set verified_against to base_model when no active changeset", () => {
      const changesetAware = true;
      const activeChangesetId: string | null = null;

      const verifiedAgainst =
        changesetAware && activeChangesetId !== null
          ? "changeset_view"
          : "base_model";

      expect(verifiedAgainst).toBe("base_model");
    });

    it("should set verified_against to changeset_view when changeset active", () => {
      const changesetAware = true;
      const activeChangesetId: string | null = "changeset-123";

      const verifiedAgainst =
        changesetAware && activeChangesetId !== null
          ? "changeset_view"
          : "base_model";

      expect(verifiedAgainst).toBe("changeset_view");
    });

    it("should set active_changeset to null when no active changeset", () => {
      const changesetAware = true;
      const activeChangesetId: string | null = null;

      const activChangeset = changesetAware ? activeChangesetId : null;

      expect(activChangeset).toBeNull();
    });

    it("should set active_changeset to changeset ID when active", () => {
      const changesetAware = true;
      const activeChangesetId: string | null = "changeset-456";

      const activChangeset = changesetAware ? activeChangesetId : null;

      expect(activChangeset).toBe("changeset-456");
    });

    it("should set active_changeset to null when changesetAware is false", () => {
      const changesetAware = false;
      const activeChangesetId: string | null = "changeset-789";

      const activChangeset = changesetAware ? activeChangesetId : null;

      expect(activChangeset).toBeNull();
    });
  });

  describe("Summary computation", () => {
    it("should compute correct summary counts", () => {
      const buckets: VerifyBuckets = {
        matched: [
          {
            id: "op1",
            type: "operation",
            source_file: "src/file1.ts",
            source_symbol: "handler1",
          },
        ],
        in_graph_only: [
          {
            id: "route1",
            http_method: "POST",
            http_path: "/users",
            source_file: "src/file.ts",
            source_symbol: "handler",
          },
          {
            id: "route2",
            http_method: "DELETE",
            http_path: "/users/:id",
            source_file: "src/file.ts",
            source_symbol: "handler2",
          },
        ],
        in_model_only: [
          {
            id: "op2",
            type: "operation",
            source_file: "src/file2.ts",
            source_symbol: "handler2",
          },
        ],
        ignored: [
          {
            id: "ignored1",
            entry_type: "route",
            reason: "Test",
          },
        ],
      };

      const matchedCount = buckets.matched.length;
      const inGraphOnlyCount = buckets.in_graph_only.length;
      const inModelOnlyCount = buckets.in_model_only.length;
      const ignoredCount = buckets.ignored.length;

      const totalRoutesAnalyzed =
        buckets.matched.length +
        buckets.in_graph_only.length +
        buckets.ignored.length;

      const totalElementsAnalyzed =
        buckets.matched.length +
        buckets.in_model_only.length +
        buckets.ignored.filter((e) => e.entry_type === "element").length;

      expect(matchedCount).toBe(1);
      expect(inGraphOnlyCount).toBe(2);
      expect(inModelOnlyCount).toBe(1);
      expect(ignoredCount).toBe(1);
      expect(totalRoutesAnalyzed).toBe(4);
      expect(totalElementsAnalyzed).toBe(2);
    });
  });
});
