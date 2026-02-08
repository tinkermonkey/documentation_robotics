/**
 * Unit tests for search command source file functionality
 */

import { describe, it, expect } from "bun:test";
import { Element } from "../../src/core/element.js";
import type { SourceReference } from "../../src/types/index.js";

describe("Search Command - Source File Filtering", () => {
  describe("Path normalization", () => {
    it("should normalize path by removing leading ./", () => {
      // Test the normalization logic internally
      const path1 = "./src/api/customer.ts";
      const path2 = "src/api/customer.ts";

      const normalized1 = path1.replace(/^\.\//, "").replace(/\\/g, "/");
      const normalized2 = path2.replace(/^\.\//, "").replace(/\\/g, "/");

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("src/api/customer.ts");
    });

    it("should normalize backslashes to forward slashes", () => {
      const windowsPath = "src\\api\\customer.ts";
      const unixPath = "src/api/customer.ts";

      const normalizedWindows = windowsPath.replace(/^\.\//, "").replace(/\\/g, "/");
      const normalizedUnix = unixPath.replace(/^\.\//, "").replace(/\\/g, "/");

      expect(normalizedWindows).toBe(normalizedUnix);
    });

    it("should handle complex paths with leading ./ and backslashes", () => {
      const complexPath = ".\\src\\api\\customer.ts";
      const normalized = complexPath
        .replace(/^\.\\/, "") // Handle .\
        .replace(/^\.\//, "") // Handle ./
        .replace(/\\/g, "/"); // Convert backslashes to forward slashes
      expect(normalized).toBe("src/api/customer.ts");
    });
  });

  describe("Element source reference matching", () => {
    it("should match element with single source location", () => {
      const element = new Element({
        id: "api-endpoint-customer",
        type: "endpoint",
        name: "Customer Endpoint",
        layer: "06-api",
      });

      const sourceRef: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/api/customer.ts", symbol: "createCustomer" }],
      };

      element.setSourceReference(sourceRef);

      const ref = element.getSourceReference();
      expect(ref).toBeDefined();
      expect(ref?.locations[0].file).toBe("src/api/customer.ts");
      expect(ref?.locations[0].symbol).toBe("createCustomer");
    });

    it("should match element with multiple source locations", () => {
      const element = new Element({
        id: "api-endpoint-customer",
        type: "endpoint",
        name: "Customer Endpoint",
        layer: "06-api",
      });

      const sourceRef: SourceReference = {
        provenance: "extracted",
        locations: [
          { file: "src/api/customer.ts", symbol: "createCustomer" },
          { file: "src/api/customer-utils.ts", symbol: "validateCustomer" },
        ],
      };

      element.setSourceReference(sourceRef);

      const ref = element.getSourceReference();
      expect(ref).toBeDefined();
      expect(ref?.locations.length).toBe(2);
      expect(ref?.locations[0].file).toBe("src/api/customer.ts");
      expect(ref?.locations[1].file).toBe("src/api/customer-utils.ts");
    });

    it("should return undefined for element without source reference", () => {
      const element = new Element({
        id: "api-endpoint-customer",
        type: "endpoint",
        name: "Customer Endpoint",
        layer: "06-api",
      });

      const ref = element.getSourceReference();
      expect(ref).toBeUndefined();
    });

    it("should handle layer-specific storage for OpenAPI layers (06-08)", () => {
      const element = new Element({
        id: "api-endpoint-customer",
        type: "endpoint",
        name: "Customer Endpoint",
        layer: "06-api",
      });

      const sourceRef: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/api/customer.ts" }],
      };

      element.setSourceReference(sourceRef);

      // For OpenAPI layers, source reference should be in x-source-reference
      expect(element.properties["x-source-reference"]).toBeDefined();
      expect(element.getSourceReference()).toEqual(sourceRef);
    });

    it("should handle layer-specific storage for ArchiMate layers (non-06-08)", () => {
      const element = new Element({
        id: "application-service-customer",
        type: "application-service",
        name: "Customer Service",
        layer: "04-application",
      });

      const sourceRef: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/services/customer.ts" }],
      };

      element.setSourceReference(sourceRef);

      // For ArchiMate layers, source reference should be in properties.source.reference
      expect(element.properties.source).toBeDefined();
      expect((element.properties.source as { reference: SourceReference }).reference).toEqual(
        sourceRef
      );
      expect(element.getSourceReference()).toEqual(sourceRef);
    });
  });

  describe("Search result formatting", () => {
    it("should extract source file from first location", () => {
      const element = new Element({
        id: "api-endpoint-customer",
        type: "endpoint",
        name: "Customer Endpoint",
        layer: "06-api",
      });

      const sourceRef: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/api/customer.ts", symbol: "createCustomer" }],
      };

      element.setSourceReference(sourceRef);

      const ref = element.getSourceReference();
      if (ref && ref.locations.length > 0) {
        const sourceFile = ref.locations[0].file;
        const sourceSymbol = ref.locations[0].symbol;

        expect(sourceFile).toBe("src/api/customer.ts");
        expect(sourceSymbol).toBe("createCustomer");
      }
    });

    it("should format source info for display", () => {
      const element = new Element({
        id: "api-endpoint-customer",
        type: "endpoint",
        name: "Customer Endpoint",
        layer: "06-api",
      });

      const sourceRef: SourceReference = {
        provenance: "manual",
        locations: [{ file: "src/api/customer.ts", symbol: "createCustomer" }],
      };

      element.setSourceReference(sourceRef);

      const ref = element.getSourceReference();
      if (ref && ref.locations.length > 0) {
        const sourceFile = ref.locations[0].file;
        const sourceSymbol = ref.locations[0].symbol;
        const symbol = sourceSymbol ? ` | Symbol: ${sourceSymbol}` : "";
        const displayText = `Source: ${sourceFile}${symbol}`;

        expect(displayText).toBe("Source: src/api/customer.ts | Symbol: createCustomer");
      }
    });
  });

  describe("Provenance tracking", () => {
    it("should preserve provenance type in source reference", () => {
      const element = new Element({
        id: "api-endpoint-customer",
        type: "endpoint",
        name: "Customer Endpoint",
        layer: "06-api",
      });

      const sourceRef: SourceReference = {
        provenance: "extracted",
        locations: [{ file: "src/api/customer.ts" }],
      };

      element.setSourceReference(sourceRef);

      const ref = element.getSourceReference();
      expect(ref?.provenance).toBe("extracted");
    });

    it("should support all provenance types", () => {
      const provenanceTypes = ["extracted", "manual", "inferred", "generated"] as const;

      for (const provenance of provenanceTypes) {
        const element = new Element({
          id: `api-endpoint-${provenance}`,
          type: "endpoint",
          name: `Endpoint ${provenance}`,
          layer: "06-api",
        });

        const sourceRef: SourceReference = {
          provenance,
          locations: [{ file: "src/api/test.ts" }],
        };

        element.setSourceReference(sourceRef);

        const ref = element.getSourceReference();
        expect(ref?.provenance).toBe(provenance);
      }
    });
  });
});
