/**
 * Unit tests for dangling relationship detection (`dr relationship prune`, #964).
 *
 * Rows in relationships.yaml may name an element by its UUID `id` or by its dotted
 * `path`; matching on only one form produces false positives.
 */

import { describe, it, expect } from "bun:test";
import {
  collectKnownIdentifiers,
  extractRelationshipsHeader,
  findDanglingRelationships,
} from "../../../src/core/relationship-prune.js";
import type { Relationship } from "../../../src/core/relationships.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const PATH_A = "application.applicationcomponent.alpha";
const PATH_B = "api.operation.beta";

const elements = [
  { id: UUID_A, path: PATH_A },
  { id: UUID_B, path: PATH_B },
];

function rel(source: string, target: string, layer = "application", extra: Partial<Relationship> = {}): Relationship {
  return { source, target, predicate: "uses", layer, category: "structural", ...extra };
}

describe("collectKnownIdentifiers", () => {
  it("collects both the UUID id and the dotted path of every element", () => {
    const known = collectKnownIdentifiers(elements);
    expect(known.has(UUID_A)).toBe(true);
    expect(known.has(PATH_A)).toBe(true);
    expect(known.has(UUID_B)).toBe(true);
    expect(known.has(PATH_B)).toBe(true);
    expect(known.size).toBe(4);
  });

  it("ignores missing or empty identifiers", () => {
    const known = collectKnownIdentifiers([{ id: UUID_A, path: "" }, { path: PATH_B }, {}]);
    expect([...known].sort()).toEqual([UUID_A, PATH_B].sort());
  });
});

describe("findDanglingRelationships", () => {
  const known = collectKnownIdentifiers(elements);

  it("keeps rows whose endpoints resolve by UUID", () => {
    const result = findDanglingRelationships([rel(UUID_A, UUID_B)], known);
    expect(result.dangling).toHaveLength(0);
    expect(result.kept).toHaveLength(1);
    expect(result.scanned).toBe(1);
  });

  it("keeps rows whose endpoints resolve by dotted path", () => {
    const result = findDanglingRelationships([rel(PATH_A, PATH_B)], known);
    expect(result.dangling).toHaveLength(0);
    expect(result.kept).toHaveLength(1);
  });

  it("keeps rows that mix UUID and path forms (no false positives)", () => {
    const rows = [rel(UUID_A, PATH_B), rel(PATH_A, UUID_B)];
    const result = findDanglingRelationships(rows, known);
    expect(result.dangling).toHaveLength(0);
    expect(result.kept).toEqual(rows);
  });

  it("flags a row whose source resolves to no element", () => {
    const result = findDanglingRelationships([rel("ghost", PATH_B)], known);
    expect(result.dangling).toHaveLength(1);
    expect(result.dangling[0].unresolved).toBe("source");
    expect(result.kept).toHaveLength(0);
  });

  it("flags a row whose target resolves to no element", () => {
    const result = findDanglingRelationships([rel(UUID_A, "ghost")], known);
    expect(result.dangling).toHaveLength(1);
    expect(result.dangling[0].unresolved).toBe("target");
  });

  it("reports both sides when neither endpoint resolves", () => {
    const result = findDanglingRelationships([rel("ghost-1", "ghost-2")], known);
    expect(result.dangling[0].unresolved).toBe("both");
  });

  it("does not resolve an endpoint against a UUID-only view when the row uses a path", () => {
    // Regression for the reporter's 223-of-279 false positives: a UUID-only check
    // must not be what decides a path-keyed row.
    const uuidOnly = new Set([UUID_A, UUID_B]);
    const withPaths = collectKnownIdentifiers(elements);
    const rows = [rel(PATH_A, PATH_B)];
    expect(findDanglingRelationships(rows, uuidOnly).dangling).toHaveLength(1);
    expect(findDanglingRelationships(rows, withPaths).dangling).toHaveLength(0);
  });

  it("preserves file order in both kept and dangling lists", () => {
    const rows = [
      rel(UUID_A, "ghost-1"),
      rel(UUID_A, UUID_B),
      rel("ghost-2", PATH_B),
      rel(PATH_A, PATH_B),
    ];
    const result = findDanglingRelationships(rows, known);
    expect(result.kept).toEqual([rows[1], rows[3]]);
    expect(result.dangling.map((d) => d.relationship)).toEqual([rows[0], rows[2]]);
  });

  it("restricts the scan to the given layers and keeps rows outside the filter", () => {
    const rows = [
      rel("ghost-1", UUID_A, "application"),
      rel("ghost-2", UUID_B, "api"),
      rel(UUID_A, "ghost-3", "application", { targetLayer: "api" }),
    ];
    const result = findDanglingRelationships(rows, known, { layers: ["api"] });
    // Row 0 is application-only and out of scope; row 2 is in scope via targetLayer
    expect(result.scanned).toBe(2);
    expect(result.dangling.map((d) => d.relationship)).toEqual([rows[1], rows[2]]);
    expect(result.kept).toEqual([rows[0]]);
  });

  it("treats an empty layer list as no filter", () => {
    const result = findDanglingRelationships([rel("ghost", UUID_A)], known, { layers: [] });
    expect(result.scanned).toBe(1);
    expect(result.dangling).toHaveLength(1);
  });

  it("returns an empty result for an empty file", () => {
    const result = findDanglingRelationships([], known);
    expect(result).toEqual({ scanned: 0, dangling: [], kept: [] });
  });
});

describe("extractRelationshipsHeader", () => {
  it("returns the leading comment block without trailing blank lines", () => {
    const content = "# Intra-layer relationships\n# Last updated: x\n\n- source: a\n  target: b\n";
    expect(extractRelationshipsHeader(content)).toBe("# Intra-layer relationships\n# Last updated: x\n");
  });

  it("returns an empty string when the file has no header", () => {
    expect(extractRelationshipsHeader("- source: a\n  target: b\n")).toBe("");
    expect(extractRelationshipsHeader("")).toBe("");
  });

  it("stops at the first non-comment line", () => {
    const content = "# one\n[]\n# not a header\n";
    expect(extractRelationshipsHeader(content)).toBe("# one\n");
  });
});
