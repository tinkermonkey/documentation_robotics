/**
 * Architecture clusters as evidence for component boundaries (issue #1086).
 *
 * codebase-memory-mcp's `get_architecture` has two views of how symbols group:
 *
 * - `system_structure`: component candidates, each a declared module (one file or class) or an
 *   _interaction community_ that merges several files whose symbols call and use each other. It is
 *   computed in the background: the first call answers `{status: "pending", generation,
 *   retry_after_ms}` and later calls in the same server session answer `{status: "ready",
 *   result}`. A component lists one representative and counts the rest (`omitted_members`); a
 *   symbol's component is known when the result names it (a representative, a dependency witness,
 *   an entrypoint or a path node), or when it is the only component its file's named symbols are in.
 * - `clusters`: Louvain communities over CALLS edges, at most a dozen, each with a member count,
 *   cohesion and its five top symbols by name. Membership is not listed.
 *
 * Neither decides anything. A card gets the cross-file component it is in (a single-file component
 * says no more than the card's file does), and multi-file interaction communities are offered as
 * component proposals for the agent (Tier 2) to name or dismiss. Tier-0 decisions are never changed.
 * Measured on the three eval corpora (docs/EXTRACTION_STRATEGY.md, "Architecture clusters"), the
 * evidence did not improve component typing, so extraction asks for it only when the caller does.
 */
import { CbmToolError } from "../cbm-responses.js";

/** The `get_architecture` aspect with the component candidates; it must be asked alone. */
export const SYSTEM_STRUCTURE_ASPECT = "system_structure";
/** The `get_architecture` aspect with the Louvain communities. */
export const LOUVAIN_ASPECT = "clusters";

/** How long extraction waits for `system_structure` by default. */
export const DEFAULT_CLUSTER_WAIT_MS = 20_000;
/** How long extraction waits for the Louvain `clusters` answer. */
export const LOUVAIN_WAIT_MS = 10_000;
/** The Louvain call is not made with less than this left before the deadline. */
export const MIN_LOUVAIN_MS = 2_000;
/** Bounds on CBM's `retry_after_ms` between polls. */
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 2_000;

/** Payload bounds: what a response carries at most. */
export const MAX_PROPOSALS = 10;
export const MAX_PROPOSAL_FILES = 5;
export const MAX_PROPOSAL_SYMBOLS = 5;
export const MAX_COMMUNITIES = 8;
/** A community smaller than this is not proposed as a component. */
export const MIN_PROPOSAL_MEMBERS = 5;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** One `get_architecture` call: the arguments besides `project`, the parsed JSON result. */
export type ArchitectureCall = (args: Record<string, unknown>) => Promise<unknown>;

export type ArchitectureOutcome =
  | { status: "ready"; result: Obj; polls: number; waitedMs: number }
  | { status: "pending" | "unavailable"; reason: string; polls: number; waitedMs: number };

export interface PollOptions {
  /**
   * Give up after waiting this long (ms) in {@link ArchitectureRequest.result}. It bounds each call
   * as well as the polling: a call that hasn't answered when the time is up is not waited for.
   */
  maxWaitMs?: number;
  /** Never wait past this time (epoch ms), whatever maxWaitMs says, polling or in a call. */
  deadline?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const TIMED_OUT = Symbol("timed out");

/** The promise's value, or {@link TIMED_OUT} when it hasn't settled within `ms` (real time). */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One aspect of `get_architecture`, polled while CBM says it is pending. The first call can be
 * made early ({@link start}) so the background job runs while the caller does other work; {@link
 * result} then polls for at most the time left. Errors (an older CBM without the tool, a project
 * it doesn't know, a broken session) come back as `unavailable`, never thrown.
 */
export class ArchitectureRequest {
  private first: Promise<{ raw?: unknown; error?: unknown }> | null = null;
  private startedAt = 0;
  private polls = 0;

  constructor(
    private readonly call: ArchitectureCall,
    private readonly aspect: string,
    private readonly options: PollOptions = {}
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private ask(generation?: string): Promise<{ raw?: unknown; error?: unknown }> {
    this.polls++;
    return this.call({ aspects: [this.aspect], ...(generation ? { expected_generation: generation } : {}) }).then(
      (raw) => ({ raw }),
      (error: unknown) => ({ error })
    );
  }

  /** Make the first call, without waiting for its answer. */
  start(): this {
    if (!this.first) {
      this.startedAt = this.now();
      this.first = this.ask();
    }
    return this;
  }

  /**
   * The answer, polling while it is pending: for at most `maxWaitMs` from this call (the time the
   * caller spent between {@link start} and here is free) and never past the deadline. Each call is
   * raced against that limit too, so a slow one (CBM's tool timeout is minutes) can't hold the run.
   */
  async result(): Promise<ArchitectureOutcome> {
    this.start();
    const sleep = this.options.sleep ?? defaultSleep;
    const waitFrom = this.now();
    const limit = Math.min(waitFrom + (this.options.maxWaitMs ?? DEFAULT_CLUSTER_WAIT_MS), this.options.deadline ?? Infinity);
    const waited = () => this.now() - waitFrom;
    const answerOf = (call: Promise<{ raw?: unknown; error?: unknown }>) => within(call, limit - this.now());
    let askedAt = this.startedAt;
    let answer = await answerOf(this.first!);
    for (;;) {
      if (answer === TIMED_OUT) {
        return {
          status: "pending",
          reason: `get_architecture ${this.aspect} had not answered ${Math.round((this.now() - this.startedAt) / 1000)} s after it was asked`,
          polls: this.polls,
          waitedMs: waited(),
        };
      }
      if (answer.error !== undefined) {
        const e = answer.error;
        const reason = e instanceof CbmToolError ? e.detail : e instanceof Error ? e.message : String(e);
        return { status: "unavailable", reason: `get_architecture ${this.aspect}: ${reason}`, polls: this.polls, waitedMs: waited() };
      }
      const raw = answer.raw;
      if (!isObj(raw)) {
        return { status: "unavailable", reason: `get_architecture ${this.aspect}: unexpected answer`, polls: this.polls, waitedMs: waited() };
      }
      if (raw.status !== "pending") {
        // system_structure: {status: "ready", result}; clusters: the result itself.
        const result = raw.status === "ready" && isObj(raw.result) ? raw.result : raw;
        return { status: "ready", result, polls: this.polls, waitedMs: waited() };
      }
      // Ask again once CBM's retry time has passed since the last question: an answer start() got
      // before the caller's own work may already be due.
      const delay = Math.min(Math.max(num(raw.retry_after_ms) || 500, MIN_POLL_MS), MAX_POLL_MS);
      const pause = Math.max(0, askedAt + delay - this.now());
      if (this.now() + pause > limit) {
        return {
          status: "pending",
          reason: `get_architecture ${this.aspect} was still computing ${Math.round((this.now() - this.startedAt) / 1000)} s after it was asked`,
          polls: this.polls,
          waitedMs: waited(),
        };
      }
      if (pause > 0) await sleep(pause);
      askedAt = this.now();
      answer = await answerOf(this.ask(str(raw.generation) || undefined));
    }
  }
}

/** A `system_structure` component candidate. */
export interface StructureComponent {
  id: string;
  label: string;
  /** How CBM formed it: `declared_module`, `interaction_community`, `unassigned`, ... */
  basis: string;
  members: number;
  files: number;
  /** `test` or `non_test`. */
  role: string;
}

export interface SystemStructure {
  components: Map<string, StructureComponent>;
  /** Full qualified name -> component id, for every node the result names. */
  nodeComponent: Map<string, string>;
  /** File -> component id, for files whose named nodes are all in one component. */
  fileComponent: Map<string, string>;
  /** Files of the named nodes per component. */
  componentFiles: Map<string, Set<string>>;
  /** Component candidates in the whole graph (the result shows at most a few hundred). */
  totalComponents: number;
}

/** Index a `system_structure` result. */
export function parseSystemStructure(result: Obj): SystemStructure {
  const components = new Map<string, StructureComponent>();
  for (const c of Array.isArray(result.components) ? result.components : []) {
    if (!isObj(c) || !str(c.id)) continue;
    components.set(str(c.id), {
      id: str(c.id),
      label: str(c.label),
      basis: str(c.basis),
      members: num(c.member_count),
      files: num(c.file_count),
      role: str(c.role),
    });
  }
  const nodeComponent = new Map<string, string>();
  const nodeFile = new Map<string, string>();
  const see = (n: unknown) => {
    if (!isObj(n) || !str(n.component_id) || !str(n.qualified_name)) return;
    nodeComponent.set(str(n.qualified_name), str(n.component_id));
    const file = str(n.file_path);
    // CBM writes "{}" or "" for nodes with no file (branches, images).
    if (file && file !== "{}") nodeFile.set(str(n.qualified_name), file);
  };
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  for (const c of list(result.components)) if (isObj(c)) list(c.representatives).forEach(see);
  for (const d of list(result.dependencies)) {
    if (!isObj(d)) continue;
    for (const w of list(d.witnesses)) {
      if (!isObj(w)) continue;
      see(w.source);
      see(w.target);
    }
  }
  list(result.entrypoints).forEach(see);
  for (const p of list(result.paths)) if (isObj(p)) list(p.nodes).forEach(see);

  const filesByComponent = new Map<string, Set<string>>();
  const componentsByFile = new Map<string, Set<string>>();
  for (const [qn, comp] of nodeComponent) {
    const file = nodeFile.get(qn);
    if (!file) continue;
    (filesByComponent.get(comp) ?? filesByComponent.set(comp, new Set()).get(comp)!).add(file);
    (componentsByFile.get(file) ?? componentsByFile.set(file, new Set()).get(file)!).add(comp);
  }
  const fileComponent = new Map<string, string>();
  for (const [file, comps] of componentsByFile) if (comps.size === 1) fileComponent.set(file, [...comps][0]);
  const totals = isObj(result.totals) ? result.totals : {};
  return {
    components,
    nodeComponent,
    fileComponent,
    componentFiles: filesByComponent,
    totalComponents: num(totals.components) || components.size,
  };
}

/** The cluster a card is in: a component candidate spanning more than one file. */
export interface ClusterEvidence {
  /** CBM's component id (`component-6072`), shared by every card in the cluster. */
  id: string;
  /** CBM's label: its representative symbol or file. */
  label: string;
  /** `interaction_community` for a cluster CBM formed from calls and uses across files. */
  basis: string;
  members: number;
  files: number;
  /** Whether CBM named this symbol in the cluster, or only its file. */
  via: "symbol" | "file";
}

/**
 * The cross-file component a symbol is in, or null when it is in a single-file component (which
 * says only what its file does), in one the result doesn't show, or in none CBM named.
 */
export function clusterEvidence(structure: SystemStructure, qualifiedName: string, file: string | null): ClusterEvidence | null {
  let via: ClusterEvidence["via"] = "symbol";
  let id = structure.nodeComponent.get(qualifiedName);
  if (!id && file) {
    id = structure.fileComponent.get(file);
    via = "file";
  }
  const comp = id ? structure.components.get(id) : undefined;
  if (!comp || comp.files < 2) return null;
  return { id: comp.id, label: comp.label, basis: comp.basis, members: comp.members, files: comp.files, via };
}

/** A cluster offered to the agent as a possible `application.applicationcomponent`. */
export interface ComponentProposal {
  cluster: string;
  label: string;
  members: number;
  files: number;
  /** Files the cluster is known to span (at most {@link MAX_PROPOSAL_FILES}). */
  knownFiles: string[];
  /** Cards of this run in the cluster, as model_add sourceSymbol values (at most {@link MAX_PROPOSAL_SYMBOLS}). */
  symbols: string[];
  /** Cards of this run in the cluster, in all. */
  cards: number;
}

/**
 * Multi-file interaction communities outside test code, largest first, that hold at least one of
 * this run's cards: the component candidates CBM found beyond single files.
 */
export function componentProposals(
  structure: SystemStructure,
  cardsByCluster: Map<string, string[]>,
  limit = MAX_PROPOSALS
): { total: number; items: ComponentProposal[] } {
  const all = [...structure.components.values()]
    .filter((c) => c.basis === "interaction_community" && c.files > 1 && c.role !== "test" && c.members >= MIN_PROPOSAL_MEMBERS)
    .filter((c) => (cardsByCluster.get(c.id) ?? []).length > 0)
    .sort((a, b) => b.members - a.members || a.id.localeCompare(b.id));
  return {
    total: all.length,
    items: all.slice(0, limit).map((c) => {
      const symbols = cardsByCluster.get(c.id) ?? [];
      return {
        cluster: c.id,
        label: c.label,
        members: c.members,
        files: c.files,
        knownFiles: [...(structure.componentFiles.get(c.id) ?? [])].sort().slice(0, MAX_PROPOSAL_FILES),
        symbols: symbols.slice(0, MAX_PROPOSAL_SYMBOLS),
        cards: symbols.length,
      };
    }),
  };
}

/** A Louvain community from the `clusters` aspect. */
export interface LouvainCommunity {
  id: number;
  label: string;
  members: number;
  cohesion: number;
  /** Its top symbols, by name only (CBM gives no qualified names). */
  top: string[];
}

/** The Louvain communities of a `clusters` result, largest first (at most {@link MAX_COMMUNITIES}). */
export function louvainCommunities(result: Obj, limit = MAX_COMMUNITIES): LouvainCommunity[] {
  const table = isObj(result.clusters) ? result.clusters : {};
  const cols = Array.isArray(table.cols) ? table.cols.map(str) : [];
  const at = (row: unknown[], col: string) => row[cols.indexOf(col)];
  const rows = Array.isArray(table.rows) ? table.rows.filter(Array.isArray) : [];
  return rows
    .map((row: unknown[]) => ({
      id: num(at(row, "id")),
      label: str(at(row, "label")),
      members: num(at(row, "members")),
      cohesion: Math.round(num(at(row, "cohesion")) * 100) / 100,
      top: (Array.isArray(at(row, "top_nodes")) ? (at(row, "top_nodes") as unknown[]) : []).map(str).filter(Boolean).slice(0, 5),
    }))
    .sort((a, b) => b.members - a.members)
    .slice(0, limit);
}

/** What a run with clusters reports, besides the evidence on its cards. */
export interface ClusterReport {
  /** `ready`: evidence attached. `pending`: CBM was still computing when the wait ran out. `unavailable`: CBM couldn't answer. */
  status: "ready" | "pending" | "unavailable";
  reason?: string;
  waitedMs: number;
  /** Component candidates in the graph. */
  components?: number;
  /** Cards that carry a cluster. */
  cardsWithCluster?: number;
  proposals?: { total: number; items: ComponentProposal[]; note: string };
  communities?: LouvainCommunity[];
  /** Why the Louvain communities are missing: not answered in time, not asked for lack of time, or an error. */
  communitiesMissing?: { status: "pending" | "unavailable"; reason: string };
  note: string;
}

export const CLUSTER_NOTE =
  "Evidence only: a cluster is where codebase-memory-mcp's component candidates group symbols that call and use each other across files. " +
  "It decides nothing; Tier-0 decisions stand.";

export const PROPOSAL_NOTE =
  "Not staged. If one is an application.applicationcomponent, name it after what it does and stage it with model_add; the cards that " +
  "share its cluster are its likely members.";
