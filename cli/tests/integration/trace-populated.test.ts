/**
 * Integration tests for trace command with populated models (issue #522)
 *
 * Tests the `dr trace` command against models with known dependency chains.
 * Verifies that:
 * 1. `dr trace A` shows direct dependency count ≥ 1 (B) when A→B relationship exists
 * 2. `dr trace A` shows transitive dependency count ≥ 1 (C) when A→B→C chain exists
 * 3. The number of items listed in the Direct/Transitive sections exactly matches
 *    the counts reported in the header (no off-by-one or double-counting)
 * 4. `dr trace C --direction up` shows A and B in the dependent set
 *
 * These tests address bugs that survived because trace had no test coverage:
 * - Bug #1: dr trace reports 0 dependencies for all elements even when relationships exist
 * - Bug #2: dr trace transitive dependency count is wrong — count exceeds listed items
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  runDr as runDrHelper,
  createTempWorkdir
} from "../helpers/cli-runner.js";

let tempDir: { path: string; cleanup: () => Promise<void> } = {
  path: "",
  cleanup: async () => {}
};

async function runDr(
  ...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!tempDir.path) {
    throw new Error("tempDir.path is not initialized");
  }
  return runDrHelper(args, { cwd: tempDir.path });
}

/**
 * Parse trace output to extract counts and items from a section.
 * Returns { directCount, transitiveCount, directItems, transitiveItems }
 */
function parseTraceOutput(
  output: string,
  section: "Dependencies" | "Dependents"
): {
  directCount: number;
  transitiveCount: number;
  directItems: string[];
  transitiveItems: string[];
} {
  // Look for the section header: "Dependencies (X direct, Y transitive):" or "Dependents (X direct, Y transitive):"
  const headerRegex = new RegExp(
    `${section}\\s+\\((\\d+)\\s+direct,\\s+(\\d+)\\s+transitive\\):`
  );
  const headerMatch = output.match(headerRegex);

  if (!headerMatch) {
    return {
      directCount: 0,
      transitiveCount: 0,
      directItems: [],
      transitiveItems: []
    };
  }

  const directCount = parseInt(headerMatch[1], 10);
  const transitiveCount = parseInt(headerMatch[2], 10);

  // Extract the section content (from the header to the next blank line or next section)
  const sectionStart = output.indexOf(headerMatch[0]);
  const sectionEnd = output.indexOf("\n\n", sectionStart);
  const sectionContent = output.substring(
    sectionStart,
    sectionEnd > -1 ? sectionEnd : undefined
  );

  // Parse direct items (after "Direct:" line)
  const directItems: string[] = [];
  const directMatch = sectionContent.match(/Direct:[\s\S]*?(?=Transitive:|$)/);
  if (directMatch) {
    const directSection = directMatch[0];
    // Items are prefixed with arrows like "→ api.endpoint.get-orders"
    const itemMatches = directSection.match(/[→←↘↖]\s+([^\n]+)/g) || [];
    for (const match of itemMatches) {
      const item = match.replace(/[→←↘↖]\s+/, "").trim();
      if (item && !item.startsWith(".")) {
        // Filter out ANSI color codes and extract just the element ID
        const cleanItem = item.replace(/\x1b\[[0-9;]*m/g, "").trim();
        directItems.push(cleanItem);
      }
    }
  }

  // Parse transitive items (after "Transitive:" line)
  const transitiveItems: string[] = [];
  const transitiveMatch = sectionContent.match(/Transitive:[\s\S]*?(?=$)/);
  if (transitiveMatch) {
    const transitiveSection = transitiveMatch[0];
    // Items are prefixed with arrows like "↘ data-model.entity.order"
    const itemMatches = transitiveSection.match(/[→←↘↖]\s+([^\n]+)/g) || [];
    for (const match of itemMatches) {
      const item = match.replace(/[→←↘↖]\s+/, "").trim();
      if (item && !item.startsWith(".")) {
        // Filter out ANSI color codes and extract just the element ID
        const cleanItem = item.replace(/\x1b\[[0-9;]*m/g, "").trim();
        transitiveItems.push(cleanItem);
      }
    }
  }

  return { directCount, transitiveCount, directItems, transitiveItems };
}

/**
 * Helper: Create a three-element A→B→C dependency chain in the data-store layer.
 * Returns when both relationships are created successfully.
 */
async function setupThreeElementChain(): Promise<void> {
  // Create three elements in data-store layer: A, B, C
  await runDr("add", "data-store", "collection", "Element A");
  await runDr("add", "data-store", "collection", "Element B");
  await runDr("add", "data-store", "collection", "Element C");

  // Create relationship A → B
  const relAB = await runDr(
    "relationship",
    "add",
    "data-store.collection.element-a",
    "data-store.collection.element-b",
    "--predicate",
    "composes"
  );
  expect(relAB.exitCode).toBe(0);

  // Create relationship B → C
  const relBC = await runDr(
    "relationship",
    "add",
    "data-store.collection.element-b",
    "data-store.collection.element-c",
    "--predicate",
    "composes"
  );
  expect(relBC.exitCode).toBe(0);
}

describe("Trace Command with Populated Models", () => {
  beforeEach(async () => {
    tempDir = await createTempWorkdir();
    // Initialize a fresh model
    await runDr("init", "--name", "Trace Populated Test Model");
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("trace with three-element dependency chain", () => {
    it("should show direct dependency count when A→B relationship exists", async () => {
      // Setup chain: A → B → C
      await setupThreeElementChain();

      // Trace A and check for direct dependencies
      const traceResult = await runDr(
        "trace",
        "data-store.collection.element-a"
      );
      expect(traceResult.exitCode).toBe(0);
      expect(traceResult.stdout).toContain("Dependency Trace");

      // Parse the Dependencies section
      const parsed = parseTraceOutput(traceResult.stdout, "Dependencies");

      // A has direct dependency on B
      expect(parsed.directCount).toBeGreaterThanOrEqual(1);
      expect(parsed.directItems.length).toBeGreaterThanOrEqual(1);
      expect(
        parsed.directItems.some((item) => item.includes("element-b"))
      ).toBe(true);
    });

    it("should show transitive dependency count when A→B→C chain exists", async () => {
      // Setup chain: A → B → C
      await setupThreeElementChain();

      // Trace A and check for transitive dependencies
      const traceResult = await runDr(
        "trace",
        "data-store.collection.element-a"
      );
      expect(traceResult.exitCode).toBe(0);

      // Parse the Dependencies section
      const parsed = parseTraceOutput(traceResult.stdout, "Dependencies");

      // A should have:
      // - Direct dependency on B (1)
      // - Transitive dependency on C (1)
      expect(parsed.directCount).toBeGreaterThanOrEqual(1);
      expect(parsed.transitiveCount).toBeGreaterThanOrEqual(1);

      // Verify that B is in direct and C is in transitive
      expect(
        parsed.directItems.some((item) => item.includes("element-b"))
      ).toBe(true);
      expect(
        parsed.transitiveItems.some((item) => item.includes("element-c"))
      ).toBe(true);
    });

    it("should have exactly matching counts between header and listed items", async () => {
      // Setup chain: A → B → C
      await setupThreeElementChain();

      // Trace A
      const traceResult = await runDr(
        "trace",
        "data-store.collection.element-a"
      );
      expect(traceResult.exitCode).toBe(0);

      // Parse both sections
      const depsParsed = parseTraceOutput(traceResult.stdout, "Dependencies");

      // Guard assertion: ensure the parser actually found the Dependencies section
      // (prevents vacuous passing if parser fails and both sides default to 0)
      expect(depsParsed.directCount).toBeGreaterThan(0);

      // Verify that the header counts match the actual listed items
      // For dependencies section:
      // - directCount in header should equal directItems.length
      // - transitiveCount in header should equal transitiveItems.length
      expect(depsParsed.directItems.length).toBe(depsParsed.directCount);
      expect(depsParsed.transitiveItems.length).toBe(
        depsParsed.transitiveCount
      );
    });

    it("should show correct dependents when using --direction up on the tail of chain", async () => {
      // Setup chain: A → B → C
      await setupThreeElementChain();

      // Trace C with --direction up (show what depends on C)
      const traceResult = await runDr(
        "trace",
        "data-store.collection.element-c",
        "--direction",
        "up"
      );
      expect(traceResult.exitCode).toBe(0);
      expect(traceResult.stdout).toContain("Dependents");

      // Parse the Dependents section
      const parsed = parseTraceOutput(traceResult.stdout, "Dependents");

      // C should have:
      // - Direct dependent: B (1)
      // - Transitive dependent: A (1)
      expect(parsed.directCount).toBeGreaterThanOrEqual(1);
      expect(parsed.transitiveCount).toBeGreaterThanOrEqual(1);

      // Verify that B is in direct and A is in transitive
      expect(
        parsed.directItems.some((item) => item.includes("element-b"))
      ).toBe(true);
      expect(
        parsed.transitiveItems.some((item) => item.includes("element-a"))
      ).toBe(true);
    });

    it("should not report negative or zero counts when relationships exist", async () => {
      // Setup chain: A → B → C
      await setupThreeElementChain();

      // Trace each element and verify counts are positive
      const traceA = await runDr("trace", "data-store.collection.element-a");
      expect(traceA.exitCode).toBe(0);

      const parsedA = parseTraceOutput(traceA.stdout, "Dependencies");
      expect(parsedA.directCount).toBeGreaterThan(0);
      expect(parsedA.transitiveCount).toBeGreaterThan(0);

      // B should have direct dependency on C and no transitive (since there's nothing beyond C)
      const traceB = await runDr("trace", "data-store.collection.element-b");
      expect(traceB.exitCode).toBe(0);

      const parsedB = parseTraceOutput(traceB.stdout, "Dependencies");
      expect(parsedB.directCount).toBeGreaterThan(0); // B → C

      // C should have no dependencies (it's the tail)
      const traceC = await runDr("trace", "data-store.collection.element-c");
      expect(traceC.exitCode).toBe(0);

      const parsedC = parseTraceOutput(traceC.stdout, "Dependencies");
      // C has no outgoing dependencies, so both should be 0
      expect(parsedC.directCount).toBe(0);
      expect(parsedC.transitiveCount).toBe(0);
    });

    it("should show no dependents when element is the head of chain with --direction up", async () => {
      // Setup chain: A → B → C
      await setupThreeElementChain();

      // Trace A with --direction up (show what depends on A)
      const traceResult = await runDr(
        "trace",
        "data-store.collection.element-a",
        "--direction",
        "up"
      );
      expect(traceResult.exitCode).toBe(0);
      expect(traceResult.stdout).toContain("Dependents");

      // Parse the Dependents section
      const parsed = parseTraceOutput(traceResult.stdout, "Dependents");

      // A is the head: nothing depends on it
      expect(parsed.directCount).toBe(0);
      expect(parsed.transitiveCount).toBe(0);
    });
  });

  describe("trace with branching dependencies", () => {
    it("should correctly count multiple direct dependencies", async () => {
      // Create four elements: A, B, C, D
      // Create structure: A → {B, C}, B → D
      await runDr("add", "data-store", "collection", "Element A");
      await runDr("add", "data-store", "collection", "Element B");
      await runDr("add", "data-store", "collection", "Element C");
      await runDr("add", "data-store", "collection", "Element D");

      // A → B
      await runDr(
        "relationship",
        "add",
        "data-store.collection.element-a",
        "data-store.collection.element-b",
        "--predicate",
        "composes"
      );

      // A → C
      await runDr(
        "relationship",
        "add",
        "data-store.collection.element-a",
        "data-store.collection.element-c",
        "--predicate",
        "composes"
      );

      // B → D
      await runDr(
        "relationship",
        "add",
        "data-store.collection.element-b",
        "data-store.collection.element-d",
        "--predicate",
        "composes"
      );

      // Trace A: should have 2 direct (B, C) and 1 transitive (D)
      const traceResult = await runDr(
        "trace",
        "data-store.collection.element-a"
      );
      expect(traceResult.exitCode).toBe(0);

      const parsed = parseTraceOutput(traceResult.stdout, "Dependencies");
      expect(parsed.directCount).toBe(2);
      expect(parsed.transitiveCount).toBe(1);

      // Verify items match counts
      expect(parsed.directItems.length).toBe(2);
      expect(parsed.transitiveItems.length).toBe(1);
    });
  });
});
