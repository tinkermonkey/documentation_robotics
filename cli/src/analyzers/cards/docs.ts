/**
 * Documentation evidence from the CBM graph (codebase-memory-mcp 0.12+): architecture decision
 * records and the doc sections that point at code.
 *
 * - An `ADR` node (a Markdown or reStructuredText decision record) carries its id, title, status,
 *   date, deciders and decision; `SUPERSEDES` joins a record to the one it replaces. A record is
 *   evidence for a motivation element (principle, constraint, assessment) that the calling agent
 *   (Tier 2) proposes: intent is never decided from the graph alone.
 * - A `Section` node is a doc heading with its text. `MENTIONS` joins a section to a symbol or a
 *   file it names or links; `REFERENCES_FILE` joins a doc file to a code file it names. They are
 *   description evidence for the cards of that code, kept short (see the limits below).
 *
 * Nothing here decides or stages anything. See docs/analyzers/CBM_MAPPING_INVENTORY.md.
 */
import type { CardGraph } from "./types.js";

/** Characters kept from a section's text. */
export const DOC_EXCERPT_CHARS = 240;
/** Doc sections attached to one card. */
export const DOCS_PER_CARD = 2;
/** Characters kept from a decision record's decision. */
export const DECISION_CHARS = 400;
/** Characters kept from a decision record's context and consequences. */
export const DECISION_CONTEXT_CHARS = 280;
/** Code a decision record's sections name, listed per record. */
export const DECISION_MENTIONS = 8;
/** Doc files whose sections one query reads. */
const FILES_PER_QUERY = 100;

/** Statuses that retire a decision: it no longer holds, so it yields no active element. */
const RETIRED_STATUSES: ReadonlySet<string> = new Set(["superseded", "deprecated", "rejected", "retired", "obsolete"]);

/** Doc files that record history rather than describe the code: never description evidence. */
const HISTORY_DOC = /(^|\/)(CHANGELOG|CHANGES|HISTORY|RELEASE[_-]?NOTES)[^/]*$/i;

/** A doc section that describes a piece of code. */
export interface DocEvidence {
  /** The doc file, relative to the codebase root. */
  doc: string;
  /** The section heading; absent when only the doc file is known. */
  section?: string;
  /** The section's lines in the doc (`6-7`). */
  lines?: string;
  /** The section's text, cut to {@link DOC_EXCERPT_CHARS}. */
  excerpt?: string;
  /**
   * How the doc points at the code: `mentions` names the symbol itself, `mentions-file` names or
   * links its file, `references-file` is a doc file naming its file (no section of its own).
   */
  via: "mentions" | "mentions-file" | "references-file";
}

/** Another decision record a record names. */
export interface DecisionRef {
  id: string;
  title: string;
  file: string;
}

/** An architecture decision record, as CBM indexes it. */
export interface DecisionRecord {
  /** Full qualified name (project prefix included). */
  qualifiedName: string;
  /** `ADR-3`, or the file's stem when CBM gives no id. */
  id: string;
  title: string;
  /** Lower-case status (`accepted`, `proposed`, `superseded`, ...); empty when the record states none. */
  status: string;
  /** The status line as written (`Superseded by 3. Store orders in PostgreSQL`). */
  statusText?: string;
  date?: string;
  deciders?: string;
  /** The decision, cut to {@link DECISION_CHARS}. */
  decision?: string;
  context?: string;
  consequences?: string;
  file: string;
  lines: string | null;
  /** Records this one supersedes. */
  supersedes: DecisionRef[];
  /** Records that supersede this one. */
  supersededBy: DecisionRef[];
  /** Superseded, deprecated or rejected: it yields no active element. */
  retired: boolean;
  /** Code its sections name: symbols (qualified, project prefix stripped) and files. */
  mentions: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
}

function linesOf(start: unknown, end: unknown): string | null {
  const s = Number(str(start));
  const e = Number(str(end));
  if (!Number.isFinite(s) || s <= 0) return null;
  return `${s}-${Number.isFinite(e) && e >= s ? e : s}`;
}

/** Collapse whitespace and cut to `max` characters. */
export function excerpt(text: unknown, max: number): string | undefined {
  const t = str(text).replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

/** CBM returns `labels(n)` as a JSON-encoded list (or a real one). */
function labelsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = JSON.parse(str(v));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return str(v) ? [str(v)] : [];
  }
}

function cypherString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function stripProject(qn: string, project: string): string {
  return qn.startsWith(project + ".") ? qn.slice(project.length + 1) : qn;
}

interface SectionRow {
  file: string;
  name: string;
  lines: string | null;
  text: string;
}

/** The sections of these doc files, by file, in line order. */
async function sectionsOf(graph: CardGraph, files: string[]): Promise<Map<string, SectionRow[]>> {
  const out = new Map<string, SectionRow[]>();
  const unique = [...new Set(files)];
  for (let i = 0; i < unique.length; i += FILES_PER_QUERY) {
    const batch = unique.slice(i, i + FILES_PER_QUERY);
    const rows = await graph.rows(
      `MATCH (s:Section) WHERE s.file_path IN [${batch.map(cypherString).join(", ")}] RETURN s.file_path, s.name, s.start_line, s.end_line, s.docstring`
    );
    for (const [file, name, start, end, text] of rows) {
      const f = str(file);
      if (!f) continue;
      (out.get(f) ?? out.set(f, []).get(f)!).push({ file: f, name: str(name), lines: linesOf(start, end), text: str(text) });
    }
  }
  for (const list of out.values()) list.sort((a, b) => Number(a.lines?.split("-")[0] ?? 0) - Number(b.lines?.split("-")[0] ?? 0));
  return out;
}

/** A section's `MENTIONS` edge: the section and the symbol, file or record it names. */
export interface MentionRow {
  /** The section's doc file. */
  doc: string;
  section: string;
  start: unknown;
  end: unknown;
  text: unknown;
  /** Full qualified name of what it names. */
  target: string;
  targetFile: string;
  labels: string[];
}

const MENTIONS_QUERY =
  "MATCH (s:Section)-[r:MENTIONS]->(b) RETURN s.file_path, s.name, s.start_line, s.end_line, s.docstring, b.qualified_name, b.file_path, labels(b)";

/**
 * Every section's `MENTIONS`, in doc file and line order, so a cap keeps the first ones the docs
 * give whatever order the graph returns them in. Read once and shared by
 * {@link collectDecisionRecords} and {@link buildDocIndex}.
 */
export async function readMentions(graph: CardGraph): Promise<MentionRow[]> {
  const rows: MentionRow[] = [];
  for (const [doc, section, start, end, text, target, targetFile, labels] of await graph.rows(MENTIONS_QUERY)) {
    rows.push({ doc: str(doc), section: str(section), start, end, text, target: str(target), targetFile: str(targetFile), labels: labelsOf(labels) });
  }
  const line = (v: unknown) => {
    const n = Number(str(v));
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  return rows.sort((a, b) => a.doc.localeCompare(b.doc) || line(a.start) - line(b.start) || a.target.localeCompare(b.target));
}

/**
 * Every decision record in the project, with its supersessions and the code its sections name.
 * Records come back in id order (`ADR-2` before `ADR-10`). `mentions` is {@link readMentions}'s
 * answer when the caller has it.
 */
export async function collectDecisionRecords(graph: CardGraph, mentions?: MentionRow[]): Promise<DecisionRecord[]> {
  const rows = await graph.rows(
    "MATCH (a:ADR) RETURN a.qualified_name, a.file_path, a.adr_id, a.title, a.status, a.status_text, a.date, a.deciders, a.docstring, a.superseded_by, a.start_line, a.end_line"
  );
  const records: DecisionRecord[] = [];
  const supersededByFile = new Map<DecisionRecord, string>();
  for (const [qn, file, id, title, status, statusText, date, deciders, decision, supersededBy, start, end] of rows) {
    const q = str(qn);
    const f = str(file);
    if (!q || !f) continue;
    const stem = f.split("/").pop()!.replace(/\.[^.]+$/, "");
    const optional = {
      statusText: excerpt(statusText, 160),
      date: excerpt(date, 40),
      deciders: excerpt(deciders, 160),
      decision: excerpt(decision, DECISION_CHARS),
    };
    const record: DecisionRecord = {
      qualifiedName: q,
      id: str(id) || stem,
      title: str(title) || stem,
      status: str(status).toLowerCase(),
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
      file: f,
      lines: linesOf(start, end),
      supersedes: [],
      supersededBy: [],
      retired: false,
      mentions: [],
    };
    // `superseded_by` names the newer record's file; resolved once every record is read.
    const by = str(supersededBy);
    if (by) supersededByFile.set(record, by);
    records.push(record);
  }
  if (!records.length) return [];

  const byQn = new Map(records.map((r) => [r.qualifiedName, r]));
  const ref = (r: DecisionRecord): DecisionRef => ({ id: r.id, title: r.title, file: r.file });
  const link = (newer: DecisionRecord, older: DecisionRecord) => {
    if (newer === older) return;
    if (!newer.supersedes.some((x) => x.file === older.file)) newer.supersedes.push(ref(older));
    if (!older.supersededBy.some((x) => x.file === newer.file)) older.supersededBy.push(ref(newer));
  };
  for (const [a, b] of await graph.rows("MATCH (a:ADR)-[r:SUPERSEDES]->(b:ADR) RETURN a.qualified_name, b.qualified_name")) {
    const newer = byQn.get(str(a));
    const older = byQn.get(str(b));
    if (newer && older) link(newer, older);
  }
  for (const [r, file] of supersededByFile) {
    // A link relative to the record's folder, else one from the root, else the only file of that name.
    const dir = r.file.slice(0, r.file.lastIndexOf("/") + 1);
    const base = file.split("/").pop()!;
    const sameName = records.filter((x) => x.file.split("/").pop() === base);
    const newer = records.find((x) => x.file === dir + file.replace(/^\.\//, "")) ?? records.find((x) => x.file === file) ?? (sameName.length === 1 ? sameName[0] : undefined);
    if (newer) link(newer, r);
  }
  // Superseded only by a record that is itself only proposed: still in force.
  const statusOf = new Map(records.map((r) => [r.file, r.status]));
  for (const r of records) r.retired = RETIRED_STATUSES.has(r.status) || r.supersededBy.some((s) => statusOf.get(s.file) !== "proposed");

  // Context and consequences from the record's own sections.
  const sections = await sectionsOf(graph, records.map((r) => r.file));
  for (const r of records) {
    for (const s of sections.get(r.file) ?? []) {
      const heading = s.name.toLowerCase();
      if (!r.context && /^(context|context and problem statement|problem|background)\b/.test(heading)) {
        const t = excerpt(s.text, DECISION_CONTEXT_CHARS);
        if (t) r.context = t;
      } else if (!r.consequences && /^consequences?\b/.test(heading)) {
        const t = excerpt(s.text, DECISION_CONTEXT_CHARS);
        if (t) r.consequences = t;
      }
    }
  }

  // The code each record's sections name (a link to another record is a supersession, not code).
  const recordFiles = new Set(records.map((r) => r.file));
  const byFile = new Map(records.map((r) => [r.file, r]));
  for (const m of mentions ?? (await readMentions(graph))) {
    const r = byFile.get(m.doc);
    if (!r || r.mentions.length >= DECISION_MENTIONS) continue;
    const kind = m.labels;
    const tf = m.targetFile;
    if (recordFiles.has(tf) || kind.includes("Folder") || kind.includes("Section") || kind.includes("ADR")) continue;
    const name = kind.includes("File") ? tf : stripProject(m.target, graph.project);
    if (name && !r.mentions.includes(name)) r.mentions.push(name);
  }

  const num = (id: string) => Number(/(\d+)/.exec(id)?.[1] ?? Number.NaN);
  return records.sort((a, b) => {
    const na = num(a.id);
    const nb = num(b.id);
    return Number.isFinite(na) && Number.isFinite(nb) && na !== nb ? na - nb : a.file.localeCompare(b.file);
  });
}

/** Doc sections by the code they describe. */
export interface DocIndex {
  /** Full qualified name -> sections that mention that symbol. */
  bySymbol: Map<string, DocEvidence[]>;
  /** File path -> sections (or doc files) that name or link that file. */
  byFile: Map<string, DocEvidence[]>;
}

function pushEvidence(m: Map<string, DocEvidence[]>, key: string, e: DocEvidence): void {
  const list = m.get(key) ?? m.set(key, []).get(key)!;
  if (!list.some((x) => x.doc === e.doc && x.section === e.section)) list.push(e);
}

/**
 * The doc sections that point at code: `MENTIONS` from a section to a symbol or a file, and
 * `REFERENCES_FILE` from a doc file to a code file (the excerpt is the doc's first section that
 * names the file, when one does). Changelogs and decision records are left out: a changelog is
 * history, and a decision record is its own card.
 */
export async function buildDocIndex(graph: CardGraph, mentions?: MentionRow[]): Promise<DocIndex> {
  const index: DocIndex = { bySymbol: new Map(), byFile: new Map() };
  const adrFiles = new Set<string>();
  for (const [file] of await graph.rows("MATCH (a:ADR) RETURN a.file_path")) if (str(file)) adrFiles.add(str(file));
  const skipDoc = (doc: string) => !doc || HISTORY_DOC.test(doc) || adrFiles.has(doc);

  for (const { doc: d, section, start, end, text, target, targetFile: tf, labels: kind } of mentions ?? (await readMentions(graph))) {
    if (skipDoc(d) || tf === d) continue;
    if (kind.includes("Folder") || kind.includes("Section") || kind.includes("ADR")) continue;
    const base: DocEvidence = {
      doc: d,
      ...(str(section) ? { section: str(section) } : {}),
      ...(linesOf(start, end) ? { lines: linesOf(start, end)! } : {}),
      ...(excerpt(text, DOC_EXCERPT_CHARS) ? { excerpt: excerpt(text, DOC_EXCERPT_CHARS)! } : {}),
      via: "mentions",
    };
    if (kind.includes("File")) {
      if (tf) pushEvidence(index.byFile, tf, { ...base, via: "mentions-file" });
    } else if (str(target)) {
      pushEvidence(index.bySymbol, str(target), base);
    }
  }

  const refs: Array<{ doc: string; target: string }> = [];
  for (const [doc, target] of await graph.rows("MATCH (a:File)-[r:REFERENCES_FILE]->(b:File) RETURN a.file_path, b.file_path")) {
    const d = str(doc);
    const t = str(target);
    if (!skipDoc(d) && t && t !== d) refs.push({ doc: d, target: t });
  }
  if (refs.length) {
    const sections = await sectionsOf(graph, refs.map((r) => r.doc));
    for (const { doc, target } of refs) {
      // Already known through a section of the same doc: nothing to add.
      if ((index.byFile.get(target) ?? []).some((e) => e.doc === doc)) continue;
      const name = target.split("/").pop()!;
      const hit = (sections.get(doc) ?? []).find((s) => s.text.includes(target) || s.text.includes(name));
      pushEvidence(
        index.byFile,
        target,
        hit
          ? {
              doc,
              section: hit.name,
              ...(hit.lines ? { lines: hit.lines } : {}),
              ...(excerpt(hit.text, DOC_EXCERPT_CHARS) ? { excerpt: excerpt(hit.text, DOC_EXCERPT_CHARS)! } : {}),
              via: "references-file",
            }
          : { doc, via: "references-file" }
      );
    }
  }
  return index;
}

/** Labels whose cards also take the evidence of their file: a member (method, route) takes only its own. */
const FILE_LEVEL_LABELS: ReadonlySet<string> = new Set(["Module", "Class", "Interface", "Type", "Enum", "Trait", "Struct", "Function"]);

/**
 * The doc sections for a card, at most {@link DOCS_PER_CARD}: those that mention the symbol first,
 * then, for a module or a top-level declaration, those that name its file.
 */
export function docsFor(index: DocIndex, qualifiedName: string, file: string | null, label: string): DocEvidence[] {
  const out: DocEvidence[] = [...(index.bySymbol.get(qualifiedName) ?? [])];
  if (file && FILE_LEVEL_LABELS.has(label)) {
    for (const e of index.byFile.get(file) ?? []) if (!out.some((x) => x.doc === e.doc && x.section === e.section)) out.push(e);
  }
  return out.slice(0, DOCS_PER_CARD);
}
