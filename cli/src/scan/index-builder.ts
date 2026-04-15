/**
 * Scan Index Builder
 *
 * Builds and manages the scan index cache that provides repository orientation
 * without re-querying CodePrism. The index includes repository statistics,
 * detected patterns, and suggested analysis workflow.
 *
 * Index file: {workspace}/documentation-robotics/scan-index.json
 *
 * @example
 * ```typescript
 * const client = await createMcpClient(config);
 * await validateConnection(client);
 * const index = await buildScanIndex(client, process.cwd());
 * await saveScanIndex(index, process.cwd());
 *
 * // Later: check if index is fresh
 * const loaded = await loadScanIndex(process.cwd());
 * if (loaded && await isIndexFresh(loaded, process.cwd())) {
 *   console.log("Index is fresh, skipping re-indexing");
 * }
 * ```
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { MCPClient } from "./mcp-client.js";
import { getErrorMessage, CLIError, ErrorCategory } from "../utils/errors.js";

/**
 * Individual detected pattern with name and confidence score
 */
const DetectedPatternSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1),
});

/**
 * Repository information extracted from CodePrism
 */
const RepositoryInfoSchema = z.object({
  total_files: z.number().int().nonnegative(),
  languages: z.array(z.string()),
  primary_language: z.string().optional(),
  frameworks: z.array(z.string()),
  file_breakdown: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * Detected patterns organized by category
 */
const DetectedPatternsSchema = z.object({
  architectural: z.array(DetectedPatternSchema),
  data_access: z.array(DetectedPatternSchema),
  security: z.array(DetectedPatternSchema),
  api: z.array(DetectedPatternSchema),
});

/**
 * Suggested workflow with recommended tools and rationale
 */
const SuggestedWorkflowSchema = z.object({
  recommended_tools: z.array(z.string()),
  rationale: z.string(),
});

/**
 * Complete scan index schema
 */
export const ScanIndexSchema = z.object({
  indexed_at: z.string().datetime(),
  workspace: z.string(),
  repository: RepositoryInfoSchema,
  detected_patterns: DetectedPatternsSchema,
  suggested_workflow: SuggestedWorkflowSchema,
});

export type ScanIndex = z.infer<typeof ScanIndexSchema>;

/**
 * Get the scan index file path for a workspace
 *
 * @param workspace - Workspace root path
 * @returns Path to scan-index.json file
 */
function getIndexPath(workspace: string): string {
  return join(workspace, "documentation-robotics", "scan-index.json");
}

/**
 * Parse JSON safely with error handling
 *
 * @param jsonText - JSON text to parse
 * @returns Parsed object or null if parsing fails
 */
function safeParseJson(jsonText: string): Record<string, unknown> | null {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    return null;
  }
}

/**
 * Call a CodePrism tool and extract text result
 *
 * @param client - MCP client connected to CodePrism
 * @param toolName - Name of the tool to call
 * @param toolArgs - Arguments to pass to the tool
 * @returns Parsed JSON result or null if tool failed
 * @throws CLIError if tool returns error or connection fails
 */
async function callCodePrismTool(
  client: MCPClient,
  toolName: string,
  toolArgs: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> {
  try {
    const results = await client.callTool(toolName, toolArgs);

    if (!results || results.length === 0) {
      return null;
    }

    // Find first text result
    for (const result of results) {
      if (result.type === "text" && result.text) {
        const parsed = safeParseJson(result.text);
        if (parsed) {
          return parsed;
        }
      } else if (result.type === "error" && result.text) {
        throw new CLIError(
          `CodePrism tool failed: ${toolName}`,
          ErrorCategory.SYSTEM,
          [result.text]
        );
      }
    }

    return null;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }
    throw new CLIError(
      `Failed to call CodePrism tool: ${toolName}`,
      ErrorCategory.SYSTEM,
      [getErrorMessage(error)]
    );
  }
}

/**
 * Extract repository information from tool results
 * Handles both full results and partial fallbacks
 */
function extractRepositoryInfo(
  repoStatsResult: Record<string, unknown>
): z.infer<typeof RepositoryInfoSchema> {
  const total_files = typeof repoStatsResult.total_files === "number"
    ? repoStatsResult.total_files
    : 0;

  const languages = Array.isArray(repoStatsResult.languages)
    ? repoStatsResult.languages.map(String)
    : [];

  const primary_language =
    typeof repoStatsResult.primary_language === "string"
      ? repoStatsResult.primary_language
      : undefined;

  const frameworks = Array.isArray(repoStatsResult.frameworks)
    ? repoStatsResult.frameworks.map(String)
    : [];

  const file_breakdown: Record<string, number> = {};
  if (repoStatsResult.file_breakdown && typeof repoStatsResult.file_breakdown === "object") {
    for (const [key, value] of Object.entries(repoStatsResult.file_breakdown)) {
      if (typeof value === "number") {
        file_breakdown[key] = value;
      }
    }
  }

  return {
    total_files,
    languages,
    primary_language,
    frameworks,
    file_breakdown,
  };
}

/**
 * Extract detected patterns from tool results
 * Creates empty arrays for missing categories
 */
function extractDetectedPatterns(
  detectPatternsResult: Record<string, unknown>
): z.infer<typeof DetectedPatternsSchema> {
  const extractCategory = (
    data: unknown
  ): z.infer<typeof DetectedPatternSchema>[] => {
    if (!Array.isArray(data)) return [];
    return data
      .filter((item) => {
        return (
          item &&
          typeof item === "object" &&
          typeof (item as any).name === "string" &&
          typeof (item as any).confidence === "number"
        );
      })
      .map((item) => ({
        name: String((item as any).name),
        confidence: Math.min(1, Math.max(0, Number((item as any).confidence))),
      }));
  };

  return {
    architectural: extractCategory(detectPatternsResult.architectural),
    data_access: extractCategory(detectPatternsResult.data_access),
    security: extractCategory(detectPatternsResult.security),
    api: extractCategory(detectPatternsResult.api),
  };
}

/**
 * Extract suggested workflow from tool results
 */
function extractSuggestedWorkflow(
  suggestWorkflowResult: Record<string, unknown>
): z.infer<typeof SuggestedWorkflowSchema> {
  const recommended_tools = Array.isArray(
    suggestWorkflowResult.recommended_tools
  )
    ? suggestWorkflowResult.recommended_tools.map(String)
    : [];

  const rationale =
    typeof suggestWorkflowResult.rationale === "string"
      ? suggestWorkflowResult.rationale
      : "No rationale provided";

  return {
    recommended_tools,
    rationale,
  };
}

/**
 * Build a complete scan index by calling CodePrism orientation tools
 *
 * Calls three tools in sequence:
 * 1. repository_stats - Get repository overview
 * 2. detect_patterns - Identify architectural patterns
 * 3. suggest_analysis_workflow - Get recommended analysis approach
 *
 * @param client - Connected MCP client to CodePrism
 * @param workspace - Workspace root path for context
 * @returns Complete scan index ready for persistence
 * @throws CLIError if tools fail or return invalid data
 */
export async function buildScanIndex(
  client: MCPClient,
  workspace: string
): Promise<ScanIndex> {
  // Call repository_stats to get repository overview
  const repoStatsResult = await callCodePrismTool(client, "repository_stats");
  if (!repoStatsResult) {
    throw new CLIError(
      "repository_stats tool returned empty result",
      ErrorCategory.SYSTEM,
      [
        "CodePrism may not have completed indexing",
        "Try running: dr scan session status",
      ]
    );
  }

  // Call detect_patterns to identify architectural patterns
  const detectPatternsResult = await callCodePrismTool(
    client,
    "detect_patterns"
  );
  if (!detectPatternsResult) {
    throw new CLIError(
      "detect_patterns tool returned empty result",
      ErrorCategory.SYSTEM,
      ["CodePrism pattern detection may have failed"]
    );
  }

  // Call suggest_analysis_workflow to get recommended workflow
  const suggestWorkflowResult = await callCodePrismTool(
    client,
    "suggest_analysis_workflow"
  );
  if (!suggestWorkflowResult) {
    throw new CLIError(
      "suggest_analysis_workflow tool returned empty result",
      ErrorCategory.SYSTEM,
      ["CodePrism workflow suggestion may have failed"]
    );
  }

  // Build the scan index from tool results
  const index: ScanIndex = {
    indexed_at: new Date().toISOString(),
    workspace,
    repository: extractRepositoryInfo(repoStatsResult),
    detected_patterns: extractDetectedPatterns(detectPatternsResult),
    suggested_workflow: extractSuggestedWorkflow(suggestWorkflowResult),
  };

  // Validate against schema
  const validation = ScanIndexSchema.safeParse(index);
  if (!validation.success) {
    throw new CLIError(
      "Generated scan index failed schema validation",
      ErrorCategory.SYSTEM,
      [
        `Validation errors: ${validation.error.message}`,
        "This may indicate CodePrism returned unexpected data format",
      ]
    );
  }

  return validation.data;
}

/**
 * Load scan index from file
 *
 * @param workspace - Workspace root path
 * @returns Loaded and validated scan index, or null if file doesn't exist
 * @throws CLIError if file is corrupted or invalid
 */
export async function loadScanIndex(
  workspace: string
): Promise<ScanIndex | null> {
  const indexPath = getIndexPath(workspace);

  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    const content = await readFile(indexPath, "utf-8");
    const parsed = JSON.parse(content);
    const validation = ScanIndexSchema.safeParse(parsed);

    if (!validation.success) {
      throw new CLIError(
        `Corrupted or invalid scan index: ${indexPath}`,
        ErrorCategory.SYSTEM,
        [
          `Validation errors: ${validation.error.message}`,
          "You may need to regenerate the index with: dr scan index",
        ]
      );
    }

    return validation.data;
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }

    throw new CLIError(
      `Failed to read scan index: ${indexPath}`,
      ErrorCategory.SYSTEM,
      [getErrorMessage(error)]
    );
  }
}

/**
 * Save scan index to file
 *
 * @param index - Scan index to persist
 * @param workspace - Workspace root path
 * @param outputPath - Optional custom output path (overrides default)
 * @throws CLIError if write fails
 */
export async function saveScanIndex(
  index: ScanIndex,
  workspace: string,
  outputPath?: string
): Promise<void> {
  const indexPath = outputPath || getIndexPath(workspace);

  try {
    // Validate before writing
    const validation = ScanIndexSchema.safeParse(index);
    if (!validation.success) {
      throw new CLIError(
        "Invalid scan index structure",
        ErrorCategory.SYSTEM,
        [`Validation errors: ${validation.error.message}`]
      );
    }

    const content = JSON.stringify(validation.data, null, 2);
    await writeFile(indexPath, content, "utf-8");
  } catch (error) {
    if (error instanceof CLIError) {
      throw error;
    }

    throw new CLIError(
      `Failed to write scan index: ${indexPath}`,
      ErrorCategory.SYSTEM,
      [getErrorMessage(error)]
    );
  }
}

/**
 * Find the most recently modified file in the workspace
 *
 * Recursively walks the directory tree, skipping common build/dependency directories.
 * Returns the most recent mtime found.
 *
 * Excluded directories:
 * - Hidden directories (starting with .)
 * - node_modules, .git, .venv, __pycache__, dist, build, target
 * - venv, env, .idea, .vscode, .DS_Store
 *
 * @param workspace - Workspace root path
 * @returns Most recent file mtime, or null if no files found
 */
export async function findMostRecentlyModifiedFile(
  workspace: string
): Promise<Date | null> {
  const excludeDirs = new Set([
    "node_modules",
    ".git",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    "target",
    "venv",
    "env",
    ".idea",
    ".vscode",
    "documentation-robotics",  // Exclude DR's own files
  ]);

  let mostRecentTime = 0;

  async function walkDir(dirPath: string): Promise<void> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip excluded directories
        if (
          entry.isDirectory() &&
          (excludeDirs.has(entry.name) || entry.name.startsWith("."))
        ) {
          continue;
        }

        const fullPath = join(dirPath, entry.name);

        try {
          const statInfo = statSync(fullPath);
          if (statInfo.isDirectory()) {
            await walkDir(fullPath);
          } else if (statInfo.isFile()) {
            const mtime = statInfo.mtimeMs;
            if (mtime > mostRecentTime) {
              mostRecentTime = mtime;
            }
          }
        } catch (error) {
          // Skip files we can't stat (permissions, etc.)
          continue;
        }
      }
    } catch (error) {
      // Skip directories we can't read
      return;
    }
  }

  try {
    await walkDir(workspace);
    return mostRecentTime > 0 ? new Date(mostRecentTime) : null;
  } catch (error) {
    // If walk fails completely, return null (index won't be considered fresh)
    return null;
  }
}

/**
 * Check if a scan index is fresh relative to the workspace
 *
 * An index is considered fresh if its `indexed_at` timestamp is more recent than
 * the most recently modified source file in the workspace.
 *
 * @param index - Scan index to check
 * @param workspace - Workspace root path
 * @returns true if index is fresh, false if stale or no files found
 */
export async function isIndexFresh(
  index: ScanIndex,
  workspace: string
): Promise<boolean> {
  try {
    const indexedAt = new Date(index.indexed_at);
    const mostRecent = await findMostRecentlyModifiedFile(workspace);

    // If no files found in workspace, consider index fresh
    if (!mostRecent) {
      return true;
    }

    // Index is fresh if it's newer than the most recent file
    return indexedAt.getTime() >= mostRecent.getTime();
  } catch (error) {
    // If any error during freshness check, assume stale to be safe
    return false;
  }
}
