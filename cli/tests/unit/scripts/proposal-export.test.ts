/**
 * proposal-export.ts writes each delete's structured replacement for Context Studio
 * (tinkermonkey/context-studio#1398), with DR's own pair verdict from pairOf.
 */
import { describe, expect, it } from "bun:test";
import { pairOf } from "../../../scripts/spec-enrich/apply-reflect-plan.js";
import { normalize, operationsFromDecision, type Operation, type WalkRow } from "../../../scripts/spec-enrich/proposal-export.js";

const PERFORMS_FUNCTION = "business.businessrole.performs.business.businessfunction";
const ASSIGNED_TO_PROCESS = "business.businessrole.assigned-to.business.businessprocess";
const ASSIGNED_TO_FUNCTION = "business.businessrole.assigned-to.business.businessfunction";
const ASSIGNED_TO_INTERFACE = "business.businessrole.assigned-to.business.businessinterface";
const SERVES_ROLE = "business.businessinterface.serves.business.businessrole";

function op(overrides: Partial<Operation>): Operation {
  return {
    seq: 0,
    op: "delete",
    kind: "property",
    target_id: PERFORMS_FUNCTION,
    ref: null,
    fields: {},
    replacement: null,
    base: {},
    rationale: "r",
    evidence: [],
    probability: 0.5,
    scope: null,
    status: "pending",
    dr: { plan_row: 1, plan_kind: "compound", triple: PERFORMS_FUNCTION, replacement: [], claims: [] },
    ...overrides,
  };
}

function walk(overrides: Partial<WalkRow>): WalkRow {
  return { row: 17, triple: PERFORMS_FUNCTION, kind: "compound", decision: "delete", replacement: null, rationale: "why", adjudicated_by: "maintainer", ...overrides };
}

describe("pairOf", () => {
  it("is same, reversed or different by element types, ignoring the predicate", () => {
    expect(pairOf(PERFORMS_FUNCTION, ASSIGNED_TO_FUNCTION)).toBe("same");
    expect(pairOf(ASSIGNED_TO_INTERFACE, SERVES_ROLE)).toBe("reversed");
    expect(pairOf(PERFORMS_FUNCTION, ASSIGNED_TO_PROCESS)).toBe("different");
  });
});

describe("delete replacements", () => {
  it("a walk delete carries its replacement and DR's pair verdict (Gate B row 17)", () => {
    const planOp = op({ replacement: ASSIGNED_TO_PROCESS });
    const [different] = normalize(operationsFromDecision(walk({ replacement: ASSIGNED_TO_PROCESS }), planOp, new Map()), new Map());
    expect(different.replacement).toBe(ASSIGNED_TO_PROCESS);
    expect(different.dr.replacement_pair).toBe("different");

    // documentation_robotics#993 overrode row 17 with a same-pair replacement
    const [same] = normalize(operationsFromDecision(walk({ replacement: ASSIGNED_TO_FUNCTION }), planOp, new Map()), new Map());
    expect(same.replacement).toBe(ASSIGNED_TO_FUNCTION);
    expect(same.dr.replacement_pair).toBe("same");
  });

  it("a walk delete with no replacement, its also_delete twins and its updates carry none", () => {
    const planOp = op({ replacement: ASSIGNED_TO_PROCESS });
    const ops = normalize(operationsFromDecision(walk({ also_delete: [ASSIGNED_TO_INTERFACE] }), planOp, new Map()), new Map());
    expect(ops.map((o) => o.replacement)).toEqual([null, null]);
    expect(ops.every((o) => o.dr.replacement_pair === undefined)).toBe(true);

    const [rename] = normalize(operationsFromDecision(walk({ decision: "rename", replacement: ASSIGNED_TO_FUNCTION }), op({ base: { predicate: "performs", source_spec_node_id: "business.businessrole", destination_spec_node_id: "business.businessfunction" } }), new Map()), new Map());
    expect(rename.op).toBe("update");
    expect(rename.replacement).toBeNull();
  });

  it("a walk delete whose replacement is one of its own adds comes after that create", () => {
    const [create, del] = normalize(operationsFromDecision(walk({ replacement: ASSIGNED_TO_FUNCTION, add: [ASSIGNED_TO_FUNCTION] }), op({}), new Map()), new Map());
    expect(create.op).toBe("create");
    expect(create.fields.relationship_id).toBe(ASSIGNED_TO_FUNCTION);
    expect(create.ref).toBe(`c${create.seq}`);
    expect(del.op).toBe("delete");
    expect(del.seq).toBeGreaterThan(create.seq);
    expect(del.replacement).toBe(ASSIGNED_TO_FUNCTION);
  });

  it("an update onto a triple an earlier operation produces becomes a delete naming it (reversed here)", () => {
    const base = { predicate: "assigned-to", source_spec_node_id: "business.businessrole", destination_spec_node_id: "business.businessinterface" };
    const first = op({ op: "update", target_id: "business.businessinterface.uses.business.businessrole", fields: { predicate: "serves" }, base: { predicate: "uses", source_spec_node_id: "business.businessinterface", destination_spec_node_id: "business.businessrole" } });
    const second = op({ op: "update", target_id: ASSIGNED_TO_INTERFACE, fields: { predicate: "serves", source_spec_node_id: "business.businessinterface", destination_spec_node_id: "business.businessrole" }, base });
    const [, twin] = normalize([first, second], new Map());
    expect(twin.op).toBe("delete");
    expect(twin.replacement).toBe(SERVES_ROLE);
    expect(twin.dr.replacement_pair).toBe("reversed");
  });
});
