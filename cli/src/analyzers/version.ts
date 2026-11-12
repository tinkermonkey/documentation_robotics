/**
 * CLI Version - used by analyzers for MCP client initialization
 *
 * Re-exports the CLI version from spec-version.ts, which is the single source of truth.
 * This ensures consistency across all components (CLI commands, integrations, analyzers).
 */

import { spawnSync } from "node:child_process";
import { getCliVersion as getCliVersionImpl } from "../utils/spec-version.js";

/**
 * Get the CLI version for analyzer initialization
 * Wrapped as async for compatibility with existing analyzer code,
 * but delegates to the synchronous source-of-truth in spec-version.ts
 */
export async function getCliVersion(): Promise<string> {
  return getCliVersionImpl();
}

/** The first `x.y.z[-pre]` version in a string (`codebase-memory-mcp 0.12.1` → `0.12.1`). */
export function parseVersion(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const match = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(text);
  return match ? match[1] : null;
}

/** What `<binary> --version` prints as a version, or null when it doesn't run or print one. */
export function binaryVersion(binary: string): string | null {
  try {
    const result = spawnSync(binary, ["--version"], { stdio: "pipe", encoding: "utf-8", timeout: 5000 });
    if (result.status !== 0) return null;
    return parseVersion(result.stdout) ?? parseVersion(result.stderr);
  } catch {
    return null;
  }
}

/**
 * Whether the analyzer installed now is not the one that built an index. Unknown on either side
 * (an index from before DR recorded the version, or a binary that reports none) is not a change.
 */
export function analyzerChanged(meta: { analyzer_version?: string }, installed: { version?: string } | string | null | undefined): boolean {
  const now = typeof installed === "string" ? installed : installed?.version;
  return !!meta.analyzer_version && !!now && meta.analyzer_version !== now;
}
