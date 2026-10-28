/**
 * Split each compound maintainer note into atomic claims (generative step).
 *
 *   bun split-notes.ts [--layer <id>] [--model sonnet|opus|haiku] [--limit n] [--force]
 *
 * Output: data/triage/claims.jsonl (one claim per line, stable ids <note id>#<n>).
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, claudeCost, mapConcurrent, MODEL_IDS } from "../classify-eval/lib/claude.js";
import { flagNum, flagStr, parseFlags, readJsonl, writeJsonl } from "../classify-eval/lib/io.js";
import { loadNotes, typeContext } from "./lib/intent.js";
import { harnessDir } from "./lib/paths.js";
import { CATEGORIES, CATEGORY_IDS, type Claim } from "./lib/triage-types.js";

const Output = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      category: z.enum(CATEGORY_IDS as unknown as [string, ...string[]]),
      affected_ids: z.array(z.string()),
      proposed_change: z.string(),
    }),
  ),
});

function system(): string {
  return [
    "You split a spec maintainer's note into atomic claims. A note is free text written by a model while defining one element type (or the relationships of one source type) in the Documentation Robotics architecture specification. It may bundle several unrelated concerns in one paragraph.",
    "For each distinct concern produce one claim:",
    "- text: the claim restated as one self-contained sentence that names the type, attribute, enum value or relationship it is about (a reader must not need the original note).",
    "- category: one of the ids below.",
    "- affected_ids: the spec ids the claim is about: element type ids like 'security.accesscondition', attribute paths like 'security.accesscondition.source', relationship ids like 'security.accesscondition.composes.security.policyrule'.",
    "- proposed_change: the concrete change the note implies, in one sentence, or 'none stated'.",
    "Do not merge concerns, do not add concerns the note does not make, do not judge whether the note is right.",
    "",
    "Categories:",
    ...Object.entries(CATEGORIES).map(([k, v]) => `- ${k}: ${v}`),
  ].join("\n");
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const layerFilter = flagStr(flags, "layer");
  const model = MODEL_IDS[flagStr(flags, "model", "sonnet") ?? "sonnet"] ?? "claude-sonnet-5-5";
  const limit = flagNum(flags, "limit", Infinity);
  const dir = path.join(harnessDir(), "data", "triage");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "claims.jsonl");
  const existing = readJsonl<Claim>(file);
  const have = new Set(existing.map((c) => c.note_id));
  const notes = loadNotes(layerFilter).filter((n) => flags.force || !have.has(n.id)).slice(0, limit);
  console.error(`Splitting ${notes.length} notes with ${model} (${existing.length} claims already on file)`);
  const client = anthropic();
  const format = zodOutputFormat(Output);
  const sys = system();
  let cost = 0;
  const fresh: Claim[] = [];
  await mapConcurrent(notes, flagNum(flags, "concurrency", 6), async (note, i) => {
    try {
      const res = await client.messages.parse({
        model,
        max_tokens: 4000,
        system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
        output_config: { effort: "low", format },
        messages: [{ role: "user", content: `Note about ${note.kind === "node" ? "the element type" : "the relationships of"} ${note.subject} (layer ${note.layer}):\n\n"""${note.text}"""\n\nContext (for resolving names only):\n${typeContext(note.subject, note.kind === "relationships")}` }],
      });
      if (!res.parsed_output) throw new Error(`no parsed output (${res.stop_reason})`);
      cost += claudeCost(model, res.usage);
      res.parsed_output.claims.forEach((c, k) => {
        fresh.push({ id: `${note.id}#${k + 1}`, note_id: note.id, layer: note.layer, subject: note.subject, kind: note.kind, text: c.text, category_hint: c.category, affected_ids: c.affected_ids, proposed_change: c.proposed_change });
      });
      console.error(`[${i + 1}/${notes.length}] ${note.id}: ${res.parsed_output.claims.length} claims`);
    } catch (e) {
      console.error(`[${i + 1}/${notes.length}] ${note.id} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const kept = flags.force ? existing.filter((c) => !notes.some((n) => n.id === c.note_id)) : existing;
  const all = [...kept, ...fresh].sort((a, b) => a.id.localeCompare(b.id));
  writeJsonl(file, all);
  console.error(`Done: ${fresh.length} new claims, ${all.length} total -> ${file}; approx cost $${cost.toFixed(3)}`);
}

void existsSync;
main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
