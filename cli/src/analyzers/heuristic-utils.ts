/**
 * Utilities for heuristic evaluation and service/datastore detection
 */

import { minimatch } from "minimatch";
import type { AnalyzerHeuristic } from "./types.js";

/**
 * Get the list of known heuristic names
 * @returns Array of heuristic names that are implemented
 */
export function getKnownHeuristicNames(): string[] {
  return [
    "min_fan_in",
    "naming_patterns",
    "is_entry_point",
    "directory_match",
    "class_is_service",
    "service_class_naming",
    "handles_route",
  ];
}

/**
 * Evaluate whether a heuristic is met for a given node
 *
 * @param heuristic The heuristic to evaluate
 * @param node The node properties to evaluate against
 * @param sourceFile The source file path (for directory_match heuristics)
 * @returns True if the heuristic is met, false otherwise
 */
export function evaluateHeuristic(
  heuristic: AnalyzerHeuristic,
  node: Record<string, unknown>,
  sourceFile: string = ""
): boolean {
  switch (heuristic.name) {
    case "min_fan_in": {
      const threshold = heuristic.parameters?.threshold ?? 5;
      const fanIn = typeof node.fan_in === "number" ? node.fan_in : 0;
      return fanIn >= threshold;
    }

    case "naming_patterns": {
      const suffixes = heuristic.parameters?.service_suffixes ?? [];
      const name = String(node.name ?? "").toLowerCase();
      return suffixes.some((suffix) => name.endsWith(suffix.toLowerCase()));
    }

    case "is_entry_point": {
      const patterns = heuristic.parameters?.entry_point_patterns ?? [];
      const name = String(node.name ?? "").toLowerCase();
      return patterns.some((pattern) => name.includes(pattern.toLowerCase()));
    }

    case "directory_match": {
      const patterns = heuristic.parameters?.patterns ?? [];
      return patterns.some((pattern) => matchPattern(sourceFile, pattern));
    }

    case "class_is_service": {
      const hasInterfaceImpl = node.implements_interface === true;
      const hasDependencyInjection = node.dependency_injection === true;
      const publicMethodsCount = Number(node.public_methods_count ?? 0);
      const threshold = heuristic.parameters?.threshold ?? 3;
      return (
        hasInterfaceImpl ||
        hasDependencyInjection ||
        publicMethodsCount >= threshold
      );
    }

    case "service_class_naming": {
      const prefixes = heuristic.parameters?.service_method_prefixes ?? [];
      const name = String(node.name ?? "").toLowerCase();
      return prefixes.some((prefix) => name.startsWith(prefix.toLowerCase()));
    }

    case "handles_route": {
      return node.has_route_handler === true || node.is_decorated === true;
    }

    default:
      return false;
  }
}

/**
 * Cap confidence at "medium" for service candidates
 */
export function capConfidence(
  confidence: "high" | "medium" | "low"
): "medium" | "low" {
  if (confidence === "high") {
    return "medium";
  }
  return confidence;
}

/**
 * Match a file path against a glob pattern
 *
 * Uses minimatch for consistent glob pattern matching semantics.
 * Supports standard glob patterns like:
 * - *.ext - match files with extension
 * - src/ - match anything under src directory
 * - tests directories at any depth
 *
 * @param filePath The file path to match
 * @param pattern The glob pattern
 * @returns True if the pattern matches, false otherwise
 */
export function matchPattern(filePath: string, pattern: string): boolean {
  return minimatch(filePath, pattern);
}
