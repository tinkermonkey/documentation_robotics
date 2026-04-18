/**
 * CLI Version - used by analyzers for MCP client initialization
 *
 * Re-exports the CLI version from spec-version.ts, which is the single source of truth.
 * This ensures consistency across all components (CLI commands, integrations, analyzers).
 */

import { getCliVersion as getCliVersionImpl } from "../utils/spec-version.js";

/**
 * Get the CLI version for analyzer initialization
 * Wrapped as async for compatibility with existing analyzer code,
 * but delegates to the synchronous source-of-truth in spec-version.ts
 */
export async function getCliVersion(): Promise<string> {
  return getCliVersionImpl();
}
