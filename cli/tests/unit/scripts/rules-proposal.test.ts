/**
 * rules-proposal.ts writes a layer rules pass as a dr-reflection-plan/1 proposal: the entity kind
 * is always "property", and the plan kind stays DR bookkeeping (context-studio#1440).
 */
import { describe, expect, it } from "bun:test";
import { rulesProposal, type RulesAction } from "../../../scripts/spec-enrich/rules-proposal.js";
import type { RelationshipSchema } from "../../../scripts/spec-enrich/lib/schemas.js";

const RENDERS = "ux.view.renders.ux.componentinstance";
const COMPOSES = "ux.view.composes.ux.componentinstance";
const RENDERS_SUBVIEW = "ux.view.renders.ux.subview";
const COMPOSES_SUBVIEW = "ux.view.composes.ux.subview";

function schema(id: string, description = `Defines relationship: ${id}`): [string, RelationshipSchema] {
  const [sl, st, predicate, dl, dt] = id.split(".");
  return [id, { file: `${id}.json`, id, source: `${sl}.${st}`, predicate, destination: `${dl}.${dt}`, sourceLayer: sl, destinationLayer: dl, description, evidence: [], raw: {} }];
}

const catalog = new Map([schema(RENDERS), schema(RENDERS_SUBVIEW, "A view shows a sub-view."), schema(COMPOSES_SUBVIEW)]);
const meta = { layer: "ux", title: "DR rules pass: ux", rationale: "Rules.", source_detail: "test", created_at: "2026-11-09T00:00:00.000Z" };

describe("rules-proposal.ts", () => {
  const actions: RulesAction[] = [
    { action: "rename", kind: "principles", from: RENDERS, to: COMPOSES, note: "placement is composition" },
    { action: "rename", kind: "reverse", from: RENDERS_SUBVIEW, to: COMPOSES_SUBVIEW, note: "the duplicate folds onto composes" },
    { action: "retire-predicate", from: "renders", to: "composes", note: "renders is retired into composes" },
  ];

  it("puts the plan kind in dr.plan_kind and the rationale, never in the entity kind", () => {
    const proposal = rulesProposal(actions, catalog, meta);
    expect(proposal.operations.map((o) => o.kind)).toEqual(["property", "property"]);
    expect(proposal.operations.map((o) => o.dr.plan_kind)).toEqual(["principles", "reverse"]);
    expect(proposal.operations[0].rationale).toBe("placement is composition (DR ux rules pass, plan kind principles)");
  });

  it("writes a rename as an update of the changed fields, and a rename onto an existing triple as a delete naming it", () => {
    const [update, twin] = rulesProposal(actions, catalog, meta).operations;
    expect(update).toMatchObject({ seq: 1, op: "update", target_id: RENDERS, fields: { predicate: "composes", title: "ux.view composes ux.componentinstance", description: "Defines relationship: ux.view composes ux.componentinstance" } });
    expect(twin).toMatchObject({ seq: 2, op: "delete", target_id: RENDERS_SUBVIEW, replacement: COMPOSES_SUBVIEW });
  });

  it("carries predicate retirements at the top level", () => {
    expect(rulesProposal(actions, catalog, meta).predicate_retirements).toEqual([{ from: "renders", to: "composes", note: "renders is retired into composes" }]);
  });

  it("writes deletes with their replacement and creates with the new id", () => {
    const proposal = rulesProposal(
      [
        { action: "create", kind: "principles", from: COMPOSES, to: COMPOSES, note: "new" },
        { action: "delete", kind: "principles", from: RENDERS, to: COMPOSES, note: "folds" },
      ],
      catalog,
      meta,
    );
    expect(proposal.operations[0]).toMatchObject({ op: "create", ref: "c1", fields: { relationship_id: COMPOSES, predicate: "composes" } });
    expect(proposal.operations[1]).toMatchObject({ op: "delete", target_id: RENDERS, replacement: COMPOSES });
    expect(proposal.predicate_retirements).toBeUndefined();
  });

  it("refuses actions on triples the spec doesn't have", () => {
    expect(() => rulesProposal([{ action: "delete", kind: "principles", from: "ux.view.frobs.ux.subview", to: null, note: "x" }], catalog, meta)).toThrow(/not in the spec/);
  });
});
