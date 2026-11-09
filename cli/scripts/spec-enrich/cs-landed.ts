/**
 * Tell Context Studio a decided proposal has landed in DR's spec, and list what hasn't.
 *
 *   bun cs-landed.ts mark <proposal-id> [--commit <sha>] [--record <file>] [--repo URL] [--cs-url URL] [--dry-run]
 *   bun cs-landed.ts unlanded [--cs-url URL]
 *
 * Context Studio's `done` means decided, not landed (context-studio#1463). After
 * cs-decisions-to-spec.ts has written a proposal's changes and they are committed, `mark` records
 * the landing on the proposal (PUT /api/proposals/{id}/landed): the origin remote's URL (as Context
 * Studio's importer records the repository), the commit that
 * holds data/cs-decisions/applied-cs-<id>.json (the latest one, unless --commit names another that
 * has it), and spec/VERSION at that commit. `unlanded` lists the dr_spec proposals Context Studio
 * has decided but nobody marked landed, saying which DR already landed (mark them) and which it
 * hasn't (export and land them).
 *
 * A proposal that only brought Context Studio up to date with a change DR made itself (removing
 * types a DR rules pass had already retired) is landed too, at the DR commit it mirrors: name that
 * pass's change record with --record (a path from the repository root, e.g.
 * cli/scripts/spec-enrich/data/applied-security-principles.json) and the commit with --commit.
 *
 * --cs-url defaults to $CONTEXT_STUDIO_URL, else http://localhost:8000.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { flagStr, parseFlags } from "../classify-eval/lib/io.js";
import { harnessDir } from "./lib/paths.js";

export const DR_TAXONOMY_IDENTIFIER = "dr_spec";

export interface Landing {
  repo: string | null;
  commit: string;
  spec_version: string | null;
}

function git(repo: string, ...args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** applied-cs-<id>.json, relative to the repository root. */
export function recordFor(repo: string, proposalId: string): string {
  return path.relative(repo, path.join(harnessDir(), "data", "cs-decisions", `applied-cs-${proposalId}.json`));
}

/**
 * The landing to report for a proposal: the commit that holds its change record, the spec
 * version there, and the repository.
 *
 * @throws Error when the change record is missing, uncommitted or not in the named commit
 */
export function landingFor(repo: string, recordRel: string, opts: { commit?: string; repo?: string } = {}): Landing {
  const dirty = git(repo, "status", "--porcelain", "--", recordRel);
  if (dirty.out) throw new Error(`${recordRel} has uncommitted changes: commit the landing first`);
  let commit: string;
  if (opts.commit) {
    const resolved = git(repo, "rev-parse", "--verify", `${opts.commit}^{commit}`);
    if (!resolved.ok) throw new Error(`${opts.commit} is not a commit here`);
    commit = resolved.out;
    if (!git(repo, "cat-file", "-e", `${commit}:${recordRel}`).ok) throw new Error(`${recordRel} is not in ${commit.slice(0, 12)}: that commit doesn't hold this landing`);
  } else {
    commit = git(repo, "log", "-1", "--format=%H", "--", recordRel).out;
    if (!commit) throw new Error(`${recordRel} is not committed: land the proposal with cs-decisions-to-spec.ts and commit it first`);
  }
  const version = git(repo, "show", `${commit}:spec/VERSION`);
  const remote = git(repo, "remote", "get-url", "origin");
  return { repo: opts.repo ?? (remote.ok && remote.out ? remote.out : null), commit, spec_version: version.ok ? version.out : null };
}

async function request(url: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch (e) {
    throw new Error(`Context Studio is not reachable at ${url}: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url}: ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function mark(csUrl: string, repo: string, proposalId: string, flags: Record<string, string | boolean>) {
  const record = flagStr(flags, "record") ?? recordFor(repo, proposalId);
  const landing = landingFor(repo, record, { commit: flagStr(flags, "commit"), repo: flagStr(flags, "repo") });
  const url = `${csUrl}/api/proposals/${encodeURIComponent(proposalId)}/landed`;
  if (flags["dry-run"]) {
    console.log(`[dry run] PUT ${url} ${JSON.stringify(landing)}`);
    return;
  }
  const proposal = await request(url, { method: "PUT", body: JSON.stringify(landing) });
  if (!proposal?.landed) throw new Error(`Context Studio accepted the request but reports no landing on ${proposalId}; is its landed state (context-studio#1463) deployed?`);
  console.log(`marked ${proposalId} (${proposal.title}) landed at ${landing.commit.slice(0, 12)}, spec ${landing.spec_version ?? "?"}${landing.repo ? `, ${landing.repo}` : ""}`);
}

async function unlanded(csUrl: string, repo: string) {
  const taxonomies = await request(`${csUrl}/api/taxonomies?limit=500`);
  const taxonomy = (taxonomies.items ?? taxonomies).find((t: { identifier?: string }) => t.identifier === DR_TAXONOMY_IDENTIFIER);
  if (!taxonomy) throw new Error(`Context Studio at ${csUrl} has no ${DR_TAXONOMY_IDENTIFIER} taxonomy`);
  const list = await request(`${csUrl}/api/proposals?taxonomy_id=${taxonomy.id}&status=done&landed=false&limit=500`);
  const items: Array<{ id: string; title: string; landed?: unknown; decided_at?: string; updated_at?: string }> = list.items ?? [];
  if (items.length && items.every((p) => !("landed" in p))) {
    console.error(`Context Studio at ${csUrl} doesn't report landed state yet (context-studio#1463), so this lists every done proposal`);
  }
  const rows = items.filter((p) => !p.landed);
  if (!rows.length) {
    console.log("every decided dr_spec proposal is marked landed");
    return;
  }
  const landedHere = rows.filter((p) => existsSync(path.join(repo, recordFor(repo, p.id))));
  const notHere = rows.filter((p) => !landedHere.includes(p));
  if (landedHere.length) {
    console.log(`landed in DR but not marked in Context Studio (bun cs-landed.ts mark <id>):`);
    for (const p of landedHere) console.log(`  ${p.id}  ${p.title}`);
  }
  if (notHere.length) {
    console.log(`decided in Context Studio, not landed in DR (export, then cs-decisions-to-spec.ts):`);
    for (const p of notHere) console.log(`  ${p.id}  ${p.title}`);
  }
}

async function main() {
  const [command, second] = process.argv.slice(2);
  const proposalId = second && !second.startsWith("--") ? second : undefined;
  const flags = parseFlags(process.argv.slice(2));
  const csUrl = (flagStr(flags, "cs-url") ?? process.env.CONTEXT_STUDIO_URL ?? "http://localhost:8000").replace(/\/$/, "");
  const repo = path.resolve(harnessDir(), "..", "..", "..");
  try {
    if (command === "mark" && proposalId) await mark(csUrl, repo, proposalId, flags);
    else if (command === "unlanded") await unlanded(csUrl, repo);
    else {
      console.error("Usage: bun cs-landed.ts mark <proposal-id> [--commit <sha>] [--record <file>] [--repo URL] [--cs-url URL] [--dry-run]\n       bun cs-landed.ts unlanded [--cs-url URL]");
      process.exit(2);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (import.meta.main) await main();
