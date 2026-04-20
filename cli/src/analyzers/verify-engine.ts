/**
 * Verify Engine - computes verification reports for API endpoints
 *
 * Implements the core algorithm for comparing graph-discovered routes against
 * model-defined operations, supporting dual-index matching and changeset awareness.
 */

import * as path from "path";
import { access } from "fs/promises";
import { Model } from "../core/model.js";
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
} from "./types.js";
import { IgnoreFileLoader } from "./verify-ignore.js";

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
    indexMeta?: IndexMeta
  ): Promise<VerifyReport> {
    // Step 1: Resolve model view
    let model: Model;
    try {
      model = await Model.load(projectRoot);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // Provide helpful error message if model directory is missing or corrupted
      if (err.code === "ENOENT" || err.code === "ENOTDIR") {
        throw new Error(
          `Failed to load DR model at ${projectRoot}: Model directory not found or inaccessible. ` +
          `Please run 'dr init' to initialize the documentation robotics model.`
        );
      }
      throw new Error(
        `Failed to load DR model at ${projectRoot}: ${err.message}. ` +
        `Please check that the model directory exists and is accessible.`
      );
    }

    const activeChangesetId = model.getActiveChangesetId();

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
      const sourceRef = (element.attributes?.source_reference as any) || {};
      const locations = sourceRef.locations || [];
      const firstLocation = locations[0];

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

    // Step 3: Load ignore rules
    const ignoreFilePath =
      options.ignoreFilePath || path.join(projectRoot, ".dr-verify-ignore.yaml");
    const ignoreRules = await IgnoreFileLoader.load(ignoreFilePath);

    // Step 4: Compute buckets
    const matched: MatchedEntry[] = [];
    const inGraphOnly: GraphOnlyEntry[] = [];
    const ignored: IgnoredEntry[] = [];
    const matchedRouteIds = new Set<string>();

    for (const route of routes) {
      let matchedElement: { id: string } | undefined;

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
        });
        matchedRouteIds.add(matchedElement.id);
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

    // Compute in_model_only: model elements not matched in graph
    const inModelOnly: ModelOnlyEntry[] = [];

    // Batch file-existence checks
    const fileChecks: Promise<boolean>[] = [];
    const elementsToCheck: Array<{ id: string; file: string; symbol: string }> = [];
    let elementsWithoutSourceRef = 0;

    for (const element of apiLayer.elements.values()) {
      if (matchedRouteIds.has(element.id)) {
        continue; // Already matched
      }

      const sourceRef = (element.attributes?.source_reference as any) || {};
      const locations = sourceRef.locations || [];
      const firstLocation = locations[0];

      if (!firstLocation || !firstLocation.file) {
        // Skip elements with no source_reference file - they cannot drift since they have no code linkage.
        // This includes manually-created elements that are documentation-only.
        elementsWithoutSourceRef++;
        continue;
      }

      elementsToCheck.push({
        id: element.id,
        file: firstLocation.file,
        symbol: firstLocation.symbol || "",
      });

      const filePath = path.join(projectRoot, firstLocation.file);
      fileChecks.push(
        access(filePath)
          .then(() => true)
          .catch((err: NodeJS.ErrnoException) => {
            // Only treat ENOENT (file not found) as "file doesn't exist"
            // Other errors (EACCES, EMFILE, etc.) are treated as "file exists" to avoid false negatives
            if (err.code === "ENOENT") {
              return false;
            }
            // For permission errors and other issues, assume file exists to be conservative
            return true;
          })
      );
    }

    // Warn user if elements were excluded due to missing source references
    if (elementsWithoutSourceRef > 0) {
      console.warn(
        `Note: ${elementsWithoutSourceRef} model element(s) excluded from drift detection ` +
        `(no source reference data or file path); these elements cannot drift since they have no code linkage.`
      );
    }

    // Wait for all file checks. All promises have .catch() handlers that return booleans,
    // so they will never reject - Promise.all() is safe and simpler than allSettled.
    const fileExistsResults = await Promise.all(fileChecks);

    // Add to in_model_only only if file exists, then check against ignore rules
    for (let i = 0; i < elementsToCheck.length; i++) {
      const fileExists = fileExistsResults[i];

      if (fileExists) {
        const elem = elementsToCheck[i];

        // Check if element matches any ignore rule
        const ignoreReason = IgnoreFileLoader.matches(
          {
            element_id: elem.id,
          },
          "element",
          ignoreRules
        );

        if (ignoreReason) {
          ignored.push({
            id: elem.id,
            entry_type: "element",
            reason: ignoreReason,
          });
        } else {
          inModelOnly.push({
            id: elem.id,
            type: "operation",
            source_file: elem.file,
            source_symbol: elem.symbol,
          });
        }
      }
    }

    // Step 5: Assemble report
    const buckets: VerifyBuckets = {
      matched,
      in_graph_only: inGraphOnly,
      in_model_only: inModelOnly,
      ignored,
    };

    return this.assembleReport(
      projectRoot,
      model,
      buckets,
      activeChangesetId,
      options,
      analyzerName,
      indexMeta
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
    indexMeta?: IndexMeta
  ): VerifyReport {
    const summary: VerifySummary = {
      matched_count: buckets.matched.length,
      gap_count: buckets.in_graph_only.length,
      drift_count: buckets.in_model_only.length,
      ignored_count: buckets.ignored.length,
      total_graph_entries: buckets.matched.length + buckets.in_graph_only.length + buckets.ignored.filter((e) => e.entry_type === "route").length,
      total_model_entries:
        buckets.matched.length +
        buckets.in_model_only.length +
        buckets.ignored.filter((e) => e.entry_type === "element").length,
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

    return {
      generated_at: new Date().toISOString(),
      project_root: projectRoot,
      analyzer: analyzerName,
      analyzer_indexed_at: analyzerIndexedAt,
      changeset_context,
      layers_verified: ["api"],
      buckets,
      summary,
    };
  }
}
