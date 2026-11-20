/**
 * Verify Engine - computes verification reports for API endpoints
 *
 * Implements the core algorithm for comparing graph-discovered routes against
 * model-defined operations, supporting dual-index matching and changeset awareness.
 */

import * as path from "path";
import { access, readFile } from "fs/promises";
import { Model } from "../core/model.js";
import { getErrorMessage } from "../utils/errors.js";
import type {
  VerifyReport,
  VerifyOptions,
  MatchedEntry,
  GraphOnlyEntry,
  ModelOnlyEntry,
  IgnoredEntry,
  VerifyBuckets,
  VerifySummary,
  IndexMeta,
  VerifyChangesetContext,
  NotIndexedEntry,
  LayerVerifyReport,
} from "./types.js";
import { VERIFIABLE_LAYERS } from "./types.js";
import { IgnoreFileLoader } from "./verify-ignore.js";
import { SOURCE_CODE_EXT_RE } from "./cbm-analyzer.js";
import { decisionKey, routeKey } from "./extraction-plan.js";
import { groupNotChecked, layerStatus, type LayerNouns, type NotCheckedElement } from "./verify-status.js";

/**
 * A discovered route from the graph
 */
export interface DiscoveredRoute {
  id: string;
  http_method?: string;
  http_path?: string;
  handler?: string;
  source_file?: string;
  source_symbol?: string;
}

/** What the API check reads besides the routes the code serves. */
export interface ApiVerifyContext {
  /**
   * Routes an API description declares (an OpenAPI file the analyzer read), each with the
   * description's path as `source_file`. A project that consumes an API it doesn't serve (a
   * frontend) has only these; codebase_extract stages its operations from them, so verify compares
   * the operations sourced to that file with them.
   */
  declaredRoutes?: DiscoveredRoute[];
  /**
   * Symbols recorded as not elements (codebase_extract's decisions, by `decisionKey`): a route
   * among them is not in the code only.
   */
  notElements?: ReadonlySet<string>;
}

/** Why an operation with no source reference can't be checked, and what would make it checkable. */
const NO_SOURCE_REASON = "no source reference: nothing ties it to a file to find it in";
const NO_SOURCE_TO_CHECK =
  "set the element's sourceFile and sourceSymbol (the file that serves the route, or the API description that declares it, " +
  "with `METHOD /path` as the symbol)";

/** How the API check names what it compares. */
export const API_NOUNS: LayerNouns = {
  model: "API operations",
  code: "HTTP routes",
  reads: "the HTTP routes the analyzer finds served in code, and the routes an OpenAPI file declares",
};

/**
 * Said when routes are in the code only. It names no command: the MCP tool says which of its tools
 * stage them (codebase-verify.ts), and `dr analyzer verify` prints it as is.
 */
export const IN_CODE_ONLY_HINT =
  "Routes in the code that the model has no operation for. Extraction stages an operation for each, with its source " +
  "reference. An operation added by hand is matched only when it carries a source file and symbol, or http_method and " +
  "http_path. A route that is not product code (a test fixture, an example) can be recorded as not an element, or " +
  "covered by a graph_only rule in .dr-verify-ignore.yaml.";

/** `GET /owners/{id}` and `GET /owners/{}` as one key; a path's parameters carry no name. */
function methodPathKey(method: string | undefined, routePath: string | undefined): string | null {
  if (!method || !routePath) return null;
  return routeKey(`${method.toUpperCase()} ${routePath}`);
}

/**
 * The longest literal run of a route's path, to look for in a file's text: `/api/changesets/` of
 * `/api/changesets/{id}/commit`. Null when the path has none worth looking for (`/`, `/*`, `/{id}`).
 */
function pathLiteral(routePath: string): string | null {
  const runs = routePath.split(/\{[^}]*\}|:[A-Za-z_]\w*|\*/).filter((run) => run.replace(/\//g, "").length >= 2);
  if (runs.length === 0) return null;
  return runs.reduce((longest, run) => (run.length > longest.length ? run : longest)).replace(/\/+$/, "") || null;
}

/** Whether a file's text names this symbol's last segment as a word. */
function namesSymbol(text: string, symbol: string): boolean {
  const last = symbol.split(/[./]/).filter(Boolean).pop() ?? symbol;
  if (!/^[\w$]+$/.test(last)) return false;
  return new RegExp(`(^|[^\\w$])${last.replace(/\$/g, "\\$")}($|[^\\w$])`).test(text);
}

/**
 * Model element reference extracted from the API layer
 * Contains the minimal set of fields needed for dual-index matching
 */
interface ModelElementRef {
  /** Element ID from the model */
  id: string;
  /** Source file path for primary index matching */
  source_file?: string;
  /** Source symbol for primary index matching */
  source_symbol?: string;
  /** HTTP method for secondary index matching */
  http_method?: string;
  /** HTTP path for secondary index matching */
  http_path?: string;
}

/**
 * Primary or secondary index entry (holds model element data, not discovered route data)
 */
interface IndexEntry {
  modelEntry: ModelElementRef;
  key: string;
}

/**
 * VerifyEngine - computes verification reports for API endpoints
 */
export class VerifyEngine {
  /**
   * Compute a comprehensive verification report
   *
   * Implements the five-step algorithm:
   * 1. Resolve model view via Model.load() + getActiveChangesetId() + getLayer("api")
   * 2. Build primary index on source_reference.locations[0].file + ":" + symbol
   *    and optional secondary index on http_method + ":" + http_path
   * 3. Load ignore rules
   * 4. Compute four buckets (matched, in_graph_only, in_model_only, ignored)
   * 5. Assemble VerifyReport
   *
   * @param projectRoot Absolute path to the project root
   * @param routes Array of discovered routes from the graph
   * @param options Verification options
   * @returns Comprehensive verification report
   */
  async computeReport(
    projectRoot: string,
    routes: DiscoveredRoute[],
    options: VerifyOptions,
    analyzerName: string = "codebase-memory-mcp",
    indexMeta?: IndexMeta,
    /**
     * The files among these the analyzer didn't index or parsed only in part, with why. An
     * operation sourced only to such files is not_indexed, not drift. Without it, none is.
     */
    notIndexed?: (files: string[]) => Promise<Map<string, string>>,
    context: ApiVerifyContext = {}
  ): Promise<VerifyReport> {
    // Step 1: Resolve model view
    let model: Model;
    try {
      model = await Model.load(projectRoot);
    } catch (error) {
      const message = getErrorMessage(error);
      // Check for model-not-found errors (matches all 4 error messages from Model.resolveModelPaths)
      if (
        message.includes("No DR project") ||
        message.includes("Model not found") ||
        message.includes("no model found") ||
        message.includes("Could not find documentation_robotics")
      ) {
        throw new Error(
          `Failed to load DR model at ${projectRoot}: Model not found. Please run 'dr init' to initialize the documentation robotics model.`
        );
      }
      // Re-throw original error unchanged to preserve stack trace and error type (e.g., YAML parse errors)
      throw error;
    }

    const activeChangesetId = model.getActiveChangesetId();

    // The API layer wasn't asked for: no route or operation is compared.
    if (options.layers && options.layers.length > 0 && !options.layers.includes("api")) {
      return this.assembleReport(
        projectRoot,
        model,
        { matched: [], in_graph_only: [], in_model_only: [], ignored: [] },
        activeChangesetId,
        options,
        analyzerName,
        indexMeta
      );
    }

    // Use base layer if changesetAware is explicitly false
    const apiLayer = options.changesetAware === false
      ? await model.getBaseLayer("api")
      : await model.getLayer("api");

    if (!apiLayer) {
      // No API layer found - all routes are in_graph_only
      return this.assembleReport(
        projectRoot,
        model,
        {
          matched: [],
          in_graph_only: routes.map((r) => ({
            id: r.id,
            http_method: r.http_method,
            http_path: r.http_path,
            source_file: r.source_file || "",
            source_symbol: r.source_symbol || "",
          })),
          in_model_only: [],
          ignored: [],
        },
        activeChangesetId,
        options,
        analyzerName,
        indexMeta
      );
    }

    // Step 2: Build dual-index
    const primaryIndex = new Map<string, IndexEntry>();
    const secondaryIndex = new Map<string, IndexEntry>();

    for (const element of apiLayer.elements.values()) {
      const firstLocation = element.source_reference?.locations?.[0];

      // Primary index: file:symbol
      if (firstLocation && firstLocation.file) {
        const symbol = firstLocation.symbol || "";
        const key = `${firstLocation.file}:${symbol}`;
        primaryIndex.set(key, {
          modelEntry: {
            id: element.id,
            source_file: firstLocation.file,
            source_symbol: symbol,
          },
          key,
        });
      }

      // Secondary index: http_method:http_path
      const attrs = element.attributes as any;
      if (attrs?.http_method && attrs?.http_path) {
        const key = `${attrs.http_method}:${attrs.http_path}`;
        secondaryIndex.set(key, {
          modelEntry: {
            id: element.id,
            http_method: attrs.http_method,
            http_path: attrs.http_path,
          },
          key,
        });
      }
    }

    // Warn if any graph routes have no source_symbol — they will be skipped by primary-index matching
    const emptySymbolCount = routes.filter((r) => !r.source_symbol).length;
    if (emptySymbolCount > 0) {
      console.warn(
        `\nWarning: ${emptySymbolCount}/${routes.length} graph route(s) have empty source_symbol.` +
        ` Primary-index matching by (source_file, source_symbol) will skip them.\n` +
        `  Likely cause: the code graph analyzer did not extract handler function names for this language.\n` +
        `  Secondary-index matching (http_method + http_path) requires those attributes on model operations.\n` +
        `  To fix: re-index after the analyzer is updated, or manually set http_method/http_path on operations.\n`
      );
    }

    // Step 3: Load ignore rules
    const ignoreFilePath =
      options.ignoreFilePath || path.join(projectRoot, ".dr-verify-ignore.yaml");
    const ignoreRules = await IgnoreFileLoader.load(ignoreFilePath);

    // Step 4: Compute buckets
    const matched: MatchedEntry[] = [];
    const inGraphOnly: GraphOnlyEntry[] = [];
    const ignored: IgnoredEntry[] = [];
    const matchedRouteIds = new Set<string>();
    const dotted = (element: { id: string; path?: string }) => element.path || element.id;
    const elementsById = new Map([...apiLayer.elements.values()].map((e) => [e.id, e]));
    const described = (id: string) => {
      const element = elementsById.get(id);
      return element ? { path: dotted(element), name: element.name } : {};
    };

    // Operations by `METHOD /path` with the parameters unnamed (`GET /owners/{}`), for a route the
    // code spells with other parameter names than the model's; and, per source file, by the route
    // their symbol names, for the routes an API description declares.
    const byMethodPath = new Map<string, string>();
    const bySourceRoute = new Map<string, string>();
    for (const element of apiLayer.elements.values()) {
      const attrs = element.attributes as any;
      const attrKey = methodPathKey(attrs?.http_method, attrs?.http_path);
      if (attrKey && !byMethodPath.has(attrKey)) byMethodPath.set(attrKey, element.id);
      for (const location of element.source_reference?.locations ?? []) {
        if (!location?.file) continue;
        const key = (location.symbol && routeKey(location.symbol)) || attrKey;
        if (key && !bySourceRoute.has(`${location.file}#${key}`)) bySourceRoute.set(`${location.file}#${key}`, element.id);
      }
    }
    // A route recorded as not an element (codebase_extract reject) is not in the code only.
    const rejected = (route: DiscoveredRoute): boolean => {
      if (!context.notElements?.size || !route.http_method || !route.http_path) return false;
      return context.notElements.has(decisionKey(route.source_file || null, `${route.http_method} ${route.http_path}`));
    };
    const REJECTED_REASON = "recorded as not an element (codebase_extract reject)";
    /** Files the analyzer reads served routes from, and the routes it reads, as `METHOD /path`. */
    const filesWithRoutes = new Set<string>();
    const servedKeys = new Set<string>();

    for (const route of routes) {
      let matchedElement: { id: string } | undefined;
      if (route.source_file) filesWithRoutes.add(route.source_file);
      const routeMethodPath = methodPathKey(route.http_method, route.http_path);
      if (routeMethodPath) servedKeys.add(routeMethodPath);

      // Try primary index match
      if (route.source_file && route.source_symbol) {
        const key = `${route.source_file}:${route.source_symbol}`;
        const primaryMatch = primaryIndex.get(key);
        if (primaryMatch) {
          matchedElement = primaryMatch.modelEntry;
        }
      }

      // Fallback to secondary index match
      if (!matchedElement && route.http_method && route.http_path) {
        const key = `${route.http_method}:${route.http_path}`;
        const secondaryMatch = secondaryIndex.get(key);
        if (secondaryMatch) {
          matchedElement = secondaryMatch.modelEntry;
        }
      }

      // The same method and path under other parameter names (`/owners/{id}` for `/owners/{ownerId}`).
      if (!matchedElement && routeMethodPath) {
        const id = byMethodPath.get(routeMethodPath);
        if (id) matchedElement = { id };
      }

      // Check if ignored
      const ignoreReason = IgnoreFileLoader.matches(
        {
          handler: route.handler,
          path: route.http_path,
          element_id: route.id,
        },
        "route",
        ignoreRules
      );

      if (ignoreReason) {
        ignored.push({
          id: route.id,
          entry_type: "route",
          reason: ignoreReason,
        });
        // Update matchedRouteIds even when ignored to prevent false drift
        if (matchedElement) {
          matchedRouteIds.add(matchedElement.id);
        }
      } else if (matchedElement) {
        matched.push({
          id: matchedElement.id,
          type: "operation",
          source_file: route.source_file || "",
          source_symbol: route.source_symbol || "",
          ...described(matchedElement.id),
        });
        matchedRouteIds.add(matchedElement.id);
      } else if (rejected(route)) {
        ignored.push({ id: route.id, entry_type: "route", reason: REJECTED_REASON });
      } else {
        inGraphOnly.push({
          id: route.id,
          http_method: route.http_method,
          http_path: route.http_path,
          source_file: route.source_file || "",
          source_symbol: route.source_symbol || "",
        });
      }
    }

    // The routes an API description declares, against the operations sourced to that description.
    // An operation sourced to code is never matched here: a route that exists only in the
    // description must not make the code look as if it serves it.
    const declaredFiles = new Set<string>();
    for (const route of context.declaredRoutes ?? []) {
      const file = route.source_file;
      const key = methodPathKey(route.http_method, route.http_path);
      if (!file || !key) continue;
      declaredFiles.add(file);
      const symbol = `${route.http_method} ${route.http_path}`;
      const elementId = bySourceRoute.get(`${file}#${key}`);
      const ignoreReason = IgnoreFileLoader.matches({ handler: route.handler, path: route.http_path, element_id: route.id }, "route", ignoreRules);
      if (elementId) {
        if (matchedRouteIds.has(elementId)) continue;
        matchedRouteIds.add(elementId);
        if (ignoreReason) ignored.push({ id: route.id, entry_type: "route", reason: ignoreReason });
        else matched.push({ id: elementId, type: "operation", source_file: file, source_symbol: symbol, declared_in: file, ...described(elementId) });
      } else if (servedKeys.has(key) || byMethodPath.has(key)) {
        // Served by code here (reported from that side), or modelled as an operation sourced to
        // code: its own check says whether the code still has it.
        continue;
      } else if (ignoreReason) {
        ignored.push({ id: route.id, entry_type: "route", reason: ignoreReason });
      } else if (rejected(route)) {
        ignored.push({ id: route.id, entry_type: "route", reason: REJECTED_REASON });
      } else {
        inGraphOnly.push({ id: route.id, http_method: route.http_method, http_path: route.http_path, source_file: file, source_symbol: symbol, declared_in: file });
      }
    }

    // The model's operations no route matched: in the model only (drift), or not checked, with why.
    // Never neither: an operation left out of every list reads as "in step".
    interface Unmatched {
      id: string;
      path: string;
      name: string;
      file: string;
      symbol: string;
      /** For a code file: the literal part of its path to look for in the file's text. */
      literal: string | null;
      /** Why it is in the model only, once decided. */
      reason?: string;
    }
    const notChecked: NotCheckedElement[] = [];
    const drifted: Unmatched[] = [];
    const inCode: Unmatched[] = [];
    let elementsWithoutSourceRef = 0;
    let elementsWithNonIndexableSource = 0;

    for (const element of apiLayer.elements.values()) {
      if (matchedRouteIds.has(element.id)) {
        continue; // Already matched
      }

      const locations = (element.source_reference?.locations ?? []).filter((l) => l?.file);
      const firstLocation = locations[0];
      const attrs = element.attributes as any;
      const entry = (file: string, symbol: string): Unmatched => ({
        id: element.id,
        path: dotted(element),
        name: element.name,
        file,
        symbol,
        literal: pathLiteral(String(attrs?.http_path ?? routeKey(symbol)?.replace(/^[A-Z]+ /, "") ?? "")),
      });

      if (!firstLocation) {
        // No source reference: nothing ties it to a file, so it can't be found or shown gone.
        elementsWithoutSourceRef++;
        notChecked.push({ id: dotted(element), reason: NO_SOURCE_REASON, to_check: NO_SOURCE_TO_CHECK });
        continue;
      }

      // Sourced to an API description the analyzer read, which doesn't declare it (any more).
      const declared = locations.find((l) => declaredFiles.has(l.file));
      if (declared) {
        drifted.push({ ...entry(declared.file, declared.symbol || ""), reason: `${declared.file} doesn't declare it (any more)` });
        continue;
      }

      // CBM reads routes from source code and from the API descriptions it parses. A file of
      // another kind (a document, a config) gives it nothing to compare this operation with.
      if (!SOURCE_CODE_EXT_RE.test(firstLocation.file)) {
        elementsWithNonIndexableSource++;
        notChecked.push({
          id: dotted(element),
          reason: "sourced to a file that is neither source code nor an API description the analyzer read routes from",
          to_check:
            "source it to the code file that serves the route, or to an OpenAPI file inside the indexed tree (then run codebase_index again)",
        });
        continue;
      }

      inCode.push(entry(firstLocation.file, firstLocation.symbol || ""));
    }

    if (elementsWithoutSourceRef > 0) {
      console.warn(
        `\nWarning: ${elementsWithoutSourceRef} API model element(s) were not checked` +
        ` — they have no source_reference with a file location.\n` +
        `  The check needs a linked source file to compare against the code graph.\n` +
        `  Fix: set each element's source file and symbol (dr update <element-id> --source-file <relative-path> --source-symbol <symbol>).\n`
      );
    }

    if (elementsWithNonIndexableSource > 0) {
      console.warn(
        `\nWarning: ${elementsWithNonIndexableSource} API model element(s) were not checked` +
        ` — their source files are neither source code nor an API description the analyzer read routes from.\n` +
        `  Point source_reference to the source-code file that serves the route (.ts, .js, .py, etc.),\n` +
        `  or to an OpenAPI file inside the indexed tree.\n`
      );
    }

    // Operations sourced to code. A file that is gone is drift. A file the analyzer didn't index
    // is a parse gap. In a file the analyzer reads routes from, a route it doesn't find is drift.
    // In a file it reads no route from (a framework it can't read), the operation can't be checked
    // either way, unless the file no longer names its path or symbol at all.
    const exists = await Promise.all(
      inCode.map((e) =>
        access(path.join(model.codebaseRoot, e.file))
          .then(() => true)
          // Only ENOENT means the file is gone; a permission error is not evidence of that.
          .catch((err: NodeJS.ErrnoException) => err.code !== "ENOENT")
      )
    );
    const present = inCode.filter((_, i) => exists[i]);
    for (const e of inCode.filter((_, i) => !exists[i])) drifted.push({ ...e, reason: "its source file is gone" });
    const gaps = notIndexed && present.length > 0 ? await notIndexed([...new Set(present.map((e) => e.file))]) : new Map<string, string>();
    const notIndexedEntries: NotIndexedEntry[] = [];
    const texts = new Map<string, string | null>();
    const textOf = async (file: string): Promise<string | null> => {
      if (!texts.has(file)) texts.set(file, await readFile(path.join(model.codebaseRoot, file), "utf-8").catch(() => null));
      return texts.get(file) ?? null;
    };
    for (const e of present) {
      const gap = gaps.get(e.file);
      if (gap) {
        notIndexedEntries.push({ id: e.id, type: "operation", source_file: e.file, source_symbol: e.symbol, reason: gap, path: e.path, name: e.name });
      } else if (filesWithRoutes.has(e.file)) {
        drifted.push({ ...e, reason: "the analyzer reads routes from its source file and none is this one" });
      } else {
        const text = await textOf(e.file);
        const symbolIsRoute = !!routeKey(e.symbol);
        const named = text === null || (e.literal ? text.includes(e.literal) : false) || (!symbolIsRoute && !!e.symbol && namesSymbol(text, e.symbol));
        const nothingToLookFor = !e.literal && (symbolIsRoute || !e.symbol);
        if (named || nothingToLookFor) {
          notChecked.push({
            id: e.path,
            reason: "sourced to a code file the analyzer reads no HTTP route from (a framework or a routing style it can't read)",
            to_check: "nothing to change in the model: check these routes in the code by hand, or source them to an OpenAPI file that declares them",
          });
        } else {
          drifted.push({ ...e, reason: "the analyzer reads no route from its source file, and the file doesn't name its path or symbol any more" });
        }
      }
    }

    // What an ignore rule covers is not drift.
    const inModelOnly: ModelOnlyEntry[] = [];
    for (const e of drifted) {
      // Use element.path (semantic path) instead of elem.id (UUID)
      const ignoreReason = IgnoreFileLoader.matches({ element_id: e.path }, "element", ignoreRules);
      if (ignoreReason) {
        ignored.push({ id: e.id, entry_type: "element", reason: ignoreReason });
      } else {
        inModelOnly.push({ id: e.id, type: "operation", source_file: e.file, source_symbol: e.symbol, reason: e.reason, path: e.path, name: e.name });
      }
    }

    // Step 5: Assemble report
    const notCheckedGroups = groupNotChecked(notChecked);
    const buckets: VerifyBuckets = {
      matched,
      in_graph_only: inGraphOnly,
      in_model_only: inModelOnly,
      ignored,
      ...(notIndexed ? { not_indexed: notIndexedEntries } : {}),
      ...(notCheckedGroups.length > 0 ? { not_checked: notCheckedGroups } : {}),
    };

    return this.assembleReport(
      projectRoot,
      model,
      buckets,
      activeChangesetId,
      options,
      analyzerName,
      indexMeta,
      { withoutSourceRef: elementsWithoutSourceRef, notChecked: notChecked.length - elementsWithoutSourceRef }
    );
  }

  /**
   * Assemble the final verification report
   *
   * @private
   */
  private assembleReport(
    projectRoot: string,
    model: Model,
    buckets: VerifyBuckets,
    activeChangesetId: string | null,
    options: VerifyOptions,
    analyzerName: string = "codebase-memory-mcp",
    indexMeta?: IndexMeta,
    uncompared: { withoutSourceRef: number; notChecked: number } = { withoutSourceRef: 0, notChecked: 0 }
  ): VerifyReport {
    const matchedElements = buckets.matched.length;
    const inModelOnly = buckets.in_model_only.length;
    const ignoredElements = buckets.ignored.filter((e) => e.entry_type === "element").length;
    const summary: VerifySummary = {
      matched_count: matchedElements,
      gap_count: buckets.in_graph_only.length,
      drift_count: inModelOnly,
      ignored_count: buckets.ignored.length,
      total_graph_entries: matchedElements + buckets.in_graph_only.length + buckets.ignored.filter((e) => e.entry_type === "route").length,
      // Count all API layer elements: those that participated in matching plus those that could
      // not be compared (no source reference, or sourced to a file the analyzer reads no route from).
      total_model_entries:
        matchedElements + inModelOnly + ignoredElements + uncompared.withoutSourceRef + uncompared.notChecked + (buckets.not_indexed?.length ?? 0),
      // Only the elements with no source reference at all: one sourced to a file the check can't
      // read has its source data, and is counted under elements_not_checked.
      elements_without_source_ref: uncompared.withoutSourceRef,
      elements_not_checked: uncompared.notChecked,
      ...(buckets.not_indexed ? { not_indexed_count: buckets.not_indexed.length } : {}),
    };

    // Determine changeset context
    const changesetAware = options.changesetAware ?? true;
    const hasActiveChangeset = changesetAware && activeChangesetId !== null;

    // Use analyzer index timestamp if provided, otherwise fall back to model manifest modified time
    const analyzerIndexedAt = indexMeta?.timestamp || model.manifest.modified;

    // Construct changeset context as discriminated union
    const changeset_context: VerifyChangesetContext = hasActiveChangeset
      ? {
          active_changeset: activeChangesetId,
          verified_against: "changeset_view",
        }
      : {
          active_changeset: null,
          verified_against: "base_model",
        };

    const hints: string[] = [];
    if (buckets.in_graph_only.length > 0) {
      hints.push(IN_CODE_ONLY_HINT);
    }

    return {
      generated_at: new Date().toISOString(),
      project_root: projectRoot,
      analyzer: analyzerName,
      analyzer_indexed_at: analyzerIndexedAt,
      changeset_context,
      // The layers asked for that have a check (api by default); one without a check isn't verified.
      layers_verified: options.layers && options.layers.length > 0 ? options.layers.filter((l) => VERIFIABLE_LAYERS.includes(l)) : ["api"],
      buckets,
      summary,
      ...(hints.length > 0 ? { hints } : {}),
    };
  }
}

/**
 * The API layer's part of a report in the per-layer shape (VerifyReport.layers), from its
 * top-level buckets: operations matched, routes in the code only, operations in the model only,
 * operations whose file the analyzer didn't index, and those it could not check, with the layer's
 * status. Elements are named by their dotted id when the model gives one.
 */
export function apiLayerReport(report: VerifyReport): LayerVerifyReport {
  const { buckets, summary } = report;
  const op = (e: { id: string; source_file: string; source_symbol: string; path?: string; name?: string; reason?: string }) => ({
    id: e.path ?? e.id,
    type: "api.operation",
    name: e.name ?? e.path ?? e.id,
    files: e.source_file ? [e.source_file] : [],
    ...(e.source_symbol ? { symbol: e.source_symbol } : {}),
    ...(e.reason ? { reason: e.reason } : {}),
  });
  const notChecked = buckets.not_checked ?? [];
  const notCheckedCount = notChecked.reduce((n, g) => n + g.count, 0);
  const ignoredElements = buckets.ignored.filter((e) => e.entry_type === "element").length;
  const status = layerStatus(
    {
      matched: new Set(buckets.matched.map((e) => e.id)).size,
      inCodeOnly: buckets.in_graph_only.length,
      inModelOnly: buckets.in_model_only.length,
      notIndexed: buckets.not_indexed?.length ?? 0,
      notChecked: notCheckedCount,
      ignoredInModel: ignoredElements,
    },
    API_NOUNS
  );
  // A match against an API description says the description declares the route, nothing more.
  const declaredIn = [...new Set(buckets.matched.map((e) => e.declared_in).filter((f): f is string => !!f))];
  if (declaredIn.length > 0) {
    const declared = buckets.matched.filter((e) => e.declared_in).length;
    const inStepWithCode = "in step with the code.";
    if (declared === buckets.matched.length && status.status_text.includes(inStepWithCode)) {
      // Nothing was compared with code that serves a route: say what it is in step with.
      status.status_text = status.status_text.replace(
        inStepWithCode,
        `in step with the API description (${declaredIn.join(", ")}), which declares each of them. That does not show that code here serves them.`
      );
    } else {
      status.status_text +=
        ` ${declared} of the matched operations were compared with the routes an API description declares (${declaredIn.join(", ")}): ` +
        "it declares them, which does not show that code here serves them.";
    }
  }
  return {
    layer: "api",
    ...status,
    ...(notChecked.length > 0 ? { not_checked: notChecked } : {}),
    checks:
      "HTTP routes the code serves (CBM Route nodes with a file or handler) against the model's API operations; and the routes an " +
      "OpenAPI file declares against the operations sourced to that file (a match there says the description declares it, not that code serves it)",
    buckets: {
      matched: buckets.matched.map(op),
      in_graph_only: buckets.in_graph_only.map((g) => ({ ...op(g), name: [g.http_method, g.http_path].filter(Boolean).join(" ") || g.id })),
      in_model_only: buckets.in_model_only.map(op),
      not_indexed: (buckets.not_indexed ?? []).map(op),
    },
    summary: {
      matched_count: summary.matched_count,
      gap_count: summary.gap_count,
      drift_count: summary.drift_count,
      not_indexed_count: summary.not_indexed_count ?? 0,
      elements_without_source_ref: summary.elements_without_source_ref,
      elements_not_checked: summary.elements_not_checked ?? 0,
    },
  };
}
