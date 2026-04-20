/**
 * Core discover logic - separated from CLI I/O for testability
 *
 * This module contains the business logic for analyzer discovery,
 * separated from CLI output and user interaction.
 */

import { AnalyzerRegistry } from "../analyzers/registry.js";
import { MappingLoader } from "../analyzers/mapping-loader.js";
import type { DiscoveryResult, AvailableAnalyzer } from "../analyzers/types.js";

export interface DiscoverOptions {
  json?: boolean;
  reselect?: boolean;
  isTTY?: boolean;
}

export interface DiscoverAnalyzerOption {
  backend: any;
  detection: any;
  metadata: any;
}

/**
 * Core discover logic - discovers installed analyzers and determines what action to take
 *
 * Returns:
 * - discoveryResult: The JSON-serializable discovery result
 * - installed: Array of installed analyzers
 * - analyzerOptions: All discovered analyzers (installed and uninstalled)
 */
export async function performDiscover(
  registry: AnalyzerRegistry,
  options: DiscoverOptions = {}
): Promise<{
  discoveryResult: DiscoveryResult;
  installed: DiscoverAnalyzerOption[];
  analyzerOptions: DiscoverAnalyzerOption[];
  selectedAnalyzer?: string;
  shouldWriteSession: boolean;
}> {
  const analyzerNames = await registry.getAnalyzerNames();

  if (analyzerNames.length === 0) {
    throw new Error("No analyzers registered in the specification");
  }

  // Get metadata for each analyzer
  const analyzerOptions: DiscoverAnalyzerOption[] = [];
  for (const name of analyzerNames) {
    try {
      const backend = await registry.getAnalyzer(name);
      if (!backend) continue;

      const detection = await backend.detect();
      const mapper = await MappingLoader.load(name);
      const metadata = mapper.getAnalyzerMetadata();

      analyzerOptions.push({
        backend,
        detection,
        metadata,
      });
    } catch (error) {
      // Log error but continue discovering other analyzers
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to discover analyzer "${name}": ${errorMsg}`);
    }
  }

  // Find installed analyzers
  const installed = analyzerOptions.filter((a) => a.detection.installed);

  // Build the discovery result (used for JSON output)
  const found: AvailableAnalyzer[] = analyzerOptions.map((a) => ({
    name: a.backend.name,
    display_name: a.backend.displayName,
    description: a.metadata?.description || "",
    homepage: a.metadata?.homepage || "",
    installed: a.detection.installed,
  }));

  const discoveryResult: DiscoveryResult = {
    found,
    installed_count: installed.length,
  };

  let selectedAnalyzer: string | undefined;
  let shouldWriteSession = false;

  // Determine session and selection behavior
  if (options.json) {
    // JSON mode: auto-select in non-TTY only if analyzers are installed
    if (!options.isTTY && installed.length > 0) {
      selectedAnalyzer = installed[0].backend.name;
      shouldWriteSession = true;
      discoveryResult.selected = selectedAnalyzer;
    }
    // TTY mode or no installed analyzers: don't set selected field
  } else {
    // Text mode: in non-TTY, auto-select only if analyzers are installed
    if (!options.isTTY && installed.length > 0) {
      selectedAnalyzer = installed[0].backend.name;
      shouldWriteSession = true;
    } else if (installed.length > 0 && options.isTTY) {
      // TTY mode with installed analyzers: will prompt, session will be written after selection
      shouldWriteSession = false; // CLI handler will write after prompt
    }
    // If no analyzers installed: don't select or write session
  }

  return {
    discoveryResult,
    installed,
    analyzerOptions,
    selectedAnalyzer,
    shouldWriteSession,
  };
}
