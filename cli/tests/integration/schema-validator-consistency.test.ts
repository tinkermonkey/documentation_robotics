/**
 * Integration tests for schema-validator consistency
 *
 * Verifies that `dr schema node` introspection output matches what `dr add` actually accepts.
 * This catches bugs where schema introspection and the attribute validator diverge.
 *
 * Issue: #522
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestWorkdir, GOLDEN_COPY_HOOK_TIMEOUT } from "../helpers/golden-copy.js";
import { runDr } from "../helpers/cli-runner.js";
import { Model } from "../../src/core/model.js";
import { findElementBySemanticId } from "../helpers/element-finder.js";

/**
 * Parse schema node output to extract required attributes
 * Expected format:
 *   Required Attributes:
 *     - name: string
 *     - in: string [query | header | path | cookie]
 */
function extractRequiredAttributesFromSchemaOutput(schemaOutput: string): string[] {
  const requiredSection = schemaOutput.match(
    /Required Attributes:(.+?)(?:Optional Attributes:|$)/s
  );
  if (!requiredSection) {
    return [];
  }

  const attributeLines = requiredSection[1].trim().split("\n");
  const attributes: string[] = [];

  for (const line of attributeLines) {
    const match = line.match(/^\s*-\s+(\w+):/);
    if (match) {
      attributes.push(match[1]);
    }
  }

  return attributes;
}

/**
 * Test suite: Schema validator consistency
 *
 * For each test node type:
 * 1. Get schema metadata via `dr schema node`
 * 2. Extract required attributes
 * 3. Construct `dr add` with exactly those attributes
 * 4. Verify exit code 0 (no validation errors)
 * 5. Verify no "unexpected property" or "missing required property" errors
 * 6. Verify persisted element by reloading model
 * 7. Run `dr validate` and verify 0 schema errors
 */
describe("Schema Validator Consistency", () => {
  let workdir: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    workdir = await createTestWorkdir();
  }, GOLDEN_COPY_HOOK_TIMEOUT);

  afterEach(async () => {
    if (workdir) {
      await workdir.cleanup();
    }
  });

  describe("api.parameter", () => {
    const specNodeId = "api.parameter";
    const layer = "api";
    const type = "parameter";

    it("should accept required attributes from schema introspection", async () => {
      // Step 1: Get schema metadata
      const schemaResult = await runDr(
        ["schema", "node", specNodeId],
        { cwd: workdir.path }
      );

      expect(schemaResult.exitCode, "schema command failed").toBe(0);
      const requiredAttributes = extractRequiredAttributesFromSchemaOutput(
        schemaResult.stdout
      );

      // api.parameter should have "in" as required
      expect(requiredAttributes).toContain("in");
      expect(requiredAttributes.length).toBeGreaterThan(0);

      // Step 2 & 3: Construct dr add with required attributes
      // For api.parameter with "in" required, use "query" as valid value
      const addResult = await runDr(
        [
          "add",
          layer,
          type,
          "test-param",
          "--attributes",
          JSON.stringify({ in: "query" }),
        ],
        { cwd: workdir.path }
      );

      // Step 4: Verify exit code 0
      expect(
        addResult.exitCode,
        `Failed to add ${specNodeId}: ${addResult.stderr || addResult.stdout}`
      ).toBe(0);

      // Step 5: Verify no validation errors in output
      const output = addResult.stdout + addResult.stderr;
      expect(output).not.toContain("unexpected property");
      expect(output).not.toContain("missing required property");

      // Step 6: Verify element persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      expect(layerObj).toBeDefined();

      const element = findElementBySemanticId(layerObj!, `${layer}.${type}.test-param`);
      expect(element).toBeDefined();
      expect(element!.name).toBe("test-param");
      expect(element!.attributes.in).toBe("query");

      // Step 7: Run validate and verify 0 schema errors
      const validateResult = await runDr(
        ["validate", "--schemas"],
        { cwd: workdir.path }
      );
      expect(validateResult.exitCode, "validate command failed").toBe(0);
    });

    it("should accept all valid enum values for 'in' attribute", async () => {
      const validInValues = ["query", "header", "path", "cookie"];

      for (const inValue of validInValues) {
        const addResult = await runDr(
          [
            "add",
            layer,
            type,
            `param-${inValue}`,
            "--attributes",
            JSON.stringify({ in: inValue }),
          ],
          { cwd: workdir.path }
        );

        expect(
          addResult.exitCode,
          `Failed for in="${inValue}": ${addResult.stderr || addResult.stdout}`
        ).toBe(0);
      }

      // Verify all were persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      expect(layerObj).toBeDefined();

      for (const inValue of validInValues) {
        const element = findElementBySemanticId(
          layerObj!,
          `${layer}.${type}.param-${inValue}`
        );
        expect(element).toBeDefined();
        expect(element!.attributes.in).toBe(inValue);
      }
    });
  });

  describe("api.operation", () => {
    const specNodeId = "api.operation";
    const layer = "api";
    const type = "operation";

    it("should accept required attributes from schema introspection", async () => {
      // Step 1: Get schema metadata
      const schemaResult = await runDr(
        ["schema", "node", specNodeId],
        { cwd: workdir.path }
      );

      expect(schemaResult.exitCode, "schema command failed").toBe(0);
      const requiredAttributes = extractRequiredAttributesFromSchemaOutput(
        schemaResult.stdout
      );

      // api.operation should have operationId, summary, tags as required
      expect(requiredAttributes).toContain("operationId");
      expect(requiredAttributes).toContain("summary");
      expect(requiredAttributes).toContain("tags");

      // Step 2 & 3: Construct dr add with all required attributes
      const addResult = await runDr(
        [
          "add",
          layer,
          type,
          "get-users",
          "--attributes",
          JSON.stringify({
            operationId: "getUsers",
            summary: "Retrieve list of users",
            tags: "users",
          }),
        ],
        { cwd: workdir.path }
      );

      // Step 4: Verify exit code 0
      expect(
        addResult.exitCode,
        `Failed to add ${specNodeId}: ${addResult.stderr || addResult.stdout}`
      ).toBe(0);

      // Step 5: Verify no validation errors in output
      const output = addResult.stdout + addResult.stderr;
      expect(output).not.toContain("unexpected property");
      expect(output).not.toContain("missing required property");

      // Step 6: Verify element persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      expect(layerObj).toBeDefined();

      const element = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.get-users`
      );
      expect(element).toBeDefined();
      expect(element!.attributes.operationId).toBe("getUsers");
      expect(element!.attributes.summary).toBe("Retrieve list of users");
      expect(element!.attributes.tags).toBe("users");

      // Step 7: Run validate and verify 0 schema errors
      const validateResult = await runDr(
        ["validate", "--schemas"],
        { cwd: workdir.path }
      );
      expect(validateResult.exitCode, "validate command failed").toBe(0);
    });

    it("should accept optional attributes without error", async () => {
      // Test with all required + some optional
      const addResult = await runDr(
        [
          "add",
          layer,
          type,
          "create-user",
          "--attributes",
          JSON.stringify({
            operationId: "createUser",
            summary: "Create new user",
            tags: "users",
            description: "Creates a new user account",
            deprecated: false,
          }),
        ],
        { cwd: workdir.path }
      );

      expect(addResult.exitCode).toBe(0);

      // Verify all attributes were persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      const element = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.create-user`
      );
      expect(element).toBeDefined();
      expect(element!.attributes.description).toBe("Creates a new user account");
      expect(element!.attributes.deprecated).toBe(false);
    });
  });

  describe("data-model.objectschema", () => {
    const specNodeId = "data-model.objectschema";
    const layer = "data-model";
    const type = "objectschema";

    it("should accept required attributes from schema introspection", async () => {
      // Step 1: Get schema metadata
      const schemaResult = await runDr(
        ["schema", "node", specNodeId],
        { cwd: workdir.path }
      );

      expect(schemaResult.exitCode, "schema command failed").toBe(0);
      const requiredAttributes = extractRequiredAttributesFromSchemaOutput(
        schemaResult.stdout
      );

      // data-model.objectschema should have "type" as required
      expect(requiredAttributes).toContain("type");

      // Step 2 & 3: Construct dr add with required attributes
      const addResult = await runDr(
        [
          "add",
          layer,
          type,
          "user-object",
          "--attributes",
          JSON.stringify({ type: "object" }),
        ],
        { cwd: workdir.path }
      );

      // Step 4: Verify exit code 0
      expect(
        addResult.exitCode,
        `Failed to add ${specNodeId}: ${addResult.stderr || addResult.stdout}`
      ).toBe(0);

      // Step 5: Verify no validation errors in output
      const output = addResult.stdout + addResult.stderr;
      expect(output).not.toContain("unexpected property");
      expect(output).not.toContain("missing required property");

      // Step 6: Verify element persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      expect(layerObj).toBeDefined();

      const element = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.user-object`
      );
      expect(element).toBeDefined();
      expect(element!.attributes.type).toBe("object");

      // Step 7: Run validate and verify 0 schema errors
      const validateResult = await runDr(
        ["validate", "--schemas"],
        { cwd: workdir.path }
      );
      expect(validateResult.exitCode, "validate command failed").toBe(0);
    });

    it("should accept optional properties without error", async () => {
      // Test with required + optional attributes
      const addResult = await runDr(
        [
          "add",
          layer,
          type,
          "product-object",
          "--attributes",
          JSON.stringify({
            type: "object",
            properties: { name: "string", price: "number" },
            required: "name",
            minProperties: 1,
            maxProperties: 100,
          }),
        ],
        { cwd: workdir.path }
      );

      expect(addResult.exitCode).toBe(0);

      // Verify persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      const element = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.product-object`
      );
      expect(element).toBeDefined();
      expect(element!.attributes.minProperties).toBe(1);
      expect(element!.attributes.maxProperties).toBe(100);
    });
  });

  describe("data-model.schemaproperty", () => {
    const specNodeId = "data-model.schemaproperty";
    const layer = "data-model";
    const type = "schemaproperty";

    it("should accept required attributes from schema introspection", async () => {
      // Step 1: Get schema metadata
      const schemaResult = await runDr(
        ["schema", "node", specNodeId],
        { cwd: workdir.path }
      );

      expect(schemaResult.exitCode, "schema command failed").toBe(0);
      const requiredAttributes = extractRequiredAttributesFromSchemaOutput(
        schemaResult.stdout
      );

      // data-model.schemaproperty should have "type" as required
      expect(requiredAttributes).toContain("type");

      // Step 2 & 3: Construct dr add with required attributes
      const addResult = await runDr(
        [
          "add",
          layer,
          type,
          "name-property",
          "--attributes",
          JSON.stringify({ type: "string" }),
        ],
        { cwd: workdir.path }
      );

      // Step 4: Verify exit code 0
      expect(
        addResult.exitCode,
        `Failed to add ${specNodeId}: ${addResult.stderr || addResult.stdout}`
      ).toBe(0);

      // Step 5: Verify no validation errors in output
      const output = addResult.stdout + addResult.stderr;
      expect(output).not.toContain("unexpected property");
      expect(output).not.toContain("missing required property");

      // Step 6: Verify element persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      expect(layerObj).toBeDefined();

      const element = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.name-property`
      );
      expect(element).toBeDefined();
      expect(element!.attributes.type).toBe("string");

      // Step 7: Run validate and verify 0 schema errors
      const validateResult = await runDr(
        ["validate", "--schemas"],
        { cwd: workdir.path }
      );
      expect(validateResult.exitCode, "validate command failed").toBe(0);
    });

    it("should accept optional attributes (title, format, default, etc) without error", async () => {
      // This test addresses the bug: "schemaproperty spec marks format/default/enum/const/examples
      // as required — blocks practical use" (BUG-6163-006, fixed 2026-03-15)
      //
      // These should be optional and not cause "missing required property" errors
      const addResult = await runDr(
        [
          "add",
          layer,
          type,
          "email-property",
          "--attributes",
          JSON.stringify({
            type: "string",
            title: "Email Address",
            format: "email",
            description: "User's email",
            default: "user@example.com",
          }),
        ],
        { cwd: workdir.path }
      );

      expect(addResult.exitCode).toBe(0);
      const output = addResult.stdout + addResult.stderr;
      expect(output).not.toContain("missing required property");

      // Verify all optional attributes were persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);
      const element = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.email-property`
      );
      expect(element).toBeDefined();
      expect(element!.attributes.title).toBe("Email Address");
      expect(element!.attributes.format).toBe("email");
      expect(element!.attributes.default).toBe("user@example.com");
    });

    it("should accept enum, const, and examples as optional attributes", async () => {
      // Test with enum value
      const addResult1 = await runDr(
        [
          "add",
          layer,
          type,
          "status-property",
          "--attributes",
          JSON.stringify({
            type: "string",
            enum: "active",
          }),
        ],
        { cwd: workdir.path }
      );

      expect(addResult1.exitCode).toBe(0);

      // Test with const value
      const addResult2 = await runDr(
        [
          "add",
          layer,
          type,
          "version-property",
          "--attributes",
          JSON.stringify({
            type: "string",
            const: "v1",
          }),
        ],
        { cwd: workdir.path }
      );

      expect(addResult2.exitCode).toBe(0);

      // Test with examples
      const addResult3 = await runDr(
        [
          "add",
          layer,
          type,
          "timestamp-property",
          "--attributes",
          JSON.stringify({
            type: "string",
            examples: "2026-03-21T10:30:00Z",
          }),
        ],
        { cwd: workdir.path }
      );

      expect(addResult3.exitCode).toBe(0);

      // Verify all were persisted
      const model = await Model.load(workdir.path);
      const layerObj = await model.getLayer(layer);

      const statusElement = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.status-property`
      );
      expect(statusElement!.attributes.enum).toBe("active");

      const versionElement = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.version-property`
      );
      expect(versionElement!.attributes.const).toBe("v1");

      const timestampElement = findElementBySemanticId(
        layerObj!,
        `${layer}.${type}.timestamp-property`
      );
      expect(timestampElement!.attributes.examples).toBe("2026-03-21T10:30:00Z");
    });
  });

  describe("cross-type consistency", () => {
    it("should maintain consistency across all test types", async () => {
      const testTypes = [
        { layer: "api", type: "parameter", specNodeId: "api.parameter" },
        { layer: "api", type: "operation", specNodeId: "api.operation" },
        { layer: "data-model", type: "objectschema", specNodeId: "data-model.objectschema" },
        { layer: "data-model", type: "schemaproperty", specNodeId: "data-model.schemaproperty" },
      ];

      for (const { layer, type, specNodeId } of testTypes) {
        // Verify schema command succeeds for each type
        const schemaResult = await runDr(
          ["schema", "node", specNodeId],
          { cwd: workdir.path }
        );

        expect(
          schemaResult.exitCode,
          `Schema command failed for ${specNodeId}`
        ).toBe(0);
        expect(schemaResult.stdout).toContain("Required Attributes");
      }
    });
  });
});
