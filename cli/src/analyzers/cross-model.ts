/**
 * Federated extraction: codebase-memory-mcp's (CBM) cross-repository edges as DR cross-model
 * references (`@{model}/{layer}.{type}.{name}` in an element's `references`).
 *
 * Opt-in, per project. `codebase_index` with `crossRepo` records the other repositories the code
 * talks to, each tied to a model the manifest declares under `models:` (by name, or by the
 * repository's git remote matching the declared `url`), in `.dr/analyzers/<analyzer>/cross-repo.json`.
 * With that file:
 * - each index run ends with CBM's `index_repository mode: "cross-repo-intelligence"` against
 *   those repositories ({@link runCrossRepoPass}), since a re-index drops the repository's
 *   `CROSS_*` edges;
 * - `codebase_extract` reads the `CROSS_*` edges and stages a reference on the calling element to
 *   the element the other model has for the route it calls ({@link planCrossModelReferences}).
 * Without the file nothing changes: no extra CBM call, no extra read.
 *
 * What CBM 0.12.1 writes (observed on fixture repositories, docs/analyzers/CBM_MAPPING_INVENTORY.md,
 * "Cross-repository edges"): in the calling project, `caller -[CROSS_HTTP_CALLS]-> its own client
 * Route`, with `target_project` (the serving CBM project), `target_function` and `target_file`
 * (the handler there), `url_path`, and `transport` (the HTTP method, only when the caller names
 * it). The serving project gets a copy from the handler to its Route pointing back at one caller.
 * Only CROSS_HTTP_CALLS is mapped: CROSS_CHANNEL has no element on either side yet (a Channel is
 * not an application event, #1080) and the other kinds were not observed.
 *
 * The reference's predicate is the first catalog triple from the caller's element type: to the
 * other model's `api.operation` (tests, triggers, references), else to the handler's element
 * (flows-to, the DATA_FLOWS twin). The catalog stays the authority; a caller type with no triple is
 * reported, not staged. The other model's element is looked up in its model on disk (the
 * repository's, or `modelPath`); when there is no model there, the reference is staged unverified,
 * to the id codebase_extract would give that route in that repository, and says so.
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYAML } from "yaml";
import type { ChangesetGraph } from "../core/changeset-graph.js";
import type { ExternalModelDeclaration } from "../types/index.js";
import { CLIError, ErrorCategory } from "../utils/errors.js";
import { resolveModelDirectory } from "../utils/project-paths.js";
import { CROSS_EDGE_TYPES, symbolSpellings, type CrossEdge, type ExtractionGraph } from "./cards/extract.js";
import { extractedElementId, findBySymbol, indexExisting, normPath, routeKey } from "./extraction-plan.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Another repository this code talks to, and the model (declared in the manifest) that documents it. */
export interface CrossRepoTarget {
  /** The name the manifest declares under `models:`, as declared. */
  model: string;
  /** Absolute path of that repository's root, as CBM indexes it. */
  codebase: string;
  /** Where its DR model is (a project root or model directory), when not in the repository itself. */
  modelPath?: string;
}

export interface CrossRepoRun {
  at: string;
  ok: boolean;
  /** The CBM project of this codebase. */
  project?: string;
  targets: Array<{ model: string; codebase: string; project?: string; index: "existing" | "indexed" | "missing" | "failed"; error?: string }>;
  /** CBM's counts (`cross_http_calls`, ..., `total_cross_edges`). */
  counts?: Record<string, number>;
  error?: string;
}

export interface CrossRepoConfig {
  version: 1;
  targets: CrossRepoTarget[];
  /** The last cross-repo-intelligence pass an index run made. */
  lastRun?: CrossRepoRun;
}

const CONFIG_FILE = "cross-repo.json";

export function crossRepoConfigPath(projectRoot: string, analyzer: string): string {
  return path.join(projectRoot, ".dr", "analyzers", analyzer, CONFIG_FILE);
}

/** A cross-repo configuration file that exists but can't be read or parsed. */
export class CrossRepoConfigError extends Error {
  constructor(
    readonly file: string,
    cause: unknown
  ) {
    super(
      `${CONFIG_FILE} is unreadable: ${cause instanceof Error ? cause.message : String(cause)}; ` +
        "call codebase_index with crossRepo to rewrite it"
    );
    this.name = "CrossRepoConfigError";
  }
}

/**
 * The project's cross-repo configuration, or null when it has none (a single-repository project).
 *
 * @throws CrossRepoConfigError when the file exists but can't be read or isn't a configuration
 */
export async function readCrossRepoConfig(projectRoot: string, analyzer: string): Promise<CrossRepoConfig | null> {
  const file = crossRepoConfigPath(projectRoot, analyzer);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new CrossRepoConfigError(file, error);
  }
  let parsed: Partial<CrossRepoConfig>;
  try {
    parsed = JSON.parse(raw) as Partial<CrossRepoConfig>;
  } catch (error) {
    throw new CrossRepoConfigError(file, error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CrossRepoConfigError(file, new Error("not a JSON object"));
  const targets = Array.isArray(parsed.targets)
    ? parsed.targets.filter((t): t is CrossRepoTarget => !!t && typeof t.model === "string" && typeof t.codebase === "string")
    : [];
  if (!targets.length) return null;
  return { version: 1, targets, ...(parsed.lastRun ? { lastRun: parsed.lastRun } : {}) };
}

/**
 * {@link readCrossRepoConfig} for callers that carry on without federation: an unreadable file
 * comes back as no configuration and a warning to show, never silently.
 */
export async function loadCrossRepoConfig(projectRoot: string, analyzer: string): Promise<{ config: CrossRepoConfig | null; warning?: string }> {
  try {
    return { config: await readCrossRepoConfig(projectRoot, analyzer) };
  } catch (error) {
    return { config: null, warning: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The targets whose model the manifest still declares under `models:`, each with the declared
 * spelling (matched case-insensitively, as reference validation does), and the models of the rest.
 */
export function declaredTargets(
  targets: CrossRepoTarget[],
  models: Record<string, unknown> | undefined
): { targets: CrossRepoTarget[]; undeclared: string[] } {
  const declared = Object.keys(models ?? {});
  const kept: CrossRepoTarget[] = [];
  const undeclared: string[] = [];
  for (const t of targets) {
    const hit = declared.find((d) => d.toLowerCase() === t.model.toLowerCase());
    if (hit) kept.push(hit === t.model ? t : { ...t, model: hit });
    else undeclared.push(t.model);
  }
  return { targets: kept, undeclared };
}

/** What a run says about targets whose model is no longer declared. */
export function undeclaredTargetsWarning(undeclared: string[]): string {
  return (
    `${CONFIG_FILE} links to model(s) the manifest no longer declares under models: ${undeclared.join(", ")}. ` +
    "They are left out; declare them again, or call codebase_index with crossRepo to rewrite the list"
  );
}

/** The models a project's manifest declares under `models:` (undefined when it declares none). */
export async function readDeclaredModels(projectRoot: string): Promise<Record<string, ExternalModelDeclaration> | undefined> {
  const resolved = await resolveModelDirectory(projectRoot, { requireManifest: true });
  if (!resolved?.isDirectory) throw new Error(`no model manifest under ${projectRoot}`);
  const manifest = parseYAML(await readFile(path.join(resolved.modelDir, "manifest.yaml"), "utf-8")) as { models?: unknown } | null;
  const models = manifest?.models;
  return models && typeof models === "object" && !Array.isArray(models) ? (models as Record<string, ExternalModelDeclaration>) : undefined;
}

/** Writes the configuration; null (or no targets) removes it, turning the feature off. */
export async function writeCrossRepoConfig(projectRoot: string, analyzer: string, config: CrossRepoConfig | null): Promise<void> {
  const file = crossRepoConfigPath(projectRoot, analyzer);
  if (!config || !config.targets.length) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** A path as one spelling: real path when it exists, no trailing slash. */
export function canonicalPath(p: string): string {
  let out = path.resolve(p);
  try {
    out = realpathSync(out);
  } catch {
    // Not on disk: keep it resolved.
  }
  return out.length > 1 ? out.replace(/[\\/]+$/, "") : out;
}

/**
 * A git URL reduced to `host/owner/repo`, so `git@github.com:org/repo.git`,
 * `https://user@github.com/org/repo` and `ssh://git@github.com/org/repo.git` compare equal.
 */
export function normalizeGitUrl(url: string): string {
  let u = url.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(u);
  if (scp) u = `${scp[1]}/${scp[2]}`;
  else u = u.replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "");
  u = u.replace(/\.git$/i, "").replace(/\/+$/, "");
  const slash = u.indexOf("/");
  const host = (slash < 0 ? u : u.slice(0, slash)).replace(/:\d+$/, "").toLowerCase();
  return slash < 0 ? host : `${host}${u.slice(slash).toLowerCase()}`;
}

/** The repository's `origin` remote URL, or null. */
export function gitOriginUrl(dir: string): string | null {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: dir, stdio: "pipe", encoding: "utf-8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/**
 * The declared model a repository documents: `explicit` when given (it must be declared), else the
 * one whose `url` is the repository's origin remote.
 *
 * @throws CLIError when the name is not declared, or no (or more than one) declared url matches
 */
export function resolveTargetModel(
  models: Record<string, ExternalModelDeclaration> | undefined,
  codebase: string,
  explicit?: string,
  originUrl: (dir: string) => string | null = gitOriginUrl
): string {
  const declared = Object.keys(models ?? {});
  const listing = declared.length ? `Declared models: ${declared.join(", ")}` : "The manifest declares no models";
  if (explicit) {
    const hit = declared.find((d) => d.toLowerCase() === explicit.toLowerCase());
    if (!hit) {
      throw new CLIError(`Model '${explicit}' is not declared in the manifest's models:`, ErrorCategory.USER, [
        listing,
        `Declare it under models: in documentation-robotics/model/manifest.yaml (with its url), then try again`,
      ]);
    }
    return hit;
  }
  const origin = originUrl(codebase);
  if (!origin) {
    throw new CLIError(`Can't tell which declared model ${codebase} is: it has no git origin remote`, ErrorCategory.USER, [
      listing,
      "Pass model with the declared name",
    ]);
  }
  const want = normalizeGitUrl(origin);
  const matches = declared.filter((d) => models![d]?.url && normalizeGitUrl(models![d].url!) === want);
  if (matches.length !== 1) {
    throw new CLIError(
      matches.length
        ? `Several declared models have the url of ${codebase} (${origin}): ${matches.join(", ")}`
        : `No declared model has the url of ${codebase} (${origin})`,
      ErrorCategory.USER,
      [listing, "Pass model with the declared name, or set its url under models: in the manifest"]
    );
  }
  return matches[0];
}

// ---------------------------------------------------------------------------
// The CBM pass
// ---------------------------------------------------------------------------

/** The CBM calls the pass makes ({@link CbmTools} satisfies it). */
export interface CrossRepoTools {
  listProjects(): Promise<Array<{ name: string; root_path: string }>>;
  indexRepository(repoPath: string, options?: { timeout?: number }): Promise<Record<string, unknown>>;
  crossRepoIntelligence(repoPath: string, targetProjects: string[], options?: { timeout?: number; name?: string }): Promise<Record<string, unknown>>;
}

/**
 * Link this codebase to the configured repositories: each target is found among CBM's projects by
 * its root path, and indexed first when CBM has not indexed it (CBM links only indexed projects;
 * no `.cbmignore` is written into another repository). Never throws: a failure is in the result.
 */
export async function runCrossRepoPass(
  tools: CrossRepoTools,
  codebaseRoot: string,
  targets: CrossRepoTarget[],
  options: { timeout?: number } = {}
): Promise<CrossRepoRun> {
  const at = new Date().toISOString();
  const run: CrossRepoRun = { at, ok: false, targets: [] };
  try {
    const byRoot = new Map<string, string>();
    for (const p of await tools.listProjects()) if (p.root_path) byRoot.set(canonicalPath(p.root_path), p.name);
    run.project = byRoot.get(canonicalPath(codebaseRoot));
    const names: string[] = [];
    for (const t of targets) {
      const root = canonicalPath(t.codebase);
      const entry: CrossRepoRun["targets"][number] = { model: t.model, codebase: t.codebase, index: "existing" };
      let name = byRoot.get(root);
      if (!name) {
        if (!existsSync(root)) {
          entry.index = "missing";
          entry.error = `No directory at ${t.codebase}`;
        } else {
          try {
            const res = await tools.indexRepository(root, options);
            name = typeof res.project === "string" ? res.project : undefined;
            if (!name) {
              for (const p of await tools.listProjects()) if (p.root_path && canonicalPath(p.root_path) === root) name = p.name;
            }
            entry.index = name ? "indexed" : "failed";
            if (!name) entry.error = "codebase-memory-mcp indexed it but did not list it";
          } catch (error) {
            entry.index = "failed";
            entry.error = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (name) {
        entry.project = name;
        names.push(name);
      }
      run.targets.push(entry);
    }
    if (!names.length) {
      run.error = "None of the cross-repo targets is indexed by codebase-memory-mcp";
      return run;
    }
    const res = await tools.crossRepoIntelligence(canonicalPath(codebaseRoot), [...new Set(names)], {
      ...options,
      ...(run.project ? { name: run.project } : {}),
    });
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(res)) if (typeof v === "number" && (k.startsWith("cross_") || k === "total_cross_edges")) counts[k] = v;
    run.counts = counts;
    run.ok = res.status === undefined || res.status === "success";
    if (!run.ok) run.error = `codebase-memory-mcp answered status '${String(res.status)}'`;
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
  }
  return run;
}

/**
 * The route each handler serves in a target project, from rows of
 * `MATCH (f)-[:HANDLES]->(r:Route) RETURN f.name, f.file_path, r.qualified_name, r.name`
 * (the stored name keeps the code's parameter names). Keyed `file#function`.
 */
export function handlerRoutes(rows: unknown[][]): Map<string, Array<{ method: string; path: string }>> {
  const out = new Map<string, Array<{ method: string; path: string }>>();
  for (const [fn, file, qn, name] of rows) {
    if (typeof fn !== "string" || typeof file !== "string" || typeof qn !== "string") continue;
    const m = /^__route__([A-Z]+)__(\/.*)$/.exec(qn);
    if (!m) continue;
    const stored = typeof name === "string" && name.startsWith("/") && normPath(name) === normPath(m[2]) ? name : m[2];
    const key = `${file}#${fn}`;
    const list = out.get(key) ?? out.set(key, []).get(key)!;
    if (!list.some((r) => r.method === m[1] && r.path === stored)) list.push({ method: m[1], path: stored });
  }
  return out;
}

/** Sets {@link CrossEdge.targetRoute} where the target handler serves one route (or one of the edge's method). */
export function attachTargetRoutes(edges: CrossEdge[], project: string, routes: Map<string, Array<{ method: string; path: string }>>): void {
  for (const e of edges) {
    if (e.targetProject !== project || !e.targetFile || !e.targetFunction) continue;
    let served = routes.get(`${e.targetFile}#${e.targetFunction}`) ?? [];
    // Narrow by the call's method and path where that leaves a route (a gateway prefix can differ).
    const narrow = (keep: (r: { method: string; path: string }) => boolean) => {
      const kept = served.filter(keep);
      if (kept.length) served = kept;
    };
    const method = callMethod(e);
    if (method) narrow((r) => r.method === method);
    const want = e.urlPath ? normPath(urlPathOnly(e.urlPath)) : null;
    if (want) narrow((r) => normPath(r.path) === want);
    if (served.length === 1) e.targetRoute = served[0];
  }
}

// ---------------------------------------------------------------------------
// The other model
// ---------------------------------------------------------------------------

export interface ExternalElement {
  id: string;
  layer: string;
  type: string;
  attributes: Record<string, unknown>;
  locations: Array<{ file: string; symbol?: string }>;
}

export interface ExternalModel {
  model: string;
  modelDir: string;
  elements: ExternalElement[];
  /** `METHOD /path` (parameters as `{}`) -> operations. */
  byRoute: Map<string, ExternalElement[]>;
  /** `/path` -> operations, any method. */
  byPath: Map<string, ExternalElement[]>;
  /** `file#symbol` -> elements. */
  bySymbol: Map<string, ExternalElement[]>;
  /** Layer files that could not be parsed (relative to the model directory): their elements are unknown. */
  unreadable: Array<{ file: string; error: string }>;
}

/** Elements of one layer YAML file (the three shapes ComposedReferenceValidator reads). */
function yamlItems(parsed: unknown): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const items = Array.isArray(parsed) ? parsed : Array.isArray(obj.elements) ? obj.elements : Object.values(obj);
  return items.filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && ("path" in i || "id" in i));
}

/** Index elements of another model by route and by source symbol. */
export function indexExternalModel(
  model: string,
  modelDir: string,
  elements: ExternalElement[],
  unreadable: ExternalModel["unreadable"] = []
): ExternalModel {
  const byRoute = new Map<string, ExternalElement[]>();
  const byPath = new Map<string, ExternalElement[]>();
  const bySymbol = new Map<string, ExternalElement[]>();
  const push = (m: Map<string, ExternalElement[]>, k: string, e: ExternalElement) => {
    const list = m.get(k) ?? m.set(k, []).get(k)!;
    if (!list.includes(e)) list.push(e);
  };
  for (const e of elements) {
    for (const l of e.locations) if (l.symbol) push(bySymbol, `${l.file}#${l.symbol}`, e);
    if (e.layer !== "api" || e.type !== "operation") continue;
    const keys = new Set<string>();
    for (const l of e.locations) {
      const k = l.symbol ? routeKey(l.symbol) : null;
      if (k) keys.add(k);
    }
    const method = e.attributes.http_method;
    const p = e.attributes.http_path;
    if (typeof method === "string" && typeof p === "string") keys.add(`${method.toUpperCase()} ${normPath(p)}`);
    for (const k of keys) {
      push(byRoute, k, e);
      push(byPath, k.slice(k.indexOf(" ") + 1), e);
    }
  }
  return { model, modelDir, elements, byRoute, byPath, bySymbol, unreadable };
}

/**
 * Another project's model, read from disk without loading it as a Model: `basePath` is its
 * project root (documentation-robotics/model/), a legacy root (model/) or the model directory.
 * Null when there is no model there.
 */
export async function loadExternalModel(model: string, basePath: string): Promise<ExternalModel | null> {
  const resolved = await resolveModelDirectory(basePath, { requireManifest: true }).catch(() => null);
  if (!resolved?.isDirectory) return null;
  const elements: ExternalElement[] = [];
  const unreadable: ExternalModel["unreadable"] = [];
  for (const entry of await readdir(resolved.modelDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+_/.test(entry.name)) continue;
    const dir = path.join(resolved.modelDir, entry.name);
    const dirLayer = entry.name.replace(/^\d+_/, "");
    for (const file of await readdir(dir)) {
      if (!/\.ya?ml$/.test(file)) continue;
      let parsed: unknown;
      try {
        parsed = parseYAML(await readFile(path.join(dir, file), "utf-8"));
      } catch (error) {
        // Reported, so "model it there first" isn't taken at face value for a file DR couldn't read.
        unreadable.push({ file: `${entry.name}/${file}`, error: error instanceof Error ? error.message.split("\n")[0] : String(error) });
        continue;
      }
      for (const item of yamlItems(parsed)) {
        const id = typeof item.path === "string" && item.path ? item.path : typeof item.id === "string" ? item.id : null;
        if (!id) continue;
        const spec = typeof item.spec_node_id === "string" ? item.spec_node_id : "";
        const dot = spec.lastIndexOf(".");
        const layer = typeof item.layer_id === "string" && item.layer_id ? item.layer_id : dot > 0 ? spec.slice(0, dot) : dirLayer;
        const type = typeof item.type === "string" && item.type ? item.type : dot > 0 ? spec.slice(dot + 1) : "";
        const ref = item.source_reference as { locations?: Array<{ file?: unknown; symbol?: unknown }> } | undefined;
        const locations = (ref?.locations ?? [])
          .filter((l) => typeof l?.file === "string" && l.file)
          .map((l) => ({
            file: (l.file as string).replace(/\\/g, "/").replace(/^\.\//, ""),
            ...(typeof l.symbol === "string" && l.symbol ? { symbol: l.symbol } : {}),
          }));
        const attributes = item.attributes && typeof item.attributes === "object" ? (item.attributes as Record<string, unknown>) : {};
        elements.push({ id, layer, type, attributes, locations });
      }
    }
  }
  return indexExternalModel(model, resolved.modelDir, elements, unreadable);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** The CROSS_* kinds DR counts and leaves out, with why. CROSS_HTTP_CALLS is the one it maps. */
export const UNMAPPED_CROSS_EDGES: Record<string, string> = {
  CROSS_CHANNEL:
    "not mapped: neither side's Channel is an element (no rule makes one an application event yet, #1080), and CBM writes the edge from a file, not a function",
  CROSS_ASYNC_CALLS: "not mapped: not observed on CBM 0.12.1, so its shape is unknown",
  CROSS_GRPC_CALLS: "not mapped: not observed on CBM 0.12.1, so its shape is unknown",
  CROSS_GRAPHQL_CALLS: "not mapped: not observed on CBM 0.12.1, so its shape is unknown",
  CROSS_TRPC_CALLS: "not mapped: not observed on CBM 0.12.1, so its shape is unknown",
};

/** Predicates from a caller to the operation it calls, in order of preference (the catalog decides). */
export const OPERATION_PREDICATES = ["tests", "triggers", "references"] as const;
/** Predicates from a caller to the code behind the operation: DATA_FLOWS's, from application code only. */
export const HANDLER_PREDICATES = ["flows-to"] as const;

export interface PlannedReference {
  /** The element in this model that holds the reference. */
  source: string;
  sourceLayer: string;
  /** `@model/layer.type.name`. */
  target: string;
  /** The predicate, from the source to the target. */
  type: string;
  edge: string;
  /** False when the other model could not be read, so the target id is what extraction would give it. */
  verified: boolean;
  description: string;
  /** The edge's evidence sentence, which starts the description: the same for a call on every run. */
  evidence: string;
}

export interface UnresolvedReference {
  edge: string;
  caller: string;
  file: string | null;
  model: string;
  route: string | null;
  reason: string;
  source?: string;
  /** The element the reference would name, when known. */
  candidate?: string;
}

export interface CrossModelPlan {
  references: PlannedReference[];
  unresolved: UnresolvedReference[];
  /** Edges left out, by reason. */
  skipped: Record<string, number>;
  /** CBM projects the edges name that no configured target is. */
  unknownProjects: string[];
}

export interface CrossModelTargetState {
  target: CrossRepoTarget;
  /** Its model on disk, or null when there is none. */
  external: ExternalModel | null;
}

/** A URL's path: `http://svc-orders:8000/api/orders/{}` -> `/api/orders/{}`. */
export function urlPathOnly(url: string): string {
  const stripped = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").replace(/[?#].*$/, "");
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

/** The HTTP method the caller uses: CBM's transport, else its client Route's method; null for ANY. */
function callMethod(e: CrossEdge): string | null {
  if (e.transport && /^[A-Z]+$/.test(e.transport)) return e.transport;
  const m = /^__route__([A-Z]+)__/.exec(e.to.qualifiedName);
  return m && m[1] !== "ANY" ? m[1] : null;
}

const typeOf = (e: { layer: string; type: string }) => `${e.layer}.${e.type}`;

/**
 * The cross-model references the extraction's `CROSS_HTTP_CALLS` edges give: from the caller's
 * element in this model (its own, or the class or module it is in) to the other model's operation
 * for the route, else to the handler's element. Pure.
 *
 * @param targets Configured targets by CBM project name.
 */
export function planCrossModelReferences(input: {
  extraction: ExtractionGraph;
  existing: ChangesetGraph;
  elementOf: Map<string, string>;
  elements: Map<string, { layer: string; type: string }>;
  hasTriple: (id: string) => boolean;
  targets: Map<string, CrossModelTargetState>;
  layers?: string[];
}): CrossModelPlan {
  const { extraction, existing, elementOf, elements, hasTriple, targets } = input;
  const plan: CrossModelPlan = { references: [], unresolved: [], skipped: {}, unknownProjects: [] };
  const skip = (reason: string) => (plan.skipped[reason] = (plan.skipped[reason] ?? 0) + 1);
  const unknown = new Set<string>();
  const layerSet = input.layers?.length ? new Set(input.layers) : null;
  const index = indexExisting(existing);
  const inScope = new Set(extraction.symbols.map((s) => s.qualifiedName));
  const project = extraction.project;
  const direct = (qn: string, name: string, file: string | null): string | undefined => {
    const own = elementOf.get(qn);
    if (own) return own;
    if (inScope.has(qn)) return undefined;
    return findBySymbol(index, file, symbolSpellings(qn, name, project))?.id;
  };
  // The caller's element, or the class or module it is in (as planRelationships rolls a member up).
  const sourceOf = (e: CrossEdge): string | undefined => {
    const own = direct(e.from.qualifiedName, e.from.name, e.from.file);
    if (own) return own;
    let qn = e.from.qualifiedName;
    for (let cut = qn.lastIndexOf("."); cut > 0; cut = qn.lastIndexOf(".")) {
      qn = qn.slice(0, cut);
      if (qn === project) break;
      const id = direct(qn, qn.slice(qn.lastIndexOf(".") + 1), e.from.file);
      if (id) return id;
    }
    return undefined;
  };

  const seen = new Set<string>();
  for (const e of extraction.crossEdges ?? []) {
    if (UNMAPPED_CROSS_EDGES[e.type] || !(CROSS_EDGE_TYPES as readonly string[]).includes(e.type)) {
      skip(`${e.type}: ${UNMAPPED_CROSS_EDGES[e.type] ?? "unknown edge type"}`);
      continue;
    }
    if (e.served) {
      skip("the serving side's copy of a call (the reference belongs to the caller's model)");
      continue;
    }
    const state = targets.get(e.targetProject);
    if (!state) {
      unknown.add(e.targetProject);
      skip("calls a codebase-memory-mcp project that is not a configured cross-repo target");
      continue;
    }
    const model = state.target.model;
    const method = e.targetRoute?.method ?? callMethod(e);
    const routePath = e.targetRoute?.path ?? (e.urlPath ? urlPathOnly(e.urlPath) : null);
    const routeText = routePath ? `${method ?? "ANY"} ${routePath}` : null;
    const caller = e.from.name;
    const source = sourceOf(e);
    if (!source) {
      skip("the caller is not an element (yet): stage it from its card, then run again");
      continue;
    }
    const src = elements.get(source);
    if (!src) {
      skip("the caller's element is not kept by this run");
      continue;
    }
    if (layerSet && !layerSet.has(src.layer)) {
      skip("the caller's element is outside the requested layers");
      continue;
    }
    const sourceType = typeOf(src);
    const base = { edge: e.type, caller, file: e.from.file, model, route: routeText, source };
    const handled = e.targetFunction && e.targetFile ? `, handled by ${e.targetFunction} in ${e.targetFile}` : "";
    const evidence = `${e.type} (codebase-memory-mcp): ${caller} calls ${routeText ?? e.urlPath ?? "a route"}${handled} in @${model}`;
    const push = (targetId: string, predicate: string, verified: boolean, note: string) => {
      const target = `@${model}/${targetId}`;
      const key = `${source}|${predicate}|${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      plan.references.push({ source, sourceLayer: src.layer, target, type: predicate, edge: e.type, verified, description: `${evidence}. ${note}`, evidence });
    };
    const firstTriple = (preds: readonly string[], toType: string) => preds.find((p) => hasTriple(`${sourceType}.${p}.${toType}`));

    const ext = state.external;
    if (!ext) {
      // No model to check against: the id extraction gives that route there, unverified.
      const opPredicate = firstTriple(OPERATION_PREDICATES, "api.operation");
      if (!method || !routePath) {
        plan.unresolved.push({ ...base, reason: `no DR model for @${model} at ${state.target.modelPath ?? state.target.codebase}, and the route's method is unknown, so no id can be proposed` });
      } else if (!opPredicate) {
        plan.unresolved.push({ ...base, reason: `the catalog has no relationship from ${sourceType} to api.operation` });
      } else {
        const id = extractedElementId("api", "operation", `${method} ${routePath.replace(/\{\}/g, "{param}")}`);
        push(id, opPredicate, false, `Unverified: no DR model for @${model} was found at ${state.target.modelPath ?? state.target.codebase}; ${id} is the id codebase_extract gives that route`);
      }
      continue;
    }

    // The operation for the route: by method and path, else by path alone; the handler's file breaks a tie.
    let ops = routePath ? (method ? ext.byRoute.get(`${method} ${normPath(routePath)}`) : ext.byPath.get(normPath(routePath))) ?? [] : [];
    if (ops.length > 1 && e.targetFile) {
      const inFile = ops.filter((o) => o.locations.some((l) => l.file === e.targetFile));
      if (inFile.length) ops = inFile;
    }
    const op = ops.length === 1 ? ops[0] : undefined;
    let handler: ExternalElement | undefined;
    if (e.targetFile && e.targetFunction) {
      handler =
        ext.bySymbol.get(`${e.targetFile}#${e.targetFunction}`)?.[0] ??
        ext.elements.find((x) => x.locations.some((l) => l.file === e.targetFile && !!l.symbol && l.symbol.endsWith(`.${e.targetFunction}`)));
    }
    const opPredicate = op ? firstTriple(OPERATION_PREDICATES, typeOf(op)) : undefined;
    if (op && opPredicate) {
      push(op.id, opPredicate, true, `Verified against @${model}'s model`);
      continue;
    }
    const handlerPredicate =
      handler && handler !== op && src.layer === "application" ? firstTriple(HANDLER_PREDICATES, typeOf(handler)) : undefined;
    if (handler && handlerPredicate) {
      push(handler.id, handlerPredicate, true, `Verified against @${model}'s model`);
      continue;
    }
    if (op || handler) {
      const what = [op ? op.id : null, handler && handler !== op ? handler.id : null].filter(Boolean).join(" or ");
      plan.unresolved.push({ ...base, candidate: `@${model}/${(op ?? handler)!.id}`, reason: `the catalog has no relationship from ${sourceType} to ${what}` });
    } else if (ops.length > 1) {
      plan.unresolved.push({ ...base, reason: `@${model}'s model has ${ops.length} operations for ${routeText}: ${ops.map((o) => o.id).join(", ")}` });
    } else {
      const proposed =
        method && routePath ? `@${model}/${extractedElementId("api", "operation", `${method} ${routePath.replace(/\{\}/g, "{param}")}`)}` : undefined;
      const unread = ext.unreadable.length
        ? ` (or it is in one of the ${ext.unreadable.length} layer file(s) of that model DR could not read: ${ext.unreadable.map((u) => u.file).join(", ")})`
        : "";
      plan.unresolved.push({
        ...base,
        ...(proposed ? { candidate: proposed } : {}),
        reason: `@${model}'s model has no element for ${routeText ?? "the route"}${handled ? ` or ${e.targetFunction}` : ""}: model it there first${unread}`,
      });
    }
  }
  plan.unknownProjects = [...unknown].sort();
  plan.references.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return plan;
}

/** Targets by CBM project name: a project whose root is a configured target's codebase. */
export async function crossModelTargets(
  config: CrossRepoConfig,
  projects: Record<string, string>
): Promise<Map<string, CrossModelTargetState>> {
  const out = new Map<string, CrossModelTargetState>();
  const byRoot = new Map<string, string[]>();
  for (const [name, root] of Object.entries(projects)) {
    const list = byRoot.get(canonicalPath(root)) ?? byRoot.set(canonicalPath(root), []).get(canonicalPath(root))!;
    list.push(name);
  }
  for (const target of config.targets) {
    const names = byRoot.get(canonicalPath(target.codebase)) ?? [];
    if (!names.length) continue;
    let base = target.modelPath ?? target.codebase;
    try {
      if (!statSync(base).isDirectory()) base = path.dirname(base);
    } catch {
      // Missing: loadExternalModel returns null.
    }
    const external = await loadExternalModel(target.model, base);
    for (const name of names) out.set(name, { target, external });
  }
  return out;
}

/** The elements' existing references, to leave one already there alone. */
export function hasReference(references: unknown, target: string, type: string): boolean {
  return (
    Array.isArray(references) &&
    references.some(
      (r) => !!r && typeof r === "object" && String((r as { target?: unknown }).target).toLowerCase() === target.toLowerCase() && (r as { type?: unknown }).type === type
    )
  );
}
