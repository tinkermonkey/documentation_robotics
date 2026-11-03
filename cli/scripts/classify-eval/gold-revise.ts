/**
 * Apply a labelling-policy revision to a corpus's gold labels, keeping the previous set.
 *
 *   bun gold-revise.ts --corpus fastapi [--dry-run]
 *
 * Revision "handlers" (maintainer decision, 2026-11-03): the gold labels filed both a CBM Route
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
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { corpusDir, flagStr, parseFlags, readJsonl, writeJsonl } from "./lib/io.js";
import { loadFacts, loadTier0Rules } from "./lib/tier0.js";
import { declarationOf } from "../../src/analyzers/tier0-rules.js";
import type { Card, Gold } from "./lib/types.js";

const NOTE = " [Revised 2026-11-03, gold-revise.ts 'handlers': ";

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const corpus = flagStr(flags, "corpus");
  if (!corpus) {
    console.error("Usage: bun gold-revise.ts --corpus <name> [--dry-run]");
    process.exit(2);
  }
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
