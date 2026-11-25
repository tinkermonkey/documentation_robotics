/**
 * Scores a model review run by RUNBOOK.md: which proposals of step A (the question bank) and of
 * step B (the open review) the maintainer kept, per question and per category.
 *
 *   bun score.ts --model heimdall --repo ~/workspace/heimdall \
 *     [--before assess/before-2026-11-21] [--after assess/after-2026-11-24] [--no-transcripts]
 *
 * An item is one change of a step's changeset as the step staged it: the first commit after the
 * before tag that holds the changeset (`--staged-a`, `--staged-b` name another ref). It is accepted
 * when the model at the after tag has it, and rejected otherwise. A rejection's ruling comes from
 * `rejected-by-rule.jsonl`. Changes are attributed to a question or category by their timestamps
 * against the log's `begin` and `end` lines, and token use comes from the session transcripts
 * under ~/.claude/projects over the same windows.
 *
 * Reads data/<model>/answers.jsonl (step A), open.jsonl (step B), rejected-by-rule.jsonl and,
 * when present, spec-gaps.json (spec-gap verdicts mapped to register rows). Writes
 * data/<model>/score-report.md and data/<model>/score.json. Calls no model; writes nothing to the
 * repository.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { HARNESS_DIR } from "./catalog.js";
import { loadModel, relKey, type Model } from "./model.js";
import { dataDir, num, parseFlags } from "./run.js";

const MODEL_DIR = "documentation-robotics/model";
const CHANGESETS_DIR = "documentation-robotics/changesets";

type Raw = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

interface Change {
  type: string;
  elementId: string;
  before?: Raw;
  after?: Raw;
  timestamp: string;
  sequenceNumber: number;
}

interface Staged {
  name: string;
  /** The commit the changeset is read at, and its short form. */
  ref: string;
  short: string;
  description: string;
  changes: Change[];
}

interface LogRow {
  line: number;
  t?: string;
  q: string;
  event?: string;
  witness?: string;
  item?: string;
  ledger?: string;
  p0?: string;
  verdict?: string;
  staged?: string[];
  note?: string;
  /** The register row a spec-gap verdict belongs to, when the log names it. */
  register?: string;
}

interface Section {
  name: string;
  begin?: number;
  end: number;
  /** The window is (start, end]; start is the previous section's end. */
  start: number;
  /** Rows that carry a verdict. */
  rows: LogRow[];
  /** No `end` line: the window ends at the next section's begin. */
  openEnded: boolean;
}

interface RejectedRow {
  changeset: string;
  ruling: string;
  change: string;
  item: string;
  staged_by?: string;
  seq?: number;
  reason?: string;
}

interface Call {
  t: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

interface SpecGapMap {
  rows?: Record<string, string>;
  map?: Array<{ match: Record<string, string>; row: string }>;
}

function git(repo: string, args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30
  });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

const parseYaml = (text: string): unknown => parse(text, { maxAliasCount: -1 });

/** The model at a ref: extracted to a temporary directory and read with `loadModel`. */
function modelAt(
  repo: string,
  ref: string,
  name: string
): { model: Model; raw: Map<string, Raw> } {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "assess-score-"));
  try {
    const archive = spawnSync("git", ["-C", repo, "archive", ref, MODEL_DIR], {
      maxBuffer: 1 << 30
    });
    if (archive.status !== 0)
      throw new Error(
        `git archive ${ref} ${MODEL_DIR}: ${archive.stderr.toString().trim()}`
      );
    const untar = spawnSync("tar", ["-x", "-C", tmp], {
      input: archive.stdout
    });
    if (untar.status !== 0)
      throw new Error(`tar: ${untar.stderr.toString().trim()}`);
    const dir = path.join(tmp, MODEL_DIR);
    const model = loadModel(name, dir);
    const raw = new Map<string, Raw>();
    for (const layer of readdirSync(dir)) {
      const full = path.join(dir, layer);
      if (!statSync(full).isDirectory()) continue;
      for (const file of readdirSync(full).filter((f) => f.endsWith(".yaml"))) {
        const doc = (parseYaml(readFileSync(path.join(full, file), "utf8")) ??
          {}) as Record<string, Raw>;
        for (const [id, el] of Object.entries(doc))
          if (el && typeof el === "object" && "spec_node_id" in el)
            raw.set(id, el);
      }
    }
    const commit = git(repo, ["rev-parse", "--short", `${ref}^{commit}`]);
    return { model: { ...model, root: repo, commit: commit.trim() }, raw };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** A changeset as staged: at `override`, or at the first commit after `before` that holds it. */
function stagedChangeset(
  repo: string,
  name: string,
  before: string,
  after: string,
  override?: string
): Staged {
  const commits = override
    ? [git(repo, ["rev-parse", `${override}^{commit}`]).trim()]
    : git(repo, [
        "rev-list",
        "--reverse",
        `${before}..${after}`,
        "--",
        CHANGESETS_DIR
      ])
        .split("\n")
        .filter(Boolean);
  for (const commit of commits) {
    const metas = git(repo, [
      "ls-tree",
      "-r",
      "--name-only",
      commit,
      "--",
      CHANGESETS_DIR
    ])
      .split("\n")
      .filter((f) => f.endsWith("/metadata.yaml"));
    for (const meta of metas) {
      const m = parseYaml(git(repo, ["show", `${commit}:${meta}`])) as Raw;
      if (m?.name !== name) continue;
      const dir = path.posix.dirname(meta);
      const changes = (parseYaml(
        git(repo, ["show", `${commit}:${dir}/changes.yaml`])
      ) ?? []) as Change[];
      return {
        name,
        ref: commit,
        short: commit.slice(0, 7),
        description: String(m.description ?? ""),
        changes
      };
    }
  }
  throw new Error(
    `No changeset named "${name}" in ${override ?? `${before}..${after}`}`
  );
}

function readJsonl<T>(file: string): Array<T & { line: number }> {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l, i) => ({ l: l.trim(), line: i + 1 }))
    .filter(({ l }) => l)
    .map(({ l, line }) => ({ ...(JSON.parse(l) as T), line }));
}

const ms = (iso: string): number => Date.parse(iso);
/** Log lines carry whole seconds; changes and transcripts carry milliseconds. */
const toSecond = (t: number): number => Math.floor(t / 1000) * 1000;

/**
 * The log's sections (questions or categories) in log order, each with its window. A window runs
 * from the previous section's end to this section's end, so a change lands in the first section
 * logged after it. That holds whether `begin` lines were written as the work started (step A of
 * the pilot) or together with `end` afterwards (step B).
 */
function readSections(rows: LogRow[]): Section[] {
  const byName = new Map<
    string,
    { name: string; begin?: number; end?: number; rows: LogRow[] }
  >();
  for (const r of rows) {
    let s = byName.get(r.q);
    if (!s) byName.set(r.q, (s = { name: r.q, rows: [] }));
    if (r.event === "begin" && r.t && s.begin === undefined) s.begin = ms(r.t);
    if (r.event === "end" && r.t) s.end = ms(r.t);
    if (r.verdict) s.rows.push(r);
  }
  const list = [...byName.values()];
  const sections: Section[] = list.map((s, i) => {
    const next = list.slice(i + 1).find((n) => n.begin ?? n.end);
    const end = s.end ?? next?.begin ?? next?.end ?? Infinity;
    return {
      name: s.name,
      begin: s.begin,
      end,
      start: -Infinity,
      rows: s.rows,
      openEnded: s.end === undefined
    };
  });
  for (const s of sections)
    s.start = Math.max(
      -Infinity,
      ...sections.filter((o) => o.end < s.end).map((o) => o.end)
    );
  return sections;
}

/** The transcript of the session that wrote `logName` between `from` and `to`, if one is found. */
function findTranscript(
  repo: string,
  logName: string,
  from: number,
  to: number
): string | null {
  const projects = path.join(os.homedir(), ".claude", "projects");
  if (!existsSync(projects)) return null;
  const enc = path.resolve(repo).replace(/[^A-Za-z0-9]/g, "-");
  const dirs = readdirSync(projects).filter(
    (d) => d === enc || d.startsWith(`${enc}--claude-worktrees-`)
  );
  let best: { file: string; mentions: number; inWindow: number } | null = null;
  for (const d of dirs) {
    const dir = path.join(projects, d);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
      const file = path.join(dir, f);
      if (statSync(file).mtimeMs < from) continue;
      const text = readFileSync(file, "utf8");
      const mentions = text.split(logName).length - 1;
      if (!mentions) continue;
      const inWindow = readCalls(text).filter(
        (c) => c.t >= from && c.t <= to
      ).length;
      if (!inWindow) continue;
      if (
        !best ||
        mentions > best.mentions ||
        (mentions === best.mentions && inWindow > best.inWindow)
      )
        best = { file, mentions, inWindow };
    }
  }
  return best?.file ?? null;
}

/** One entry per model call (an assistant message id), with its usage. */
function readCalls(text: string): Call[] {
  const seen = new Set<string>();
  const calls: Call[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"assistant"')) continue;
    let r: Raw;
    try {
      r = JSON.parse(line) as Raw;
    } catch {
      continue;
    }
    if (r.type !== "assistant" || typeof r.timestamp !== "string") continue;
    const m = (r.message ?? {}) as Raw;
    const u = m.usage as Record<string, number> | undefined;
    if (!u) continue;
    const id = String(m.id ?? r.uuid);
    if (seen.has(id)) continue;
    seen.add(id);
    calls.push({
      t: ms(r.timestamp),
      input: u.input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0
    });
  }
  return calls;
}

/** A session's calls, with those of its subagents (stored beside it under <session>/subagents). */
function sessionCalls(file: string): Call[] {
  const calls = readCalls(readFileSync(file, "utf8"));
  const sub = path.join(file.replace(/\.jsonl$/, ""), "subagents");
  if (existsSync(sub))
    for (const f of readdirSync(sub).filter((x) => x.endsWith(".jsonl")))
      calls.push(...readCalls(readFileSync(path.join(sub, f), "utf8")));
  return calls.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

type Outcome = "accepted" | "edited" | "rejected";
type SectionBy = "window" | "tie-exact" | "tie-first" | "after-last";
type OriginBy = "exact" | "family" | "default";

interface Item {
  step: "A" | "B";
  seq: number;
  kind: string;
  key: string;
  isRel: boolean;
  type: string;
  t: string;
  section: string;
  sectionBy: SectionBy;
  /** Staged before its section's `begin` line. */
  beforeBegin: boolean;
  bucket: string;
  origin: "p0" | "question";
  originBy: OriginBy;
  outcome: Outcome;
  inBase: boolean;
  ruling?: string;
  cascade?: boolean;
  loggedStagedBy?: string;
}

interface Usage {
  calls: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const zeroUsage = (): Usage => ({
  calls: 0,
  input: 0,
  cacheWrite: 0,
  cacheRead: 0,
  output: 0
});
const addCall = (u: Usage, c: Call): void => {
  u.calls++;
  u.input += c.input;
  u.cacheWrite += c.cacheWrite;
  u.cacheRead += c.cacheRead;
  u.output += c.output;
};
const totalTokens = (u: Usage): number =>
  u.input + u.cacheWrite + u.cacheRead + u.output;

interface Bucket {
  name: string;
  items: Item[];
  rows: LogRow[];
  usage: Usage | null;
  /** Sections whose window this bucket's tokens came from (a tied section has none of its own). */
  tokenNote?: string;
}

const VERDICTS = [
  "wired",
  "added",
  "expected-absent",
  "not-fired",
  "blind-spot",
  "spec-gap",
  "unsure",
  "outside",
  "not-applicable"
] as const;

function verdictOf(r: LogRow): string {
  if (
    r.verdict === "expected-absent" &&
    (r.item === "(satisfied)" || /^(witness )?did not fire/.test(r.note ?? ""))
  )
    return "not-fired";
  return r.verdict ?? "";
}

const changeKey = (c: Change): string => {
  if (c.type.startsWith("relationship")) {
    const r = (c.after ?? c.before ?? {}) as Raw;
    return `${String(r.source)} ${String(r.predicate)} ${String(r.target)}`;
  }
  return c.elementId;
};

const changeType = (c: Change): string => {
  const el = (c.after ?? c.before ?? {}) as Raw;
  if (c.type.startsWith("relationship")) return String(el.predicate);
  return typeof el.spec_node_id === "string"
    ? el.spec_node_id
    : c.elementId.split(".").slice(0, 2).join(".");
};

/** A staged-item string with trailing remarks such as "(new service)" removed. */
function normalise(s: string): string {
  let out = s.trim().replace(/\s+/g, " ");
  for (;;) {
    const next = out.replace(/\s*\([^()]*\)$/, "");
    if (next === out) return out;
    out = next;
  }
}

/**
 * The forms a staged-item string can name a change by. Beside the string itself: a leading
 * predicate gets the row's item as its source ("realizes X" under item Y is "Y realizes X"), a
 * trailing "it" is the row's item, and a short name ("graph-canvas-component") is the one element
 * id that ends with it.
 */
function expansions(
  staged: string,
  item: string | undefined,
  predicates: Set<string>,
  byName: Map<string, string[]>
): string[] {
  const base = normalise(staged);
  const out = new Set([base]);
  const id = item && /^[a-z-]+\.[a-z]+\.\S+$/.test(item) ? item : undefined;
  let words = base.split(" ");
  if (id && predicates.has(words[0])) words = [id, ...words];
  if (id && words.length === 3 && words[2] === "it") words[2] = id;
  if (words.length === 3 && predicates.has(words[1])) {
    const full = (w: string) =>
      w.includes(".") ? w : byName.get(w)?.length === 1 ? byName.get(w)![0] : w;
    out.add([full(words[0]), words[1], full(words[2])].join(" "));
  }
  return [...out];
}

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function outcomeOf(
  c: Change,
  after: Model,
  afterRels: Set<string>,
  afterRaw: Map<string, Raw>
): Outcome {
  const key = changeKey(c);
  const relKeyOf = key.split(" ").join("|");
  switch (c.type) {
    case "add":
      return after.elements.has(c.elementId) ? "accepted" : "rejected";
    case "delete":
      return after.elements.has(c.elementId) ? "rejected" : "accepted";
    case "relationship-add":
      return afterRels.has(relKeyOf) ? "accepted" : "rejected";
    case "relationship-delete":
      return afterRels.has(relKeyOf) ? "rejected" : "accepted";
    case "update": {
      const now = afterRaw.get(c.elementId);
      if (!now) return "rejected";
      const b = c.before ?? {};
      const a = c.after ?? {};
      const changed = Object.keys(a).filter(
        (k) => k !== "metadata" && !sameJson(a[k], b[k])
      );
      return changed.every((k) => sameJson(now[k], a[k]))
        ? "accepted"
        : "edited";
    }
    default:
      return after.elements.has(c.elementId) ? "accepted" : "rejected";
  }
}

/** Wilson score interval for k successes in n trials (95%). */
function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [NaN, NaN];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const precision = (k: number, n: number): string => {
  if (!n) return "-";
  const [lo, hi] = wilson(k, n);
  return `${(k / n).toFixed(2)} [${lo.toFixed(2)}, ${hi.toFixed(2)}]`;
};

const tokens = (n: number): string =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(2)}M`
    : n >= 1e3
      ? `${(n / 1e3).toFixed(0)}k`
      : String(n);

interface StepConfig {
  key: "A" | "B";
  label: string;
  changeset: string;
  log: string;
  stagedOverride?: string;
  transcriptOverride?: string;
  /** Step A's log keys P0 cards with `p0`; step B uses `p0` as its plain item key. */
  p0Split: boolean;
}

interface StepResult {
  config: StepConfig;
  staged: Staged;
  sections: Section[];
  items: Item[];
  buckets: Bucket[];
  transcript: string | null;
  transcriptNote: string;
  usage: { before: Usage; sections: Usage; total: Usage } | null;
  sectionBy: Record<SectionBy, number>;
  originBy: Record<OriginBy, number>;
  beforeBegin: number;
}

function scoreStep(
  cfg: StepConfig,
  repo: string,
  before: string,
  after: string,
  afterModel: Model,
  afterRels: Set<string>,
  afterRaw: Map<string, Raw>,
  baseModel: Model,
  baseRels: Set<string>,
  rejected: Map<string, RejectedRow>,
  rejectedByKey: Map<string, RejectedRow>,
  useTranscripts: boolean
): StepResult {
  const staged = stagedChangeset(
    repo,
    cfg.changeset,
    before,
    after,
    cfg.stagedOverride
  );
  const rows = readJsonl<LogRow>(cfg.log);
  const sections = readSections(rows);

  // Exact matches: a staged string that names an element id or "source predicate target".
  const predicates = new Set(
    staged.changes
      .filter((c) => c.type.startsWith("relationship"))
      .map((c) => changeType(c))
  );
  const byName = new Map<string, string[]>();
  const known = new Set([
    ...afterModel.elements.keys(),
    ...baseModel.elements.keys(),
    ...staged.changes
      .filter((c) => !c.type.startsWith("relationship"))
      .map((c) => c.elementId)
  ]);
  for (const id of known) {
    const name = id.split(".").slice(2).join(".");
    byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  const exact = new Map<string, Array<{ section: Section; row: LogRow }>>();
  for (const s of sections)
    for (const r of s.rows)
      for (const st of r.staged ?? [])
        for (const k of expansions(st, r.item, predicates, byName)) {
          const list = exact.get(k) ?? [];
          list.push({ section: s, row: r });
          exact.set(k, list);
        }

  const sectionBy: Record<SectionBy, number> = {
    window: 0,
    "tie-exact": 0,
    "tie-first": 0,
    "after-last": 0
  };
  const originBy: Record<OriginBy, number> = {
    exact: 0,
    family: 0,
    default: 0
  };
  let beforeBegin = 0;

  const items: Item[] = staged.changes.map((c) => {
    const key = changeKey(c);
    const t = toSecond(ms(c.timestamp));
    const candidates = sections.filter((s) => s.start < t && t <= s.end);
    let section: Section | undefined;
    let by: SectionBy;
    if (candidates.length === 1) {
      section = candidates[0];
      by = "window";
    } else if (candidates.length > 1) {
      const hit = (exact.get(key) ?? []).find((h) =>
        candidates.includes(h.section)
      );
      section = hit?.section ?? candidates[0];
      by = hit ? "tie-exact" : "tie-first";
    } else {
      section = undefined;
      by = "after-last";
    }
    sectionBy[by]++;
    const early =
      section?.begin !== undefined && toSecond(ms(c.timestamp)) < section.begin;
    if (early) beforeBegin++;
    const outcome = outcomeOf(c, afterModel, afterRels, afterRaw);
    const isRel = c.type.startsWith("relationship");
    const inBase =
      c.type === "add"
        ? baseModel.elements.has(c.elementId)
        : c.type === "relationship-add"
          ? baseRels.has(key.split(" ").join("|"))
          : false;
    const item: Item = {
      step: cfg.key,
      seq: c.sequenceNumber,
      kind: c.type,
      key,
      isRel,
      type: changeType(c),
      t: c.timestamp,
      section: section?.name ?? "(after the last section)",
      sectionBy: by,
      beforeBegin: early,
      bucket: section?.name ?? "(after the last section)",
      origin: "question",
      originBy: "default",
      outcome,
      inBase
    };
    if (outcome === "rejected") {
      const bySeq = rejected.get(`${cfg.changeset}#${c.sequenceNumber}`);
      const log =
        bySeq?.item === key
          ? bySeq
          : rejectedByKey.get(`${cfg.changeset}|${key}`);
      if (log) {
        item.ruling = log.ruling;
        item.loggedStagedBy = log.staged_by;
      }
      if (isRel) {
        const r = (c.after ?? c.before ?? {}) as Raw;
        item.cascade =
          !afterModel.elements.has(String(r.source)) ||
          !afterModel.elements.has(String(r.target));
      }
    }
    return item;
  });

  // Step A: separate the items that came from P0 cards (worked under a question) from the
  // question's own. Exact matches first; then by family: an element whose type a P0 row names, and
  // a relationship with an end such an element added in the same section.
  const sectionOf = new Map(sections.map((s) => [s.name, s]));
  for (const s of sections) {
    const mine = items.filter((i) => i.section === s.name);
    const p0Rows = cfg.p0Split
      ? s.rows.filter((r) => r.p0 !== undefined && (r.staged ?? []).length)
      : [];
    const p0Text = p0Rows
      .map((r) => [r.p0, ...(r.staged ?? [])].join(" "))
      .join(" \n ");
    const p0Added = new Set<string>();
    const ordered = [
      ...mine.filter((i) => !i.isRel),
      ...mine.filter((i) => i.isRel)
    ];
    for (const i of ordered) {
      const hit = (exact.get(i.key) ?? []).find((h) => h.section === s);
      if (hit) {
        i.origin = cfg.p0Split && hit.row.p0 !== undefined ? "p0" : "question";
        i.originBy = "exact";
      } else if (p0Rows.length && !i.isRel) {
        const short = i.type.split(".")[1] ?? i.type;
        const named =
          p0Text.includes(i.type) ||
          p0Text.includes(i.key) ||
          new RegExp(`(^|[^a-z.])${short}([^a-z]|$)`).test(p0Text);
        if (named) {
          i.origin = "p0";
          i.originBy = "family";
        }
      } else if (p0Rows.length && i.isRel) {
        const [src, , tgt] = i.key.split(" ");
        if (p0Added.has(src) || p0Added.has(tgt)) {
          i.origin = "p0";
          i.originBy = "family";
        }
      }
      if (i.origin === "p0" && !i.isRel) p0Added.add(i.key);
      originBy[i.originBy]++;
      if (cfg.p0Split && i.origin === "p0") i.bucket = "P0";
    }
  }

  // Buckets: step A gets a P0 row first (its own section plus the P0 cards worked under questions).
  const names = sections.map((s) => s.name);
  const order = cfg.p0Split && !names.includes("P0") ? ["P0", ...names] : names;
  if (items.some((i) => i.bucket === "(after the last section)"))
    order.push("(after the last section)");
  const buckets: Bucket[] = order.map((name) => ({
    name,
    items: items.filter((i) => i.bucket === name),
    rows: [],
    usage: null
  }));
  const bucketOf = new Map(buckets.map((b) => [b.name, b]));
  for (const s of sections)
    for (const r of s.rows)
      bucketOf
        .get(cfg.p0Split && r.p0 !== undefined ? "P0" : s.name)!
        .rows.push(r);

  // Tokens over the same windows. The first section's window opens at its `begin` line; calls
  // before it are the step's set-up.
  let transcript: string | null = null;
  let transcriptNote = "";
  let usage: StepResult["usage"] = null;
  const timed = sections.filter((s) => Number.isFinite(s.end));
  const first = timed[0];
  const last = timed[timed.length - 1];
  if (useTranscripts && first && last) {
    const from = first.begin ?? first.end;
    transcript =
      cfg.transcriptOverride ??
      findTranscript(repo, path.basename(cfg.log), from, last.end);
    if (transcript) {
      const calls = sessionCalls(transcript).filter(
        (c) => toSecond(c.t) <= last.end
      );
      const pre = zeroUsage();
      const inSections = zeroUsage();
      const total = zeroUsage();
      const perSection = new Map<string, Usage>();
      for (const c of calls) {
        addCall(total, c);
        const t = toSecond(c.t);
        const owner = timed.find((s) =>
          s === first
            ? t >= (first.begin ?? -Infinity) && t <= s.end
            : t > s.start && t <= s.end
        );
        if (!owner) {
          addCall(pre, c);
          continue;
        }
        addCall(inSections, c);
        const u = perSection.get(owner.name) ?? zeroUsage();
        addCall(u, c);
        perSection.set(owner.name, u);
      }
      usage = { before: pre, sections: inSections, total };
      for (const b of buckets) {
        const s = sectionOf.get(b.name);
        if (!s) continue;
        const tiedWith = timed.find(
          (o) =>
            o !== s && o.end === s.end && timed.indexOf(o) < timed.indexOf(s)
        );
        b.usage = perSection.get(b.name) ?? zeroUsage();
        if (tiedWith) b.tokenNote = `tied with ${tiedWith.name}`;
        if (cfg.p0Split && b.name === "P0") b.tokenNote = "pre-pass only";
      }
      transcriptNote = `${path.basename(path.dirname(transcript))}/${path.basename(transcript)}`;
    } else
      transcriptNote =
        "not found: no session under ~/.claude/projects for this repository mentions the log in the step's window";
  } else
    transcriptNote = useTranscripts
      ? "the log has no begin and end lines"
      : "skipped (--no-transcripts)";

  return {
    config: cfg,
    staged,
    sections,
    items,
    buckets,
    transcript,
    transcriptNote,
    usage,
    sectionBy,
    originBy,
    beforeBegin
  };
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

interface Tally {
  proposed: number;
  elements: number;
  relationships: number;
  accepted: number;
  edited: number;
  rejected: number;
  acceptedElements: number;
  byRuling: Map<string, { n: number; cascade: number }>;
}

function tally(items: Item[]): Tally {
  const t: Tally = {
    proposed: items.length,
    elements: items.filter((i) => !i.isRel).length,
    relationships: items.filter((i) => i.isRel).length,
    accepted: 0,
    edited: 0,
    rejected: 0,
    acceptedElements: 0,
    byRuling: new Map()
  };
  for (const i of items) {
    if (i.outcome === "rejected") {
      t.rejected++;
      const k = i.ruling ?? "no ruling logged";
      const r = t.byRuling.get(k) ?? { n: 0, cascade: 0 };
      r.n++;
      if (i.cascade) r.cascade++;
      t.byRuling.set(k, r);
    } else {
      t.accepted++;
      if (i.outcome === "edited") t.edited++;
      if (!i.isRel) t.acceptedElements++;
    }
  }
  return t;
}

const rulingCell = (t: Tally): string =>
  [...t.byRuling]
    .map(
      ([k, v]) =>
        `${k} ${num(v.n)}${v.cascade ? ` (${num(v.cascade)} cascade)` : ""}`
    )
    .join("; ") || "-";

/** Total tokens and, in brackets, output tokens. */
const usageCell = (u: Usage | null, per = 1): string =>
  u && per
    ? `${tokens(Math.round(totalTokens(u) / per))} (${tokens(Math.round(u.output / per))})`
    : "-";
const perAccepted = (u: Usage | null, accepted: number): string =>
  accepted ? usageCell(u, accepted) : "-";

function stepTable(r: StepResult, say: (s?: string) => void): void {
  say(
    "| Row | Proposed | Elements | Relationships | Accepted | Rejected | Rejected by ruling | Precision [95% Wilson] | Element precision | Tokens (output) | Per accepted item (output) |"
  );
  say(
    "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | ---: |"
  );
  for (const b of r.buckets) {
    const t = tally(b.items);
    const tok = b.usage
      ? `${usageCell(b.usage)}${b.tokenNote ? `, ${b.tokenNote}` : ""}`
      : "-";
    say(
      `| ${b.name} | ${num(t.proposed)} | ${num(t.elements)} | ${num(t.relationships)} | ${num(t.accepted)} | ${num(t.rejected)} | ${rulingCell(t)} | ${precision(t.accepted, t.proposed)} | ${precision(t.acceptedElements, t.elements)} | ${tok} | ${perAccepted(b.usage, t.accepted)} |`
    );
  }
  const t = tally(r.items);
  say(
    `| **Step ${r.config.key}** | ${num(t.proposed)} | ${num(t.elements)} | ${num(t.relationships)} | ${num(t.accepted)} | ${num(t.rejected)} | ${rulingCell(t)} | ${precision(t.accepted, t.proposed)} | ${precision(t.acceptedElements, t.elements)} | ${usageCell(r.usage?.total ?? null)} | ${perAccepted(r.usage?.total ?? null, t.accepted)} |`
  );
}

function verdictTable(r: StepResult, say: (s?: string) => void): void {
  say(`| Row | Log rows | ${VERDICTS.join(" | ")} |`);
  say(`| --- | ---: | ${VERDICTS.map(() => "---:").join(" | ")} |`);
  const sum = new Map<string, number>();
  let rowsTotal = 0;
  for (const b of r.buckets) {
    const counts = new Map<string, number>();
    for (const row of b.rows) {
      const v = verdictOf(row);
      counts.set(v, (counts.get(v) ?? 0) + 1);
      sum.set(v, (sum.get(v) ?? 0) + 1);
    }
    rowsTotal += b.rows.length;
    say(
      `| ${b.name} | ${b.rows.length} | ${VERDICTS.map((v) => counts.get(v) ?? 0).join(" | ")} |`
    );
  }
  say(
    `| **Step ${r.config.key}** | ${rowsTotal} | ${VERDICTS.map((v) => sum.get(v) ?? 0).join(" | ")} |`
  );
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const modelName = typeof flags.model === "string" ? flags.model : "";
  const repoFlag = typeof flags.repo === "string" ? flags.repo : "";
  if (!modelName || !repoFlag)
    throw new Error(
      "Pass --model <name> (the data/<name>/ folder) and --repo <repository path>"
    );
  const repo = path.resolve(
    repoFlag.replace(/^~(?=\/)/, process.env.HOME ?? "~")
  );
  const latestTag = (prefix: string): string => {
    const tags = git(repo, ["tag", "--list", `${prefix}*`, "--sort=-refname"])
      .split("\n")
      .filter(Boolean);
    if (!tags.length) throw new Error(`No ${prefix}* tag in ${repo}`);
    return tags[0];
  };
  const before =
    typeof flags.before === "string"
      ? flags.before
      : latestTag("assess/before-");
  const after =
    typeof flags.after === "string" ? flags.after : latestTag("assess/after-");
  const data = dataDir(modelName);
  const str = (k: string): string | undefined =>
    typeof flags[k] === "string" ? (flags[k] as string) : undefined;

  const { model: afterModel, raw: afterRaw } = modelAt(repo, after, "after");
  const { model: baseModel } = modelAt(repo, before, "before");
  const afterRels = new Set(afterModel.rels.map(relKey));
  const baseRels = new Set(baseModel.rels.map(relKey));

  const rejectedFile = path.join(data, "rejected-by-rule.jsonl");
  const rejectedRows = existsSync(rejectedFile)
    ? readJsonl<RejectedRow>(rejectedFile)
    : [];
  const rejected = new Map(
    rejectedRows
      .filter((r) => r.seq !== undefined)
      .map((r) => [`${r.changeset}#${r.seq}`, r])
  );
  const rejectedByKey = new Map(
    rejectedRows.map((r) => [`${r.changeset}|${r.item}`, r])
  );

  const steps: StepConfig[] = [
    {
      key: "A",
      label: "questions",
      changeset: str("step-a-changeset") ?? "review-questions",
      log: path.join(data, "answers.jsonl"),
      stagedOverride: str("staged-a"),
      transcriptOverride: str("transcript-a"),
      p0Split: true
    },
    {
      key: "B",
      label: "open review",
      changeset: str("step-b-changeset") ?? "review-open",
      log: path.join(data, "open.jsonl"),
      stagedOverride: str("staged-b"),
      transcriptOverride: str("transcript-b"),
      p0Split: false
    }
  ];
  const results = steps
    .filter((s) => existsSync(s.log))
    .map((s) =>
      scoreStep(
        s,
        repo,
        before,
        after,
        afterModel,
        afterRels,
        afterRaw,
        baseModel,
        baseRels,
        rejected,
        rejectedByKey,
        !flags["no-transcripts"]
      )
    );
  if (!results.length)
    throw new Error(`No answers.jsonl or open.jsonl in ${data}`);
  const allItems = results.flatMap((r) => r.items);

  // The bank: questions.json beside this script, else the version named in step A's changeset.
  const bankFile = path.join(HARNESS_DIR, "questions.json");
  const bank = existsSync(bankFile)
    ? (JSON.parse(readFileSync(bankFile, "utf8")) as {
        version?: string;
        questions?: Array<{ id: string; question?: string }>;
      })
    : null;
  const bankVersion =
    bank?.version ??
    results[0].staged.description.match(/bank (\d+(?:\.\d+)*)/)?.[1] ??
    "unknown";

  // Spec gaps per register row.
  const gapFile = path.join(data, "spec-gaps.json");
  const gapMap: SpecGapMap = existsSync(gapFile)
    ? (JSON.parse(readFileSync(gapFile, "utf8")) as SpecGapMap)
    : {};
  const gapKey = (r: LogRow): string =>
    [
      r.q,
      r.witness !== undefined ? `witness=${r.witness}` : "",
      r.ledger !== undefined ? `ledger=${r.ledger}` : "",
      r.p0 !== undefined ? `p0=${r.p0}` : "",
      r.item !== undefined ? `item=${r.item}` : ""
    ]
      .filter(Boolean)
      .join(" | ");
  const gaps: Array<{
    step: string;
    row: LogRow;
    register: string | null;
    by: string;
  }> = [];
  for (const r of results)
    for (const s of r.sections)
      for (const row of s.rows) {
        if (row.verdict !== "spec-gap") continue;
        if (row.register) {
          gaps.push({
            step: r.config.key,
            row,
            register: row.register,
            by: "log"
          });
          continue;
        }
        const m = (gapMap.map ?? []).find((e) =>
          Object.entries(e.match).every(
            ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v
          )
        );
        gaps.push({
          step: r.config.key,
          row,
          register: m?.row ?? null,
          by: m ? "spec-gaps.json" : "none"
        });
      }

  // -------------------------------------------------------------------------------------------
  const out: string[] = [];
  const say = (s = "") => out.push(s);
  const tagSha = (ref: string) =>
    git(repo, ["rev-parse", "--short", `${ref}^{commit}`]).trim();

  say(`# Model review score: ${modelName}`);
  say();
  say(
    `Generated by \`score.ts\` on ${new Date().toISOString().slice(0, 10)}. Bank ${bankVersion}. Repository \`${repo}\`, before \`${before}\` (${tagSha(before)}, ${num(baseModel.elements.size)} elements, ${num(baseModel.rels.length)} relationships), after \`${after}\` (${afterModel.commit}, ${num(afterModel.elements.size)} elements, ${num(afterModel.rels.length)} relationships).`
  );
  say();
  say("| Step | Changeset | Read at | Log | Session transcript |");
  say("| --- | --- | --- | --- | --- |");
  for (const r of results)
    say(
      `| ${r.config.key} (${r.config.label}) | \`${r.config.changeset}\` | ${r.staged.short} | \`${path.basename(r.config.log)}\` | ${r.transcriptNote} |`
    );
  say();
  say(
    "An item is one change of a step's changeset as the step staged it. Accepted: the model at the after tag has it (an update counts when its changed fields match there, as *edited* otherwise). Rejected: otherwise; the ruling comes from `rejected-by-rule.jsonl`. A *cascade* is a rejected relationship with an end that is not in the after model. Precision is accepted over proposed. How rows are attributed, and what that cannot tell, is at the end."
  );

  say();
  say("## Summary");
  say();
  say(
    "| Step | Proposed | Accepted | Edited | Rejected | Precision [95% Wilson] | Element precision | Share of all accepted (elements) | Tokens (output) | Per accepted item (output) |"
  );
  say("| --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |");
  const allAccepted = allItems.filter((i) => i.outcome !== "rejected").length;
  const allAcceptedEl = allItems.filter(
    (i) => i.outcome !== "rejected" && !i.isRel
  ).length;
  const share = (k: number, n: number) =>
    n ? `${((100 * k) / n).toFixed(1)}%` : "-";
  for (const r of results) {
    const t = tally(r.items);
    say(
      `| ${r.config.key} (${r.config.label}) | ${num(t.proposed)} | ${num(t.accepted)} | ${num(t.edited)} | ${num(t.rejected)} | ${precision(t.accepted, t.proposed)} | ${precision(t.acceptedElements, t.elements)} | ${share(t.accepted, allAccepted)} (${share(t.acceptedElements, allAcceptedEl)}) | ${usageCell(r.usage?.total ?? null)} | ${perAccepted(r.usage?.total ?? null, t.accepted)} |`
    );
  }
  const base = allItems.filter((i) => i.inBase).length;
  if (base)
    say(
      `\n${num(base)} proposed adds were already in the before model; they count as accepted above.`
    );

  for (const r of results) {
    say();
    say(
      `## Step ${r.config.key}: ${r.config.key === "A" ? "per question" : "per category"} (\`${r.config.changeset}\`)`
    );
    say();
    stepTable(r, say);
    if (r.config.key === "A" && bank?.questions?.length) {
      say();
      for (const q of bank.questions) say(`- **${q.id}** ${q.question ?? ""}`);
    }
    say();
    say(`### Verdicts, step ${r.config.key}`);
    say();
    say(
      "From the log, one count per row. *not-fired* is a witness logged as satisfied (it did not fire); the runbook logs it as `expected-absent`."
    );
    say();
    verdictTable(r, say);
  }

  // Rejections.
  say();
  say("## Rejections by ruling");
  say();
  say(
    "Where each ruling's rejections were staged, by time window, against the row `rejected-by-rule.jsonl` gives them (attributed by family when it was written)."
  );
  say();
  say(
    "| Ruling | Step | Elements | Relationships (cascade) | Staged in, by time | Log's `staged_by` |"
  );
  say("| --- | --- | ---: | ---: | --- | --- |");
  const rejectedItems = allItems.filter((i) => i.outcome === "rejected");
  const rulings = [
    ...new Set(
      rejectedItems.map((i) => `${i.ruling ?? "no ruling logged"}|${i.step}`)
    )
  ];
  for (const key of rulings) {
    const [ruling, step] = key.split("|");
    const list = rejectedItems.filter(
      (i) => (i.ruling ?? "no ruling logged") === ruling && i.step === step
    );
    const count = (f: (i: Item) => string) => {
      const m = new Map<string, number>();
      for (const i of list) m.set(f(i), (m.get(f(i)) ?? 0) + 1);
      return [...m]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${num(v)}`)
        .join(", ");
    };
    say(
      `| ${ruling} | ${step} | ${num(list.filter((i) => !i.isRel).length)} | ${num(list.filter((i) => i.isRel).length)} (${num(list.filter((i) => i.cascade).length)}) | ${count((i) => (i.bucket === i.section ? i.section : `${i.section} (${i.bucket})`))} | ${count((i) => i.loggedStagedBy ?? "-")} |`
    );
  }
  const loggedKeys = new Set(
    rejectedItems
      .filter((i) => i.ruling)
      .map(
        (i) =>
          `${i.step === "A" ? steps[0].changeset : steps[1].changeset}|${i.key}`
      )
  );
  const unmatchedLog = rejectedRows.filter(
    (r) => !loggedKeys.has(`${r.changeset}|${r.item}`)
  );
  if (unmatchedLog.length) {
    say();
    say(
      `${num(unmatchedLog.length)} rows of \`rejected-by-rule.jsonl\` match no rejected item (the change is not in the staged changeset, or is in the after model):`
    );
    say();
    for (const r of unmatchedLog.slice(0, 20))
      say(
        `- ${r.changeset} #${r.seq ?? "?"} ${r.change} \`${r.item}\` (${r.ruling})`
      );
    if (unmatchedLog.length > 20)
      say(`- and ${num(unmatchedLog.length - 20)} more (all in score.json)`);
  }

  // Spec gaps.
  say();
  say("## Spec-gap verdicts per register row");
  say();
  const registerRows = new Set<string>([
    ...Object.keys(gapMap.rows ?? {}),
    ...gaps.map((g) => g.register).filter((x): x is string => !!x)
  ]);
  const regOrder = [...registerRows].sort(
    (a, b) =>
      Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")) ||
      a.localeCompare(b)
  );
  const named = gaps.filter((g) => g.by === "log").length;
  const mapped = gaps.filter((g) => g.by === "spec-gaps.json").length;
  say(
    `${num(gaps.length)} spec-gap verdicts: ${num(named)} name their register row in the log, ${num(mapped)} are mapped in \`spec-gaps.json\`, ${num(gaps.length - named - mapped)} are not mapped.${mapped ? " The mapping is a reviewer's reading of each verdict's note, kept as data beside the logs; check it before relying on the ranking." : ""}`
  );
  say();
  if (regOrder.length) {
    say("| Row | Problem | Step A | Step B | Where |");
    say("| --- | --- | ---: | ---: | --- |");
    for (const reg of regOrder) {
      const list = gaps.filter((g) => g.register === reg);
      const where = new Map<string, number>();
      for (const g of list)
        where.set(
          `${g.step}:${g.row.q}`,
          (where.get(`${g.step}:${g.row.q}`) ?? 0) + 1
        );
      say(
        `| ${reg} | ${gapMap.rows?.[reg] ?? ""} | ${list.filter((g) => g.step === "A").length} | ${list.filter((g) => g.step === "B").length} | ${[...where].map(([k, v]) => `${k} ${v}`).join(", ") || "-"} |`
      );
    }
  }
  const unmappedGaps = gaps.filter((g) => !g.register);
  if (unmappedGaps.length) {
    say();
    say(
      'Not mapped (add a `{ "match": {…}, "row": "S…" }` entry to `spec-gaps.json`; match keys are log fields such as `q`, `witness`, `ledger`, `p0`, `item`):'
    );
    say();
    for (const g of unmappedGaps) say(`- step ${g.step}: \`${gapKey(g.row)}\``);
  }

  // Cost.
  say();
  say("## Cost");
  say();
  const costed = results.filter((r) => r.usage);
  if (!costed.length)
    say(
      "Not measurable yet: no session transcript was found for either step (see the table at the top)."
    );
  else {
    say(
      "Tokens are summed over the session's model calls (one per assistant message id, subagents included), from its first call to the step's last `end` line. *Total* adds uncached input, cache writes, cache reads and output; cache reads dominate it and cost a fraction of the others, so the columns are given apart."
    );
    say();
    say(
      "| Step | Part | Calls | Input | Cache write | Cache read | Output | Total |"
    );
    say("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const r of costed) {
      const u = r.usage!;
      for (const [label, x] of [
        ["before the first section (set-up, reading)", u.before],
        ["in the sections", u.sections],
        ["**step total**", u.total]
      ] as Array<[string, Usage]>)
        say(
          `| ${r.config.key} | ${label} | ${num(x.calls)} | ${num(x.input)} | ${num(x.cacheWrite)} | ${num(x.cacheRead)} | ${num(x.output)} | ${tokens(totalTokens(x))} |`
        );
    }
    say();
    say(
      "Per row, the tokens column of the step tables is the row's window. Step A's P0 row has only the P0 section's window (the extraction pre-pass); the tokens spent deciding P0 cards fall in the windows of the questions that took them. Set-up before the first section is in the step total only."
    );
  }

  // Method and limits.
  say();
  say("## How rows are attributed, and the limits");
  say();
  for (const r of results) {
    const n = r.items.length;
    say(
      `- **Step ${r.config.key}, to a ${r.config.key === "A" ? "question" : "category"}: by time.** Each change carries its staging timestamp; a section's window runs from the previous section's \`end\` line to its own. ${num(r.sectionBy.window)} of ${num(n)} changes fall in exactly one window${r.sectionBy["tie-exact"] ? `, ${num(r.sectionBy["tie-exact"])} in a window shared by two sections and placed by an exact staged string` : ""}${r.sectionBy["tie-first"] ? `, ${num(r.sectionBy["tie-first"])} in a shared window with no exact match (placed in the first of the tied sections)` : ""}${r.sectionBy["after-last"] ? `, ${num(r.sectionBy["after-last"])} after the last \`end\` line (unattributed)` : ""}. ${r.beforeBegin ? `${num(r.beforeBegin)} were staged before their section's \`begin\` line: this log wrote \`begin\` and \`end\` together after the work (runbook row B9), so the windows hold only because each section's work follows the previous one's \`end\`.` : "None was staged before its section's `begin` line, so the begin lines were written as the work started."}`
    );
  }
  const a = results.find((r) => r.config.p0Split);
  if (a)
    say(
      `- **Step A, P0 cards against the question's own work: by family, approximate.** The log lists staged items as free-text summaries ("105 application.applicationcomponent", "171 realizes, 159 uses"), not ids, so a change is matched to the log row that staged it only where a staged string names it exactly: its id, or \`source predicate target\` once the row's item fills in "it" or a leading predicate and a short name resolves to the one id ending in it (${num(a.originBy.exact)} changes). Otherwise it goes to the P0 row when a P0 row names its element type, or when it is a relationship with an end such an element added in the same section (${num(a.originBy.family)}); the rest stay with the question (${num(a.originBy.default)}). A question's row therefore excludes the P0 cards it decided, and the verdict counts follow the log key (\`p0\`, \`witness\`, \`ledger\`).`
    );
  say(
    "- **Rejections.** The ruling is joined by changeset and sequence number. `rejected-by-rule.jsonl` attributes each rejection to a question by family (its `staged_by_note`); the rejections table above sets that against the time windows."
  );
  say(
    "- **Precision intervals** assume independent decisions. A ruling rejects a whole family at once (S10 removed every application component that duplicates a UX component, and each one's relationships with it), so the intervals are too narrow. Element precision and the cascade counts show how much of a row's rejection is one decision repeated."
  );
  say(
    "- **One repository.** Verdicts on questions need the fleet pooled (roadmap, stage 2). `score.json` beside this report holds every item, for pooling."
  );

  const report = out.join("\n") + "\n";
  writeFileSync(path.join(data, "score-report.md"), report);
  writeFileSync(
    path.join(data, "score.json"),
    JSON.stringify(
      {
        model: modelName,
        repo,
        before: { ref: before, commit: tagSha(before) },
        after: { ref: after, commit: afterModel.commit },
        bank: bankVersion,
        steps: results.map((r) => ({
          step: r.config.key,
          changeset: r.config.changeset,
          stagedAt: r.staged.ref,
          transcript: r.transcript,
          usage: r.usage,
          sectionBy: r.sectionBy,
          originBy: r.originBy,
          rows: r.buckets.map((b) => {
            const t = tally(b.items);
            return {
              row: b.name,
              proposed: t.proposed,
              elements: t.elements,
              relationships: t.relationships,
              accepted: t.accepted,
              edited: t.edited,
              rejected: t.rejected,
              rejectedByRuling: Object.fromEntries(t.byRuling),
              usage: b.usage,
              verdicts: Object.fromEntries(
                VERDICTS.map((v) => [
                  v,
                  b.rows.filter((row) => verdictOf(row) === v).length
                ])
              )
            };
          })
        })),
        specGaps: gaps.map((g) => ({
          step: g.step,
          key: gapKey(g.row),
          register: g.register,
          by: g.by
        })),
        unmatchedRejections: unmatchedLog,
        items: allItems
      },
      null,
      1
    ) + "\n"
  );

  // Console summary.
  console.log(
    `${modelName}: bank ${bankVersion}, ${before} -> ${after} (${afterModel.commit})`
  );
  for (const r of results) {
    const t = tally(r.items);
    console.log(
      `\nStep ${r.config.key} (${r.config.changeset} @ ${r.staged.short}): ${num(t.proposed)} proposed, ${num(t.accepted)} accepted, ${num(t.rejected)} rejected, precision ${precision(t.accepted, t.proposed)}, tokens ${r.usage ? tokens(totalTokens(r.usage.total)) : "not measured"}`
    );
    for (const b of r.buckets) {
      const bt = tally(b.items);
      console.log(
        `  ${b.name.padEnd(32)} ${String(bt.proposed).padStart(5)} proposed ${String(bt.accepted).padStart(5)} accepted  ${precision(bt.accepted, bt.proposed).padEnd(20)} ${b.usage ? tokens(totalTokens(b.usage)).padStart(7) : "      -"} tokens`
      );
    }
  }
  console.log(
    `\nSpec gaps: ${gaps.length} verdicts, ${gaps.filter((g) => g.register).length} placed on a register row`
  );
  console.log(`Report: ${path.join(data, "score-report.md")}`);
}

main();
