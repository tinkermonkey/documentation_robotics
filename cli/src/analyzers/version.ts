/**
 * CLI Version - imported from package.json
 *
 * Used by analyzers for MCP client initialization.
 * This ensures the version is always in sync with package.json.
 */

// Version is read from package.json at runtime via dynamic import
let cliVersion: string | null = null;

/**
 * Get the CLI version from package.json
 * Cached after first read for performance
 */
export async function getCliVersion(): Promise<string> {
  if (cliVersion) {
    return cliVersion;
  }

  try {
    // Import package.json as a module
    const pkg = await import("../../package.json", { assert: { type: "json" } });
    cliVersion = pkg.default.version || "0.1.3";
    return cliVersion;
  } catch (error) {
    // Fallback to default if import fails
    cliVersion = "0.1.3";
    return cliVersion;
  }
}

/**
 * Synchronously get the CLI version (uses cached value or default)
 * Call getCliVersion() first to ensure the cache is populated
 */
export function getCliVersionSync(): string {
  return cliVersion || "0.1.3";
}
