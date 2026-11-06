import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { mkdtempSync, rmSync } from "fs";
import {
  applyPlan,
  changeRecord,
  newSchema,
  planSpecChanges,
  skillCitations,
  type CsRecord,
  type SpecChange,
  type SpecChanges,
} from "../../../scripts/spec-enrich/cs-decisions-to-spec.js";
import { buildRewriteTable } from "../../../scripts/generate-relationship-migration.js";

/**
 * cs-decisions-to-spec.ts writes Context Studio's decided relationship-type changes
 * (cs-dr-spec-changes/1) into spec/schemas/relationships and records the migration actions.
 * Each test builds a tiny spec tree in a temp repo.
 */
describe("cs-decisions-to-spec.ts", () => {
  let repo: string;
  let spec: string;
  const rel = (...p: string[]) => path.join(spec, "schemas", "relationships", ...p);
  const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

  function writeNode(layer: string, type: string) {
    const dir = path.join(spec, "schemas", "nodes", layer);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${type}.node.schema.json`), JSON.stringify({ properties: { spec_node_id: { const: `${layer}.${type}` } } }));
  }

  /** An existing schema, written the way the spec's own files are. */
  function writeRelationship(id: string, extra: Record<string, unknown> = {}) {
    const schema = { ...newSchema(id, { description: `About ${id}.` }), ...extra };
    const [layer, src, pred, , dst] = id.split(".");
    fs.mkdirSync(rel(layer), { recursive: true });
    const file = rel(layer, `${src}.${pred}.${dst}.relationship.schema.json`);
    fs.writeFileSync(file, JSON.stringify(schema, null, 2) + "\n");
    return file;
  }

  function change(op: SpecChange["op"], id: string, set: SpecChange["set"] = {}, more: Partial<SpecChange> = {}): SpecChange {
    const [l1, t1, predicate, l2, t2] = id.split(".");
    return { seq: 1, op, relationship_id: id, predicate, source_spec_node_id: `${l1}.${t1}`, destination_spec_node_id: `${l2}.${t2}`, set, ...more };
  }

  const doc = (...changes: SpecChange[]): SpecChanges => ({ format: "cs-dr-spec-changes/1", proposal_id: "p-1", title: "T", changes });

  beforeEach(() => {
    repo = mkdtempSync(path.join("/tmp", "test-cs-decisions-"));
    spec = path.join(repo, "spec");
    for (const t of ["applicationcomponent", "applicationinterface", "applicationcollaboration"]) writeNode("application", t);
    writeNode("technology", "node");
    fs.mkdirSync(path.join(spec, "schemas", "base"), { recursive: true });
    fs.mkdirSync(path.join(spec, "schemas", "relationships"), { recursive: true });
    fs.writeFileSync(path.join(spec, "schemas", "base", "predicates.json"), JSON.stringify({ predicates: { aggregates: {}, "assigned-to": {}, provides: {}, uses: {}, serves: {} } }));
  });

  afterEach(() => {
    if (fs.existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  });

  it("writes a create in the sibling files' shape, evidence last", () => {
    const id = "application.applicationcollaboration.aggregates.application.applicationcollaboration";
    const plan = planSpecChanges(doc(change("create", id, { description: "Nested.", evidence: ["A chart lists it."] })), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"), "2026-11-05T00:00:00.000Z");

    const file = rel("application", "applicationcollaboration.aggregates.applicationcollaboration.relationship.schema.json");
    const text = fs.readFileSync(file, "utf8");
    const schema = JSON.parse(text);
    expect(Object.keys(schema)).toEqual(["$schema", "title", "description", "allOf", "properties", "x-dr-evidence"]);
    expect(schema.title).toBe("Applicationcollaboration aggregates Applicationcollaboration");
    expect(schema.allOf).toEqual([{ $ref: "../../base/spec-node-relationship.schema.json" }]);
    expect(schema.properties.id.const).toBe(id);
    expect(schema.properties.cardinality.const).toBe("many-to-many");
    expect(schema.properties.strength.const).toBe("medium");
    expect(schema["x-dr-evidence"]).toEqual(["A chart lists it."]);
    expect(text.endsWith("}\n")).toBe(true);
    expect(plan.actions).toEqual([
      { action: "create", kind: "cs:create", from: id, to: id, p: 1, claims: [], note: "Context Studio proposal p-1 seq 1 (create)", file_written: "spec/schemas/relationships/application/applicationcollaboration.aggregates.applicationcollaboration.relationship.schema.json" },
    ]);
  });

  it("changes only the values set on an update that keeps its triple", () => {
    const id = "application.applicationcomponent.assigned-to.application.applicationinterface";
    const file = writeRelationship(id, { "x-dr-evidence": ["Old."] });
    const before = read(file);
    const plan = planSpecChanges(doc(change("update", id, { description: "New.", evidence: ["New evidence."], strength: "high" })), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"));

    const after = read(file);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after.description).toBe("New.");
    expect(after["x-dr-evidence"]).toEqual(["New evidence."]);
    expect(after.properties.strength.const).toBe("high");
    expect(after.properties.cardinality).toEqual(before.properties.cardinality);
    expect(after.title).toBe(before.title);
    // A value change needs no model migration.
    expect(plan.actions).toEqual([]);
  });

  it("removes x-dr-evidence when an update sets it empty", () => {
    const id = "application.applicationcomponent.assigned-to.application.applicationinterface";
    const file = writeRelationship(id, { "x-dr-evidence": ["Old."] });
    applyPlan(doc(), planSpecChanges(doc(change("update", id, { evidence: [] })), spec), path.join(repo, "record.json"));
    expect(read(file)["x-dr-evidence"]).toBeUndefined();
  });

  it("renames on a same-pair triple change and records a rename", () => {
    const old = "application.applicationcomponent.assigned-to.application.applicationinterface";
    const id = "application.applicationcomponent.provides.application.applicationinterface";
    const oldFile = writeRelationship(old, { description: "Defines relationship: application.applicationcomponent assigned-to application.applicationinterface", "x-dr-evidence": ["Kept."] });
    const plan = planSpecChanges(doc(change("update", id, {}, { previous_relationship_id: old })), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"));

    expect(fs.existsSync(oldFile)).toBe(false);
    const schema = read(rel("application", "applicationcomponent.provides.applicationinterface.relationship.schema.json"));
    expect(schema.title).toBe("Applicationcomponent provides Applicationinterface");
    expect(schema.description).toBe("Defines relationship: application.applicationcomponent provides application.applicationinterface");
    expect(schema["x-dr-evidence"]).toEqual(["Kept."]);
    expect(plan.actions.map((a) => [a.action, a.kind, a.from, a.to])).toEqual([["rename", "cs:rename", old, id]]);
  });

  it("records a reversal as a rename, without the old evidence", () => {
    const old = "application.applicationcomponent.serves.application.applicationinterface";
    const id = "application.applicationinterface.serves.application.applicationcomponent";
    writeRelationship(old, { "x-dr-evidence": ["One way only."] });
    const plan = planSpecChanges(doc(change("update", id, {}, { previous_relationship_id: old })), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"));

    expect(read(rel("application", "applicationinterface.serves.applicationcomponent.relationship.schema.json"))["x-dr-evidence"]).toBeUndefined();
    expect(plan.actions.map((a) => [a.action, a.kind, a.to])).toEqual([["rename", "cs:reverse", id]]);
  });

  it("records a retarget as a dropped delete plus a create", () => {
    const old = "application.applicationcomponent.uses.application.applicationinterface";
    const id = "application.applicationcomponent.uses.application.applicationcollaboration";
    writeRelationship(old);
    const plan = planSpecChanges(doc(change("update", id, {}, { previous_relationship_id: old })), spec);

    expect(plan.actions.map((a) => [a.action, a.from, a.to])).toEqual([
      ["delete", old, null],
      ["create", id, id],
    ]);
  });

  describe("with Context Studio's change records", () => {
    const old = "application.applicationcomponent.uses.application.applicationinterface";
    const id = "application.applicationcomponent.uses.application.applicationcollaboration";
    const kept = "application.applicationcomponent.provides.application.applicationinterface";
    const record = (action: CsRecord["action"], from: string, to: string | null, more: Partial<CsRecord> = {}): CsRecord => ({
      action, kind: "cs:retarget", from, to, swap: false, p: 0.8, proposal_id: "p-1", operation_id: "op-1", applied_at: "2026-11-06T00:00:00+00:00", ...more,
    });
    const retarget = (records: CsRecord[]): SpecChanges => ({ ...doc(change("update", id, {}, { previous_relationship_id: old, op_id: "op-1" })), records });

    beforeEach(() => {
      writeRelationship(old);
      writeRelationship(kept);
    });

    it("keeps a retarget's model relationships where Context Studio moved them", () => {
      const changes = retarget([record("delete", old, kept), record("create", id, id, { note: `retarget of ${old}` })]);
      const plan = planSpecChanges(changes, spec);

      expect(plan.actions).toEqual([
        { action: "delete", kind: "cs:retarget", from: old, to: kept, p: 0.8, claims: [], note: "Context Studio proposal p-1 seq 1 (retarget)", file_removed: `spec/schemas/relationships/application/applicationcomponent.uses.applicationinterface.relationship.schema.json` },
        { action: "create", kind: "cs:retarget", from: id, to: id, p: 0.8, claims: [], note: `Context Studio proposal p-1 seq 1 (retarget); retarget of ${old}`, file_written: `spec/schemas/relationships/application/applicationcomponent.uses.applicationcollaboration.relationship.schema.json` },
      ]);
      expect(plan.summary).toEqual([`retarget ${old} -> ${id} (relationships move to ${kept})`]);

      // generate-relationship-migration.ts turns it into a rewrite to the kept type, not a drop.
      const { table } = buildRewriteTable([{ file: "applied-cs-p-1.json", ...changeRecord(changes, plan, "2026-11-06T00:00:00.000Z") } as never], new Set([kept, id]));
      expect(table.triples[old]).toEqual({ to: kept, swap: false, records: ["cs-p-1"] });
    });

    it("drops a retarget's relationships when Context Studio's record does", () => {
      const plan = planSpecChanges(retarget([record("delete", old, null), record("create", id, id)]), spec);
      expect(plan.actions.map((a) => [a.action, a.from, a.to])).toEqual([
        ["delete", old, null],
        ["create", id, id],
      ]);
    });

    it("refuses records that don't match the changes", () => {
      expect(() => planSpecChanges(retarget([record("delete", old, kept)]), spec)).toThrow(/records: they don't match the changes/);
    });

    it("refuses a record moving relationships to a different element pair", () => {
      expect(() => planSpecChanges(retarget([record("delete", old, id), record("create", id, id)]), spec)).toThrow(/links a different element pair/);
    });

    it("refuses a record moving relationships to a type the spec doesn't have", () => {
      const missing = "application.applicationcomponent.serves.application.applicationinterface";
      expect(() => planSpecChanges(retarget([record("delete", old, missing), record("create", id, id)]), spec)).toThrow(/move to .*serves.* which is not in the spec/);
    });
  });

  it("deletes, keeping a same-pair replacement and dropping one for another pair", () => {
    const a = "application.applicationcomponent.assigned-to.application.applicationinterface";
    const b = "application.applicationcomponent.provides.application.applicationinterface";
    const c = "application.applicationcomponent.uses.application.applicationcollaboration";
    const d = "application.applicationcomponent.serves.application.applicationinterface";
    const fileA = writeRelationship(a);
    writeRelationship(b);
    writeRelationship(c);
    writeRelationship(d);
    const plan = planSpecChanges(doc(change("delete", a, {}, { replacement_relationship_id: b }), { ...change("delete", d, {}, { replacement_relationship_id: c }), seq: 2 }), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"));

    expect(fs.existsSync(fileA)).toBe(false);
    expect(plan.actions.map((x) => [x.action, x.from, x.to])).toEqual([
      ["delete", a, b],
      ["delete", d, null],
    ]);
  });

  it("keeps a delete's replacement that links the reversed pair (pairOf)", () => {
    const a = "application.applicationcomponent.serves.application.applicationinterface";
    const b = "application.applicationinterface.serves.application.applicationcomponent";
    writeRelationship(a);
    writeRelationship(b);
    const plan = planSpecChanges(doc(change("delete", a, {}, { replacement_relationship_id: b })), spec);
    expect(plan.actions.map((x) => [x.action, x.from, x.to])).toEqual([["delete", a, b]]);
  });

  it("checks every change first and writes nothing when any is invalid", () => {
    const good = "application.applicationcollaboration.aggregates.application.applicationcollaboration";
    const existing = "application.applicationcomponent.assigned-to.application.applicationinterface";
    writeRelationship(existing);
    const bad = doc(
      change("create", good),
      { ...change("create", existing), seq: 2 },
      { ...change("create", "application.applicationcomponent.frobs.technology.node"), seq: 3 },
      { ...change("update", existing, { cardinality: "lots" }), seq: 4 },
      { ...change("delete", "application.applicationcomponent.uses.technology.node"), seq: 5 },
      { ...change("update", existing, { strength: null }), seq: 6 },
    );
    expect(() => planSpecChanges(bad, spec)).toThrow(/seq 2 .*already in the spec[\s\S]*predicate 'frobs'[\s\S]*cardinality 'lots'[\s\S]*is not in the spec[\s\S]*removes cardinality or strength/);
    expect(fs.existsSync(rel("application", "applicationcollaboration.aggregates.applicationcollaboration.relationship.schema.json"))).toBe(false);
  });

  it("keeps both of two updates to one schema in one export", () => {
    const id = "application.applicationcomponent.assigned-to.application.applicationinterface";
    const file = writeRelationship(id);
    const plan = planSpecChanges(doc(change("update", id, { strength: "high" }), { ...change("update", id, { description: "Second." }), seq: 2 }), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"));

    expect(plan.writes).toHaveLength(1);
    expect(read(file).properties.strength.const).toBe("high");
    expect(read(file).description).toBe("Second.");
  });

  it("updates a schema an earlier change in the export created", () => {
    const id = "application.applicationcollaboration.aggregates.application.applicationcollaboration";
    const plan = planSpecChanges(doc(change("create", id, { description: "First." }), { ...change("update", id, { evidence: ["Then evidence."] }), seq: 2 }), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"));

    const schema = read(rel("application", "applicationcollaboration.aggregates.applicationcollaboration.relationship.schema.json"));
    expect(schema.description).toBe("First.");
    expect(schema["x-dr-evidence"]).toEqual(["Then evidence."]);
  });

  it("updates a schema an earlier change in the export renamed", () => {
    const old = "application.applicationcomponent.assigned-to.application.applicationinterface";
    const id = "application.applicationcomponent.provides.application.applicationinterface";
    const oldFile = writeRelationship(old);
    const plan = planSpecChanges(doc(change("update", id, {}, { previous_relationship_id: old }), { ...change("update", id, { strength: "low" }), seq: 2 }), spec);
    applyPlan(doc(), plan, path.join(repo, "record.json"));

    expect(fs.existsSync(oldFile)).toBe(false);
    const schema = read(rel("application", "applicationcomponent.provides.applicationinterface.relationship.schema.json"));
    expect(schema.properties.id.const).toBe(id);
    expect(schema.properties.strength.const).toBe("low");
    expect(plan.removes).toEqual([oldFile]);
  });

  it("names both layers when a file name is taken by a triple to another layer's type", () => {
    writeNode("ux", "view");
    writeNode("navigation", "view");
    writeRelationship("application.applicationcomponent.uses.ux.view");
    expect(() => planSpecChanges(doc(change("create", "application.applicationcomponent.uses.navigation.view")), spec)).toThrow(/already holds application\.applicationcomponent\.uses\.ux\.view: .*view is in both ux and navigation/);
  });

  it("lists the layer-skill lines that cite a triple", () => {
    const dir = path.join(repo, "integrations", "claude_code", "skills", "dr_05_application_layer");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      ["| Source | Predicate | Target |", "| ApplicationComponent | assigned-to | ApplicationInterface |", "| ApplicationComponent | provides | ApplicationInterface |", "dr relationship add application.applicationcomponent.api application.applicationinterface.rest --predicate assigned-to"].join("\n"),
    );
    expect(skillCitations(repo, ["application.applicationcomponent.assigned-to.application.applicationinterface"])).toEqual([
      "integrations/claude_code/skills/dr_05_application_layer/SKILL.md:2 cites application.applicationcomponent.assigned-to.application.applicationinterface",
      "integrations/claude_code/skills/dr_05_application_layer/SKILL.md:4 cites application.applicationcomponent.assigned-to.application.applicationinterface",
    ]);
  });

  it("refuses a file that is not a cs-dr-spec-changes/1 export", () => {
    expect(() => planSpecChanges({ ...doc(), format: "dr-reflection-plan/1" }, spec)).toThrow(/not a cs-dr-spec-changes\/1 file/);
  });

  it("writes the change record in apply-walk.ts's shape", () => {
    const id = "application.applicationcollaboration.aggregates.application.applicationcollaboration";
    const changes = doc(change("create", id));
    const plan = planSpecChanges(changes, spec);
    const record = path.join(repo, "data", "applied-cs-p-1.json");
    applyPlan(changes, plan, record, "2026-11-05T00:00:00.000Z");

    expect(read(record)).toEqual(changeRecord(changes, plan, "2026-11-05T00:00:00.000Z"));
    expect(read(record)).toMatchObject({ backend: "context-studio", record: "cs-p-1", applied_at: "2026-11-05T00:00:00.000Z", counts: { rename: 0, create: 1, delete: 0 } });
  });
});
