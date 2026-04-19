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
 * Primary or secondary index entry (holds model element data, not discovered route data)
 */
interface IndexEntry {
  modelEntry: DiscoveredRoute;
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
    options: VerifyOptions
  ): Promise<VerifyReport> {
    // Step 1: Resolve model view
    const model = await Model.load(projectRoot);
    const activeChangesetId = model.getActiveChangesetId();
    const apiLayer = await model.getLayer("api");

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
        options
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
            source_file: firstLocation?.file,
            source_symbol: firstLocation?.symbol,
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
          matchedElement = primaryMatch.modelEntry as any;
        }
      }

      // Fallback to secondary index match
      if (!matchedElement && route.http_method && route.http_path) {
        const key = `${route.http_method}:${route.http_path}`;
        const secondaryMatch = secondaryIndex.get(key);
        if (secondaryMatch) {
          matchedElement = secondaryMatch.modelEntry as any;
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

    for (const element of apiLayer.elements.values()) {
      if (matchedRouteIds.has(element.id)) {
        continue; // Already matched
      }

      const sourceRef = (element.attributes?.source_reference as any) || {};
      const locations = sourceRef.locations || [];
      const firstLocation = locations[0];

      if (!firstLocation || !firstLocation.file) {
        // Skip elements with no source_reference file
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
          .catch(() => false)
      );
    }

    // Wait for all file checks
    const fileExistsResults = await Promise.all(fileChecks);

    // Add to in_model_only only if file exists, then check against ignore rules
    for (let i = 0; i < elementsToCheck.length; i++) {
      if (fileExistsResults[i]) {
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
      options
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
    options: VerifyOptions
  ): VerifyReport {
    const summary: VerifySummary = {
      matched_count: buckets.matched.length,
      in_graph_only_count: buckets.in_graph_only.length,
      in_model_only_count: buckets.in_model_only.length,
      ignored_count: buckets.ignored.length,
      total_routes_analyzed: buckets.matched.length + buckets.in_graph_only.length + buckets.ignored.length,
      total_elements_analyzed:
        buckets.matched.length +
        buckets.in_model_only.length +
        buckets.ignored.filter((e) => e.entry_type === "element").length,
    };

    // Determine changeset context
    const changesetAware = options.changesetAware ?? true;
    const hasActiveChangeset = changesetAware && activeChangesetId !== null;

    return {
      generated_at: new Date().toISOString(),
      project_root: projectRoot,
      analyzer: "codebase-memory-mcp",
      analyzer_indexed_at: model.manifest.modified,
      changeset_context: {
        active_changeset: hasActiveChangeset ? activeChangesetId : null,
        verified_against: hasActiveChangeset ? "changeset_view" : "base_model",
      },
      layers_verified: ["api"],
      buckets,
      summary,
    };
  }
}
