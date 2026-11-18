/**
 * Apply a labelling-policy revision to a corpus's gold labels, keeping the previous set.
 *
 *   bun gold-revise.ts --corpus fastapi [--revision handlers|declared-shape|store] [--dry-run]
 *
 * Revision "handlers" (the default; maintainer decision, 2026-11-03): the gold labels filed both a CBM Route
 * node and the function or method that handles it as api.operation, which would put two
 * operations in the model for every endpoint. The model is: the Route is the API operation and
 * the handler is the application function it realizes (api.operation realizes
 * application.applicationfunction, the HANDLES edge mapping). And an ORM class mapped to a table
 * is a data-model object schema whatever the framework (JPA @Entity, SQLModel table=True), with
 * the table a data-store collection derived from it (objectschema maps-to collection); gold had
 * filed SQLModel table classes as data-store.collection and JPA entities as object schemas.
 *
 * So, for cards whose gold says otherwise:
 *   - a Function or Method with a route-mapping decorator (the decorator test of the cbm
 *     tier0_route_handler rule) labelled api.operation becomes application.applicationfunction;
 *   - a Class declared with table=True labelled data-store.collection becomes
 *     data-model.objectschema.
 * Generated client SDK methods labelled api.operation are not handlers and are left alone. Each
 * changed label keeps its rationale with a note appended. The previous labels are written to
 * gold@pre-handlers.jsonl (once), and the cards changed are listed.
 *
 * The cards selected are the ones the Tier-0 rules decide, so after the revision those rules agree
 * with gold by construction: the revision fixes the labelling policy, it is not evidence for the
 * rules. The in-sample caveat in docs/EXTRACTION_STRATEGY.md stands.
 *
 * Revision "declared-shape" (maintainer rulings, 2026-11-17, landed in the spec as Context Studio
 * proposals 96a0a30f, 8836f9cb, ce4bfe6b, c2972281 and 5cd62ebe): the labels predate four rulings
 * on what a code symbol is. The revision is the list in data/gold-revision@declared-shape.json,
 * one entry per changed card with the clause that moved it:
 *   - declared-shape: an interface that no earlier Tier-0 rule decides (generated code, component
 *     props, Spring Data repositories), labelled application.dataobject or none, that declares at
 *     least one data field, is a data-model.objectschema. The maintainer ruled that every typed
 *     interface is an object schema, small ones included.
 *   - record: a class labelled application.dataobject that only declares fields (a record, a DTO,
 *     a view model with at most trivial constructors and derived getters) is a
 *     data-model.objectschema. A class with logic of its own over its state stays a data object.
 *   - service-contract: a language-level interface labelled application.applicationinterface
 *     declares the operations a service offers, so it is an application.applicationservice.
 *   - message: a type sent to a receiver expected to act on it (a WebSocket protocol frame, a
 *     JSON-RPC request or notification, a mediator command) is an application.message.
 * Its `kept` list names the interfaces left as not-an-element and why: they declare only
 * operations or no members, or they type a framework, global or third-party object (a module
 * augmentation, an ambient .d.ts declaration) rather than a shape of the program's own data.
 * Type modules, named slices and integer aliases are not covered by the rulings and are left.
 * The list was drawn up by reading the cards, in-sample and held-out alike, so it is labelling
 * policy and not evidence: the Tier-0 interface rule was rewritten from the same rulings. The
 * previous labels are written to gold@pre-declared-shape.jsonl (once).
 *
 * Revision "store" (maintainer ruling, 2026-11-18, landed in the spec as Context Studio proposal
 * e7a10b16 and in the application layer skill): a state container (a Zustand store, a Redux slice,
 * a class that only holds state in memory) is an application.dataobject when its actions only set,
 * derive from or reset its own state, and an application.applicationcomponent when they call
 * services or do I/O. The labels predate the ruling and file every store as a component. The
 * revision is the list in data/gold-revision@store.json:
 *   - store-state: a store's file module, or a class that is a store, labelled
 *     application.applicationcomponent, whose actions only manage its own state, is an
 *     application.dataobject. Saving state to browser storage counts as I/O (maintainer,
 *     2026-11-18: whole applications are built on local storage), so a store persisted to
 *     localStorage through a persistence middleware stays a component (two such cards, in `kept`).
 * Its `kept` list names the stores left as they are and why: their actions call a service or an
 * API, a more specific layer's type already applies, or the module is a barrel and holds no state.
 * A store's individual actions (Function cards) and view models are not covered by the ruling and
 * are left. The candidates were found by structure (a store library import, or a store class) in
 * all eight corpora, not from a model's answers; only the viewer has cards the clause changes. The
 * previous labels are written to gold@pre-store.jsonl (once).
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { corpusDir, flagStr, parseFlags, readJsonl, writeJsonl } from "./lib/io.js";
import { loadFacts, loadTier0Rules } from "./lib/tier0.js";
import { declarationOf } from "../../src/analyzers/tier0-rules.js";
import type { Card, Gold } from "./lib/types.js";

const NOTE = " [Revised 2026-11-03, gold-revise.ts 'handlers': ";

interface ShapeChange {
  corpus: string;
  card_id: string;
  label: string;
  name: string;
  from: string;
  to: string;
  clause: "declared-shape" | "record" | "service-contract" | "message" | "store-state";
  note?: string;
}

const SHAPE_NOTE = " [Revised 2026-11-17, gold-revise.ts 'declared-shape': ";
const SHAPE_WHY: Record<ShapeChange["clause"], string> = {
  "declared-shape": "a declaration that only states a shape is a data-model object schema, whether or not the shape is persisted or published.]",
  record: "a class that only declares fields is a data-model object schema; a data object is a class with logic of its own over its state.]",
  "service-contract": "a language-level interface that declares the operations a service offers is the application service, not an application interface.]",
  message: "a type sent to a receiver expected to act on it is an application message.]",
  "store-state": "a state container whose actions only manage its own state is an application data object; one whose actions call services or do I/O is an application component.]",
};
const STORE_NOTE = " [Revised 2026-11-18, gold-revise.ts 'store': ";

/** The list-driven revisions and the note each changed label gets. */
const LIST_REVISIONS: Record<string, { note: string }> = {
  "declared-shape": { note: SHAPE_NOTE },
  store: { note: STORE_NOTE },
};

const labelOf = (g: Gold): string => (g.layer === "none" ? "none" : `${g.layer}.${g.element_type}`);

/** Apply a list-driven revision ("declared-shape" or "store") to one corpus's gold. */
function reviseFromList(corpus: string, revision: string, dryRun: boolean): void {
  const dir = corpusDir(corpus);
  const note = LIST_REVISIONS[revision].note;
  const listFile = path.join(dir, "..", `gold-revision@${revision}.json`);
  const list = JSON.parse(readFileSync(listFile, "utf8")) as { changes: ShapeChange[] };
  const changes = new Map(list.changes.filter((c) => c.corpus === corpus).map((c) => [c.card_id, c]));
  const goldFile = path.join(dir, "gold.jsonl");
  const gold = readJsonl<Gold>(goldFile);
  const changed: string[] = [];
  const seen = new Set<string>();
  const revised = gold.map((g) => {
    const c = changes.get(g.card_id);
    if (!c) return g;
    seen.add(g.card_id);
    if (g.rationale.includes(note)) return g;
    if (labelOf(g) !== c.from) throw new Error(`${corpus} ${c.name} (${c.card_id}): gold is ${labelOf(g)}, the revision expects ${c.from}`);
    const [layer, element_type] = c.to.split(".");
    changed.push(`${c.label} ${c.name}: ${c.from} -> ${c.to} (${c.clause})`);
    return { ...g, layer, element_type, element_type_valid: true, rationale: g.rationale + note + SHAPE_WHY[c.clause] };
  });
  const missing = [...changes.keys()].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`${corpus}: ${missing.length} cards in the revision have no gold label: ${missing.join(", ")}`);
  console.log(`${corpus}: ${changed.length} gold labels revised${dryRun ? " (dry run)" : ""}`);
  for (const c of changed) console.log("  " + c);
  if (dryRun || !changed.length) return;
  const backup = path.join(dir, `gold@pre-${revision}.jsonl`);
  if (!existsSync(backup)) writeJsonl(backup, gold);
  writeJsonl(goldFile, revised);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  const revision = flagStr(flags, "revision", "handlers");
  if (!corpus || !revision || (revision !== "handlers" && !LIST_REVISIONS[revision])) {
    console.error("Usage: bun gold-revise.ts --corpus <name> [--revision handlers|declared-shape|store] [--dry-run]");
    process.exit(2);
  }
  if (LIST_REVISIONS[revision]) return reviseFromList(corpus, revision, !!flags["dry-run"]);
  const dir = corpusDir(corpus);
  const cards = new Map(readJsonl<Card>(path.join(dir, "cards.jsonl")).map((c) => [c.id, c]));
  const facts = loadFacts(corpus);
  const routeRule = loadTier0Rules().find((r) => r.name === "tier0_route_handler");
  if (!routeRule?.when.decorator) throw new Error("tier0_route_handler rule with a decorator condition not found");
  const isRoute = routeRule.when.decorator;
  const goldFile = path.join(dir, "gold.jsonl");
  const gold = readJsonl<Gold>(goldFile);
  const changed: string[] = [];
  const revised = gold.map((g) => {
    const card = cards.get(g.card_id);
    if (!card || g.rationale.includes(NOTE)) return g;
    const decorators = facts.get(card.id)?.decorator_names ?? [];
    if ((card.label === "Function" || card.label === "Method") && g.layer === "api" && g.element_type === "operation" && decorators.some((d) => isRoute.test(d))) {
      changed.push(`${card.label} ${card.qualified_name}: api.operation -> application.applicationfunction`);
      return { ...g, layer: "application", element_type: "applicationfunction", element_type_valid: true, rationale: g.rationale + NOTE + "the route handler is the application function the route's API operation realizes.]" };
    }
    if (card.label === "Class" && g.layer === "data-store" && g.element_type === "collection" && /\btable\s*=\s*True\b/.test(declarationOf(card.source, card.signature) ?? "")) {
      changed.push(`${card.label} ${card.qualified_name}: data-store.collection -> data-model.objectschema`);
      return { ...g, layer: "data-model", element_type: "objectschema", element_type_valid: true, rationale: g.rationale + NOTE + "an ORM table class is the object schema; its table is the collection it maps to.]" };
    }
    return g;
  });
  console.log(`${corpus}: ${changed.length} gold labels revised${flags["dry-run"] ? " (dry run)" : ""}`);
  for (const c of changed) console.log("  " + c);
  if (flags["dry-run"] || !changed.length) return;
  const backup = path.join(dir, "gold@pre-handlers.jsonl");
  if (!existsSync(backup)) writeJsonl(backup, gold);
  writeJsonl(goldFile, revised);
}

main();
