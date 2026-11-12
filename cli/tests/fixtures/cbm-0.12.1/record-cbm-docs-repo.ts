/**
 * Re-record cbm-docs-repo.responses.json: replay the extraction's reads against an index of the
 * tests/fixtures/cbm-docs-repo fixture (decision records, a superseding record, doc sections that
 * mention code). Run from cli/ after a CBM upgrade:
 *
 *   codebase-memory-mcp cli index_repository '{"repo_path":"'$PWD'/tests/fixtures/cbm-docs-repo"}'
 *   bun tests/fixtures/cbm-0.12.1/record-cbm-docs-repo.ts
 *
 * Every tool call collectExtraction makes is recorded with its response, the CBM project name and
 * the fixture's absolute path replaced by `docs-repo`, so the recording doesn't depend on where the
 * repository is checked out.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CbmTools } from "../../../src/analyzers/cbm-responses.js";
import { cbmCardGraph } from "../../../src/analyzers/cards/graph.js";
import { collectExtraction, extractionConfigFrom } from "../../../src/analyzers/cards/extract.js";
import { MappingLoader } from "../../../src/analyzers/mapping-loader.js";
import { tier0RulesFrom } from "../../../src/analyzers/tier0-rules.js";

const ROOT = resolve(import.meta.dir, "../cbm-docs-repo");
const ALIAS = "docs-repo";

function cli(tool: string, args: unknown): unknown {
  const out = spawnSync("codebase-memory-mcp", ["cli", "--quiet", tool, JSON.stringify(args ?? {})], { encoding: "utf-8" });
  if (out.status !== 0) throw new Error(`${tool} failed: ${out.stderr || out.stdout}`);
  return JSON.parse(out.stdout);
}

const projects = (cli("list_projects", { format: "json" }) as { projects: Array<{ name: string; root_path: string }> }).projects;
const PROJECT = projects.find((p) => p.root_path === ROOT)?.name;
if (!PROJECT) throw new Error(`${ROOT} is not indexed: run index_repository first`);

const alias = (v: unknown): unknown => JSON.parse(JSON.stringify(v).split(PROJECT).join(ALIAS).split(ROOT).join(`/${ALIAS}`));
const recorded: Array<{ tool: string; args: unknown; response: unknown }> = [];
const invoker = {
  async invokeTool(tool: string, args?: unknown) {
    const response = cli(tool, args);
    recorded.push({ tool, args: alias(args), response: alias(response) });
    return response;
  },
};

const mapping = await MappingLoader.load("cbm");
const nodeMappings = mapping.getNodeLabels().map((l) => mapping.getNodeMapping(l)).filter((m): m is NonNullable<typeof m> => !!m);
const edgeMappings = mapping.getEdgeTypes().map((t) => mapping.getEdgeMapping(t)).filter((m): m is NonNullable<typeof m> => !!m);
const config = extractionConfigFrom(tier0RulesFrom(mapping.getHeuristics()), edgeMappings, nodeMappings);
await collectExtraction(cbmCardGraph(new CbmTools(invoker), PROJECT), config, "cbm", { sourceRoot: ROOT });
const out = join(import.meta.dir, "cbm-docs-repo.responses.json");
writeFileSync(out, JSON.stringify({ cbm: "0.12.1", project: ALIAS, calls: recorded }, null, 1) + "\n");
console.log(`recorded ${recorded.length} calls to ${out}`);
