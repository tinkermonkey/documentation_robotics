/**
 * Unit tests for source reference functionality
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Element } from "../../src/core/element";
import type {
  SourceReference,
  SourceLocation,
  RepositoryContext,
  ProvenanceType,
} from "../../src/types/source-reference";

describe("SourceReference Types", () => {
  describe("SourceLocation", () => {
    it("should create a SourceLocation with file only", () => {
      const location: SourceLocation = {
        file: "src/services/auth.ts",
      };
      expect(location.file).toBe("src/services/auth.ts");
      expect(location.symbol).toBeUndefined();
    });

    it("should create a SourceLocation with file and symbol", () => {
      const location: SourceLocation = {
        file: "src/services/auth.ts",
        symbol: "AuthService.login",
      };
      expect(location.file).toBe("src/services/auth.ts");
      expect(location.symbol).toBe("AuthService.login");
    });
  });

  describe("RepositoryContext", () => {
    it("should create a RepositoryContext with URL only", () => {
      const context: RepositoryContext = {
        url: "https://github.com/example/repo.git",
      };
      expect(context.url).toBe("https://github.com/example/repo.git");
      expect(context.commit).toBeUndefined();
    });

    it("should create a RepositoryContext with commit only", () => {
      const context: RepositoryContext = {
        commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b",
      };
      expect(context.commit).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b");
      expect(context.url).toBeUndefined();
    });

    it("should create a RepositoryContext with both URL and commit", () => {
      const context: RepositoryContext = {
        url: "https://github.com/example/repo.git",
        commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b",
      };
      expect(context.url).toBe("https://github.com/example/repo.git");
      expect(context.commit).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b");
    });
  });

  describe("SourceReference", () => {
    it("should create a basic SourceReference with single location", () => {
      const reference: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/main.ts" }],
      };
      expect(reference.provenance).toBe("manual");
      expect(reference.locations).toHaveLength(1);
      expect(reference.locations[0].file).toBe("src/main.ts");
      expect(reference.repository).toBeUndefined();
    });

    it("should create a SourceReference with multiple locations", () => {
      const reference: SourceReference = {
        provenance: "extracted",
        locations: [
          { file: "src/services/auth.ts", symbol: "AuthService" },
          { file: "src/services/auth-utils.ts", symbol: "validateToken" },
        ],
      };
      expect(reference.provenance).toBe("extracted");
      expect(reference.locations).toHaveLength(2);
    });

    it("should create a SourceReference with repository context", () => {
      const reference: SourceReference = {
        provenance: "inferred",
        locations: [{ file: "src/main.ts" }],
        repository: {
          url: "https://github.com/example/repo.git",
          commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b",
        },
      };
      expect(reference.repository?.url).toBe("https://github.com/example/repo.git");
      expect(reference.repository?.commit).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b");
    });

    it("should support all ProvenanceType values", () => {
      const provenances: ProvenanceType[] = ["extracted", "manual", "inferred", "generated"];
      provenances.forEach((provenance) => {
        const reference: SourceReference = {
          provenance,
          locations: [{ file: "src/main.ts" }],
        };
        expect(reference.provenance).toBe(provenance);
      });
    });
  });
});

describe("Element Source Reference Methods", () => {
  let element: Element;

  beforeEach(() => {
    element = new Element({
      id: "api-endpoint-create-user",
      type: "APIEndpoint",
      name: "Create User",
      layer: "06-api",
    });
  });

  describe("getSourceReference()", () => {
    it("should return undefined when no source reference exists", () => {
      expect(element.getSourceReference()).toBeUndefined();
    });

    it("should return source reference when set", () => {
      const reference: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/routes/users.ts", symbol: "POST /users" }],
      };
      element.source_reference = reference;

      const result = element.getSourceReference();
      expect(result).toEqual(reference);
      expect(result?.provenance).toBe("manual");
      expect(result?.locations[0].file).toBe("src/routes/users.ts");
    });

    it("should return source reference from different provenance types", () => {
      const provenances: Array<{ type: SourceReference["provenance"]; name: string }> = [
        { type: "manual", name: "manual" },
        { type: "extracted", name: "extracted" },
        { type: "inferred", name: "inferred" },
        { type: "generated", name: "generated" },
      ];

      provenances.forEach(({ type }) => {
        const reference: SourceReference = {
          provenance: type,
          locations: [{ file: "src/test.ts" }],
        };
        element.source_reference = reference;

        expect(element.getSourceReference()).toEqual(reference);
        expect(element.getSourceReference()?.provenance).toBe(type);
      });
    });
  });

  describe("setSourceReference()", () => {
    it("should set source reference when provided", () => {
      const reference: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/routes/users.ts" }],
      };

      element.setSourceReference(reference);
      expect(element.source_reference).toEqual(reference);
      expect(element.getSourceReference()).toEqual(reference);
    });

    it("should set source reference with multiple locations", () => {
      const reference: SourceReference = {
        provenance: "extracted",
        locations: [
          { file: "src/models/user.ts", symbol: "User" },
          { file: "src/models/user-utils.ts", symbol: "validateUser" },
        ],
      };

      element.setSourceReference(reference);
      expect(element.getSourceReference()).toEqual(reference);
      expect(element.getSourceReference()?.locations).toHaveLength(2);
    });

    it("should set source reference with repository context", () => {
      const reference: SourceReference = {
        provenance: "generated",
        locations: [{ file: "migrations/001_create_users.sql" }],
        repository: {
          url: "https://github.com/example/repo.git",
          commit: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b",
        },
      };

      element.setSourceReference(reference);
      expect(element.getSourceReference()).toEqual(reference);
      expect(element.getSourceReference()?.repository?.url).toBe(
        "https://github.com/example/repo.git"
      );
    });

    it("should overwrite existing source reference", () => {
      const oldReference: SourceReference = {
        provenance: "manual",
        locations: [{ file: "old.ts" }],
      };
      const newReference: SourceReference = {
        provenance: "extracted",
        locations: [{ file: "new.ts" }],
      };

      element.setSourceReference(oldReference);
      expect(element.getSourceReference()).toEqual(oldReference);

      element.setSourceReference(newReference);
      expect(element.getSourceReference()).toEqual(newReference);
    });

    it("should clear source reference when set to undefined", () => {
      const reference: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/main.ts" }],
      };

      element.setSourceReference(reference);
      expect(element.getSourceReference()).toEqual(reference);

      element.setSourceReference(undefined);
      expect(element.getSourceReference()).toBeUndefined();
    });
  });

  describe("hasSourceReference()", () => {
    it("should return false when no source reference exists", () => {
      expect(element.hasSourceReference()).toBe(false);
    });

    it("should return true when source reference exists", () => {
      const reference: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/main.ts" }],
      };
      element.setSourceReference(reference);

      expect(element.hasSourceReference()).toBe(true);
    });

    it("should return false after clearing source reference", () => {
      const reference: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/main.ts" }],
      };
      element.setSourceReference(reference);
      expect(element.hasSourceReference()).toBe(true);

      element.setSourceReference(undefined);
      expect(element.hasSourceReference()).toBe(false);
    });
  });
});
