import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { mkdtempSync, rmSync } from "fs";
import {
  applyPlan,
  changeRecord,
  newSchema,
  planSpecChanges,
  alreadyLanded,
  nodeCitations,
  revisionCheck,
  skillCitations,
  type AttributeChange,
  type CsRecord,
  type NodeChange,
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

    it("derives the actions from the changes when the records list is empty", () => {
      // Context Studio makes no record for an operation applied before it recorded type changes.
      const plan = planSpecChanges(retarget([]), spec);
      expect(plan.actions.map((a) => [a.action, a.from, a.to])).toEqual([
        ["delete", old, null],
        ["create", id, id],
      ]);
    });

    it("refuses a record without a kind", () => {
      const { kind: _, ...noKind } = record("delete", old, kept);
      expect(() => planSpecChanges(retarget([noKind as CsRecord, record("create", id, id)]), spec)).toThrow(/has no kind/);
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

  describe("node types (context-studio#1462)", () => {
    const nodeFile = (layer: string, type: string) => path.join(spec, "schemas", "nodes", layer, `${type}.node.schema.json`);
    const layerFile = (id: string) => path.join(spec, "layers", `${id}.layer.json`);

    /** A node schema in the spec's own shape. */
    function writeFullNode(layer: string, type: string, extra: Record<string, unknown> = {}) {
      const id = `${layer}.${type}`;
      const schema = {
        $schema: "http://json-schema.org/draft-07/schema#",
        title: cap(type),
        description: `A ${type}.`,
        allOf: [{ $ref: "../../base/spec-node.schema.json" }],
        properties: {
          spec_node_id: { const: id },
          layer_id: { const: layer },
          type: { const: type },
          attributes: {
            type: "object",
            properties: { name: { type: "string", description: "Its name." }, kind: { type: "string", description: "Its kind.", enum: ["a", "b"] } },
            required: ["name"],
            additionalProperties: false,
          },
        },
        "x-dr-evidence": ["Seen in code."],
        "x-dr-distinguish": {},
        ...extra,
      };
      fs.mkdirSync(path.dirname(nodeFile(layer, type)), { recursive: true });
      fs.writeFileSync(nodeFile(layer, type), JSON.stringify(schema, null, 2) + "\n");
    }
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    function writeLayer(id: string, nodeTypes: string[]) {
      fs.mkdirSync(path.join(spec, "layers"), { recursive: true });
      fs.writeFileSync(layerFile(id), JSON.stringify({ id, name: `${id} layer`, node_types: nodeTypes }, null, 2) + "\n");
    }

    const node = (op: NodeChange["op"], id: string, more: Partial<NodeChange> = {}): NodeChange => ({ seq: 1, op_id: `n-${id}`, op, spec_node_id: id, layer_id: id.split(".")[0], ...more });
    const nodeDoc = (node_changes: NodeChange[], changes: SpecChange[] = [], records?: CsRecord[]): SpecChanges => ({ ...doc(...changes), node_changes, ...(records ? { records } : {}) });

    beforeEach(() => {
      writeLayer("application", ["application.applicationcollaboration", "application.applicationcomponent", "application.applicationinterface"]);
      writeLayer("technology", ["technology.node"]);
      writeFullNode("application", "applicationcomponent");
      writeFullNode("application", "applicationinterface", { "x-dr-distinguish": { "application.applicationcomponent": "it is the component itself" } });
    });

    it("creates a node type in the sibling files' shape and lists it in its layer", () => {
      const plan = planSpecChanges(nodeDoc([node("create", "application.applicationevent", { set: { title: "Application Event", description: "Something that happens." } })]), spec);
      applyPlan(doc(), plan, path.join(repo, "record.json"));

      const schema = read(nodeFile("application", "applicationevent"));
      expect(Object.keys(schema)).toEqual(["$schema", "title", "description", "allOf", "properties"]);
      expect(schema.title).toBe("Application Event");
      expect(schema.allOf).toEqual([{ $ref: "../../base/spec-node.schema.json" }]);
      expect(schema.properties).toEqual({
        spec_node_id: { const: "application.applicationevent" },
        layer_id: { const: "application" },
        type: { const: "applicationevent" },
        attributes: { type: "object", properties: {}, additionalProperties: false },
      });
      expect(read(layerFile("application")).node_types).toEqual(["application.applicationcollaboration", "application.applicationcomponent", "application.applicationevent", "application.applicationinterface"]);
      expect(plan.actions).toEqual([]);
      expect(plan.warnings.join("\n")).toMatch(/x-dr-standard, x-dr-evidence, x-dr-distinguish not set/);
    });

    it("refuses a create without a title or description, or with a malformed id", () => {
      expect(() => planSpecChanges(nodeDoc([node("create", "application.applicationevent", { set: { description: "D." } })]), spec)).toThrow(/a create needs a title/);
      expect(() => planSpecChanges(nodeDoc([node("create", "application.application_event", { set: { title: "T", description: "D." } })]), spec)).toThrow(/is not a \{layer\}\.\{type\} spec node id/);
      expect(() => planSpecChanges(nodeDoc([node("create", "application.applicationcomponent", { set: { title: "T", description: "D." } })]), spec)).toThrow(/already in the spec/);
      expect(() => planSpecChanges(nodeDoc([node("create", "application.applicationevent", { layer_id: "technology", set: { title: "T", description: "D." } })]), spec)).toThrow(/layer_id 'technology' is not the layer/);
    });

    it("updates a title and description in place", () => {
      const before = read(nodeFile("application", "applicationcomponent"));
      const plan = planSpecChanges(nodeDoc([node("update", "application.applicationcomponent", { set: { description: "A deployable unit." } })]), spec);
      applyPlan(doc(), plan, path.join(repo, "record.json"));
      const after = read(nodeFile("application", "applicationcomponent"));
      expect(after).toEqual({ ...before, description: "A deployable unit." });
      expect(Object.keys(after)).toEqual(Object.keys(before));
      expect(plan.actions).toEqual([]);
    });

    it("moves a node type to another layer, with its relationship schemas and x-dr-distinguish keys", () => {
      const r1 = "application.applicationcomponent.assigned-to.application.applicationinterface";
      const r2 = "application.applicationinterface.serves.application.applicationcomponent";
      const r1File = writeRelationship(r1, { description: "Defines relationship: application.applicationcomponent assigned-to application.applicationinterface" });
      writeRelationship(r2, { "x-dr-evidence": ["Kept."] });
      const plan = planSpecChanges(nodeDoc([node("move", "technology.applicationcomponent", { previous_spec_node_id: "application.applicationcomponent", set: { title: "Deployed Component" } })]), spec);
      applyPlan(doc(), plan, path.join(repo, "record.json"));

      expect(fs.existsSync(nodeFile("application", "applicationcomponent"))).toBe(false);
      const moved = read(nodeFile("technology", "applicationcomponent"));
      expect(moved.title).toBe("Deployed Component");
      expect(moved.properties.spec_node_id).toEqual({ const: "technology.applicationcomponent" });
      expect(moved.properties.layer_id).toEqual({ const: "technology" });
      expect(moved["x-dr-evidence"]).toEqual(["Seen in code."]);
      expect(read(layerFile("application")).node_types).not.toContain("application.applicationcomponent");
      expect(read(layerFile("technology")).node_types).toEqual(["technology.applicationcomponent", "technology.node"]);

      expect(fs.existsSync(r1File)).toBe(false);
      const n1 = read(rel("technology", "applicationcomponent.assigned-to.applicationinterface.relationship.schema.json"));
      expect(n1.properties.id.const).toBe("technology.applicationcomponent.assigned-to.application.applicationinterface");
      expect(n1.properties.source_layer.const).toBe("technology");
      expect(n1.description).toBe("Defines relationship: technology.applicationcomponent assigned-to application.applicationinterface");
      const n2 = read(rel("application", "applicationinterface.serves.applicationcomponent.relationship.schema.json"));
      expect(n2.properties.id.const).toBe("application.applicationinterface.serves.technology.applicationcomponent");
      expect(n2.properties.destination_layer.const).toBe("technology");
      expect(n2["x-dr-evidence"]).toEqual(["Kept."]);
      expect(read(nodeFile("application", "applicationinterface"))["x-dr-distinguish"]).toEqual({ "technology.applicationcomponent": "it is the component itself" });

      expect(plan.actions.map((a) => [a.action, a.kind, a.from, a.to])).toEqual([["rename-type", "cs:move", "application.applicationcomponent", "technology.applicationcomponent"]]);
      expect(plan.warnings.join("\n")).toMatch(/cannot move elements to another layer/);
    });

    it("reads a relationship change naming a moved type by its old id as naming it now", () => {
      const r = "application.applicationcomponent.assigned-to.application.applicationinterface";
      writeRelationship(r);
      const plan = planSpecChanges(
        nodeDoc([node("move", "technology.applicationcomponent", { previous_spec_node_id: "application.applicationcomponent" })], [{ ...change("update", r, { strength: "high" }), seq: 2 }]),
        spec,
      );
      applyPlan(doc(), plan, path.join(repo, "record.json"));
      expect(read(rel("technology", "applicationcomponent.assigned-to.applicationinterface.relationship.schema.json")).properties.strength.const).toBe("high");
    });

    it("records relationship actions under the types' old names before the rename-type, for the generator", () => {
      const r = "application.applicationcomponent.assigned-to.application.applicationinterface";
      const renamed = "application.applicationcomponent.provides.application.applicationinterface";
      writeRelationship(r);
      const changes = nodeDoc(
        [node("update", "application.deployedcomponent", { previous_spec_node_id: "application.applicationcomponent" })],
        [{ ...change("update", "application.deployedcomponent.provides.application.applicationinterface", {}, { previous_relationship_id: "application.deployedcomponent.assigned-to.application.applicationinterface" }), seq: 2 }],
      );
      const plan = planSpecChanges(changes, spec);
      expect(plan.actions.map((a) => [a.action, a.from, a.to])).toEqual([
        ["rename", r, renamed],
        ["rename-type", "application.applicationcomponent", "application.deployedcomponent"],
      ]);
      const { table } = buildRewriteTable([{ file: "applied-cs-p-1.json", ...changeRecord(changes, plan, "2026-11-09T00:00:00.000Z") } as never], new Set(["application.deployedcomponent.provides.application.applicationinterface"]));
      expect(table.typeRenames).toEqual({ "application.applicationcomponent": "application.deployedcomponent" });
      expect(table.triples["application.deployedcomponent.assigned-to.application.applicationinterface"]?.to).toBe("application.deployedcomponent.provides.application.applicationinterface");
    });

    it("refuses a move onto a node type that exists", () => {
      expect(() => planSpecChanges(nodeDoc([node("move", "application.applicationinterface", { previous_spec_node_id: "application.applicationcomponent" })]), spec)).toThrow(/application\.applicationinterface is already in the spec/);
    });

    it("deletes a node type whose relationship types the proposal also deletes, recording its replacement", () => {
      const r = "application.applicationcomponent.assigned-to.application.applicationinterface";
      writeRelationship(r);
      const plan = planSpecChanges(nodeDoc([{ ...node("delete", "application.applicationcomponent", { replacement_spec_node_id: "application.applicationinterface" }), seq: 2 }], [change("delete", r)]), spec);
      applyPlan(doc(), plan, path.join(repo, "record.json"));

      expect(fs.existsSync(nodeFile("application", "applicationcomponent"))).toBe(false);
      expect(read(layerFile("application")).node_types).not.toContain("application.applicationcomponent");
      expect(plan.actions.map((a) => [a.action, a.kind, a.from, a.to])).toEqual([
        ["delete", "cs:delete", r, null],
        ["rename-type", "cs:delete", "application.applicationcomponent", "application.applicationinterface"],
      ]);
      // application.applicationinterface's x-dr-distinguish still names the deleted type
      expect(plan.warnings.join("\n")).toMatch(/applicationinterface\.node\.schema\.json: x-dr-distinguish .* names application\.applicationcomponent/);
    });

    it("refuses a delete that leaves a relationship schema naming the type", () => {
      writeRelationship("application.applicationcomponent.assigned-to.application.applicationinterface");
      expect(() => planSpecChanges(nodeDoc([node("delete", "application.applicationcomponent")]), spec)).toThrow(/names node type application\.applicationcomponent, which is not in the spec once this export is applied/);
    });

    it("refuses a delete whose replacement the export also deletes", () => {
      expect(() =>
        planSpecChanges(nodeDoc([node("delete", "application.applicationcomponent", { replacement_spec_node_id: "application.applicationinterface" }), { ...node("delete", "application.applicationinterface"), seq: 2 }]), spec),
      ).toThrow(/its replacement application\.applicationinterface is not in the spec once this export is applied/);
    });

    it("takes Context Studio's rename-type records when they match the node changes", () => {
      const move = node("move", "technology.applicationcomponent", { previous_spec_node_id: "application.applicationcomponent" });
      const record: CsRecord = { action: "rename-type", kind: "cs:move", from: "application.applicationcomponent", to: "technology.applicationcomponent", p: 1, swap: false, proposal_id: "p-1", operation_id: move.op_id };
      const plan = planSpecChanges(nodeDoc([move], [], [record]), spec);
      expect(plan.actions).toEqual([
        {
          action: "rename-type",
          kind: "cs:move",
          from: "application.applicationcomponent",
          to: "technology.applicationcomponent",
          p: 1,
          claims: [],
          note: "Context Studio proposal p-1 seq 1 (move)",
          file_removed: "spec/schemas/nodes/application/applicationcomponent.node.schema.json",
          file_written: "spec/schemas/nodes/technology/applicationcomponent.node.schema.json",
        },
      ]);
      expect(() => planSpecChanges(nodeDoc([move], [], [{ ...record, to: "technology.other" }]), spec)).toThrow(/rename-type records don't match the node changes/);
    });

    it("lists the layer-skill lines that name a node type", () => {
      const dir = path.join(repo, "integrations", "claude_code", "skills", "dr_05_application_layer");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), ["Use application.applicationcomponent for services.", "application.applicationcomponentgroup is different."].join("\n"));
      expect(nodeCitations(repo, ["application.applicationcomponent"])).toEqual(["integrations/claude_code/skills/dr_05_application_layer/SKILL.md:1 cites application.applicationcomponent"]);
    });

    it("creates and updates the x-dr-* fields, keeping them last and checking distinguish keys", () => {
      const plan = planSpecChanges(
        nodeDoc([
          node("create", "application.applicationevent", { set: { title: "Event", description: "D.", standard: "ArchiMate 3.2 Application Event", evidence: ["An emitted event."], distinguish: { "application.applicationcomponent": "it is the component" } } }),
          { ...node("update", "application.applicationcomponent", { set: { standard: "ArchiMate 3.2 Application Component", evidence: [], distinguish: null } }), seq: 2 },
        ]),
        spec,
      );
      applyPlan(doc(), plan, path.join(repo, "record.json"));
      const created = read(nodeFile("application", "applicationevent"));
      expect(Object.keys(created)).toEqual(["$schema", "title", "description", "allOf", "properties", "x-dr-standard", "x-dr-evidence", "x-dr-distinguish"]);
      expect(created["x-dr-distinguish"]).toEqual({ "application.applicationcomponent": "it is the component" });
      const updated = read(nodeFile("application", "applicationcomponent"));
      expect(Object.keys(updated).slice(-1)).toEqual(["x-dr-standard"]);
      expect(updated["x-dr-evidence"]).toBeUndefined();
      expect(plan.warnings.join("\n")).not.toMatch(/applicationevent: x-dr/);

      expect(() => planSpecChanges(nodeDoc([node("update", "application.applicationcomponent", { set: { distinguish: { "application.nothing": "x" } } })]), spec)).toThrow(/distinguish names application\.nothing, which is not a node type/);
      expect(() => planSpecChanges(nodeDoc([node("update", "application.applicationcomponent", { set: { distinguish: { "application.applicationcomponent": "x" } } })]), spec)).toThrow(/distinguish names the type itself/);
      // a key may name a type by the id a move in the same export gives it
      const moved = nodeDoc([node("move", "technology.applicationinterface", { previous_spec_node_id: "application.applicationinterface" }), { ...node("update", "application.applicationcomponent", { set: { distinguish: { "technology.applicationinterface": "it is the interface" } } }), seq: 2 }]);
      expect(() => planSpecChanges(moved, spec)).not.toThrow();
    });

    describe("attributes (context-studio#1461)", () => {
      const attr = (op: AttributeChange["op"], attribute: string, set: AttributeChange["set"] = {}, more: Partial<AttributeChange> = {}): AttributeChange => ({ seq: 1, op, spec_node_id: "application.applicationcomponent", attribute, set, ...more });
      const attrDoc = (...attribute_changes: AttributeChange[]): SpecChanges => ({ ...doc(), attribute_changes });
      const attributes = () => read(nodeFile("application", "applicationcomponent")).properties.attributes;

      it("creates an attribute from its whole schema, required", () => {
        const plan = planSpecChanges(attrDoc(attr("create", "timeoutSeconds", { description: "How long it may take.", required: true, type: "number", minimum: 0 })), spec);
        applyPlan(doc(), plan, path.join(repo, "record.json"));
        const a = attributes();
        expect(a.properties.timeoutSeconds).toEqual({ type: "number", description: "How long it may take.", minimum: 0 });
        expect(Object.keys(a.properties.timeoutSeconds)).toEqual(["type", "description", "minimum"]);
        expect(a.required).toEqual(["name", "timeoutSeconds"]);
        expect(Object.keys(a)).toEqual(["type", "properties", "required", "additionalProperties"]);
        expect(plan.warnings.join("\n")).toMatch(/new required attribute/);
      });

      it("updates only the keywords given, removes one set to null, and makes an attribute optional", () => {
        applyPlan(doc(), planSpecChanges(attrDoc(attr("update", "kind", { enum: null }), { ...attr("update", "name", { required: false, description: "The name." }), seq: 2 }), spec), path.join(repo, "record.json"));
        const a = attributes();
        expect(a.properties.kind).toEqual({ type: "string", description: "Its kind." });
        expect(a.properties.name).toEqual({ type: "string", description: "The name." });
        expect(a.required).toBeUndefined();
        expect(Object.keys(a)).toEqual(["type", "properties", "additionalProperties"]);
      });

      it("replaces an enum in place", () => {
        applyPlan(doc(), planSpecChanges(attrDoc(attr("update", "kind", { enum: ["a", "b", "c"] })), spec), path.join(repo, "record.json"));
        expect(attributes().properties.kind).toEqual({ type: "string", description: "Its kind.", enum: ["a", "b", "c"] });
      });

      it("deletes an attribute and its required entry", () => {
        applyPlan(doc(), planSpecChanges(attrDoc(attr("delete", "name")), spec), path.join(repo, "record.json"));
        const a = attributes();
        expect(Object.keys(a.properties)).toEqual(["kind"]);
        expect(a.required).toBeUndefined();
      });

      it("adds attributes to a node type an earlier change created", () => {
        const changes: SpecChanges = { ...nodeDoc([node("create", "application.applicationevent", { set: { title: "Event", description: "D." } })]), attribute_changes: [{ ...attr("create", "when", { type: "string", description: "When.", required: false }), spec_node_id: "application.applicationevent", seq: 2 }] };
        applyPlan(doc(), planSpecChanges(changes, spec), path.join(repo, "record.json"));
        expect(read(nodeFile("application", "applicationevent")).properties.attributes.properties.when).toEqual({ type: "string", description: "When." });
      });

      it("refuses bad attribute changes", () => {
        expect(() => planSpecChanges(attrDoc(attr("create", "name", { type: "string", description: "D." })), spec)).toThrow(/already has attribute 'name'/);
        expect(() => planSpecChanges(attrDoc(attr("update", "missing", { description: "D." })), spec)).toThrow(/has no attribute 'missing'/);
        expect(() => planSpecChanges(attrDoc(attr("create", "size", { type: "float", description: "D." })), spec)).toThrow(/type 'float' is not one of/);
        expect(() => planSpecChanges(attrDoc(attr("create", "size", { type: "number" })), spec)).toThrow(/a create needs a description/);
        expect(() => planSpecChanges(attrDoc(attr("update", "name", { frobs: 1 })), spec)).toThrow(/'frobs', which is not a JSON Schema keyword/);
        expect(() => planSpecChanges(attrDoc({ ...attr("delete", "name"), spec_node_id: "application.nothing" }), spec)).toThrow(/node type application\.nothing is not in the spec/);
      });
    });
  });

  describe("predicates (context-studio#1481)", () => {
    const predicateFile = () => path.join(spec, "schemas", "base", "predicates.json");
    const semantics = { directionality: "unidirectional", transitivity: false, symmetry: false, reflexivity: false };
    const pred = (op: "create" | "update", predicate: string, set: Record<string, unknown>, seq = 1) => ({ seq, op, predicate, set });

    it("creates a predicate a relationship change in the export then uses", () => {
      const id = "application.applicationcomponent.hosts.application.applicationinterface";
      const changes: SpecChanges = {
        ...doc({ ...change("create", id), seq: 2 }),
        predicate_changes: [pred("create", "hosts", { description: "Runs another element.", inverse: "hosted-by", category: "structural", archimate_alignment: null, semantics })],
      };
      const plan = planSpecChanges(changes, spec);
      applyPlan(changes, plan, path.join(repo, "record.json"));
      expect(read(predicateFile()).predicates.hosts).toEqual({ predicate: "hosts", inverse: "hosted-by", category: "structural", description: "Runs another element.", archimate_alignment: null, semantics });
      expect(fs.existsSync(rel("application", "applicationcomponent.hosts.applicationinterface.relationship.schema.json"))).toBe(true);
      expect(plan.actions.map((a) => a.action)).toEqual(["create"]);
    });

    it("updates only the values given, merging semantics", () => {
      fs.writeFileSync(predicateFile(), JSON.stringify({ predicates: { uses: { predicate: "uses", inverse: "used-by", category: "dependency", description: "Uses.", archimate_alignment: "Serving", semantics: { ...semantics, transitivity: true } } } }));
      applyPlan(doc(), planSpecChanges({ ...doc(), predicate_changes: [pred("update", "uses", { description: "Depends on the services of.", semantics: { symmetry: true } })] }, spec), path.join(repo, "record.json"));
      expect(read(predicateFile()).predicates.uses).toEqual({ predicate: "uses", inverse: "used-by", category: "dependency", description: "Depends on the services of.", archimate_alignment: "Serving", semantics: { ...semantics, transitivity: true, symmetry: true } });
    });

    it("refuses bad predicate changes, checked against the catalog's schema", () => {
      fs.writeFileSync(path.join(spec, "schemas", "base", "predicate-catalog.schema.json"), JSON.stringify({ definitions: { PredicateDefinition: { properties: { category: { enum: ["structural"] }, archimate_alignment: { enum: ["Serving", null] }, semantics: { properties: { directionality: { enum: ["unidirectional", "bidirectional"] } } } } } } }));
      const ok = { description: "D.", inverse: "x-by", category: "structural", semantics };
      expect(() => planSpecChanges({ ...doc(), predicate_changes: [pred("create", "uses", ok)] }, spec)).toThrow(/'uses' is already in the predicate catalog/);
      expect(() => planSpecChanges({ ...doc(), predicate_changes: [pred("create", "Hosts", ok)] }, spec)).toThrow(/is not a predicate name/);
      expect(() => planSpecChanges({ ...doc(), predicate_changes: [pred("create", "hosts", { ...ok, category: "nope" })] }, spec)).toThrow(/category 'nope' is not one of structural/);
      expect(() => planSpecChanges({ ...doc(), predicate_changes: [pred("create", "hosts", { ...ok, semantics: { directionality: "both" } })] }, spec)).toThrow(/directionality 'both'[\s\S]*needs semantics\.transitivity/);
      expect(() => planSpecChanges({ ...doc(), predicate_changes: [pred("update", "frobs", { description: "D." })] }, spec)).toThrow(/'frobs' is not in the predicate catalog/);
    });
  });

  describe("predicate retirements (context-studio#1440)", () => {
    const retire = (from: string, to: string | null): CsRecord => ({ action: "retire-predicate", kind: "cs:retire-predicate", from, to, p: 1, proposal_id: "p-1" });
    const predicates = () => read(path.join(spec, "schemas", "base", "predicates.json")).predicates;

    it("removes a predicate no schema uses once the export's changes are made", () => {
      const r = "application.applicationcomponent.provides.application.applicationinterface";
      writeRelationship(r);
      const changes: SpecChanges = { ...doc(change("update", "application.applicationcomponent.serves.application.applicationinterface", {}, { previous_relationship_id: r })), records: [retire("provides", "serves")] };
      const plan = planSpecChanges(changes, spec);
      applyPlan(changes, plan, path.join(repo, "record.json"));

      expect(Object.keys(predicates())).toEqual(["aggregates", "assigned-to", "uses", "serves"]);
      expect(plan.actions.map((a) => [a.action, a.from, a.to])).toEqual([
        ["rename", r, "application.applicationcomponent.serves.application.applicationinterface"],
        ["retire-predicate", "provides", "serves"],
      ]);
      expect(read(path.join(repo, "record.json")).counts).toMatchObject({ rename: 1, "retire-predicate": 1 });
    });

    it("refuses to retire a predicate a schema still uses, or into an unknown one", () => {
      writeRelationship("application.applicationcomponent.provides.application.applicationinterface");
      expect(() => planSpecChanges({ ...doc(), records: [retire("provides", "serves")] }, spec)).toThrow(/retire-predicate provides: 1 relationship schemas still use it/);
      expect(() => planSpecChanges({ ...doc(), records: [retire("uses", "frobs")] }, spec)).toThrow(/its replacement 'frobs' is not in the predicate catalog/);
      expect(() => planSpecChanges({ ...doc(), records: [retire("frobs", "uses")] }, spec)).toThrow(/'frobs' is not in the predicate catalog/);
    });
  });

  describe("source revision (context-studio#1463)", () => {
    const git = (...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: repo });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString().trim();
    };
    const id = "application.applicationcomponent.assigned-to.application.applicationinterface";
    let commit: string;

    beforeEach(() => {
      writeRelationship(id);
      writeRelationship("application.applicationcomponent.uses.application.applicationinterface");
      fs.writeFileSync(path.join(spec, "VERSION"), "0.11.0\n");
      git("init", "-q");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "add", ".");
      git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base");
      commit = git("rev-parse", "HEAD");
    });

    const check = (changes: SpecChanges) => revisionCheck(changes, planSpecChanges(changes, spec), repo);

    it("lands an export whose files haven't changed since its commit", () => {
      fs.writeFileSync(rel("application", "applicationcomponent.uses.applicationinterface.relationship.schema.json"), JSON.stringify(newSchema("application.applicationcomponent.uses.application.applicationinterface", { description: "Edited since." })));
      const result = check({ ...doc(change("update", id, { strength: "high" })), source_revision: { commit, spec_version: "0.11.0" } });
      expect(result.problems).toEqual([]);
      expect(result.notes.join()).toMatch(/1 spec files changed since, none of them ones this export changes/);
    });

    it("refuses an export when a file it changes changed since its commit", () => {
      fs.writeFileSync(rel("application", "applicationcomponent.assigned-to.applicationinterface.relationship.schema.json"), JSON.stringify(newSchema(id, { description: "Edited since." })));
      const result = check({ ...doc(change("update", id, { strength: "high" })), source_revision: { commit } });
      expect(result.problems.join()).toMatch(/1 files it changes have changed since: spec\/schemas\/relationships\/application\/applicationcomponent\.assigned-to\.applicationinterface/);
    });

    it("refuses an unknown commit, and a different spec version with no commit", () => {
      expect(check({ ...doc(change("update", id, { strength: "high" })), source_revision: { commit: "0123456789abcdef0123456789abcdef01234567" } }).problems.join()).toMatch(/which this repository doesn't have/);
      expect(check({ ...doc(change("update", id, { strength: "high" })), source_revision: { spec_version: "0.10.0" } }).problems.join()).toMatch(/drafted against spec 0\.10\.0, but the spec is 0\.11\.0/);
    });

    it("refuses an export Context Studio says already landed", () => {
      expect(alreadyLanded({ ...doc(), landed: null })).toBeNull();
      expect(alreadyLanded({ ...doc(), landed: { repo: "r", commit: "0123456789abcdef", spec_version: "0.11.0", landed_at: "2026-11-09T00:00:00Z" } })).toMatch(/already landed at 0123456789ab \(spec 0\.11\.0\)/);
    });

    it("notes an export without a source revision", () => {
      const result = check(doc(change("update", id, { strength: "high" })));
      expect(result.problems).toEqual([]);
      expect(result.notes.join()).toMatch(/names no source revision/);
    });
  });
});
