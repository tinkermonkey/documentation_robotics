/**
 * Default Read-Safe Permissions Module
 *
 * Defines the read-safe permission allowlist for AI agents (Claude Code and GitHub Copilot)
 * when launched in default (non-danger) mode. This module provides a centralized,
 * client-agnostic definition of permitted tools and operations that both integration
 * managers can consume identically, despite their different CLI permission models.
 *
 * Permission Model:
 * - Read-Safe (Default): Limited to read operations and CLI execution
 * - Unrestricted (--with-danger): Full tool access
 *
 * The read-safe allowlist covers exactly four capabilities:
 * 1. Running the `dr` CLI
 * 2. Reading the codebase
 * 3. Reading the `documentation-robotics/` folder (.dr/)
 * 4. Reading the `.dr/` folder
 */

/**
 * Represents a single tool permission with optional scoping
 */
export interface ToolPermission {
  /** Name of the tool (e.g., 'Bash', 'Read') */
  name: string;

  /** Human-readable description of what this permission allows */
  description: string;

  /** Optional directory/file path scope restriction (relative to project root) */
  scope?: string;

  /** Whether this tool allows write/modify operations (should be false for read-safe) */
  allowsWrite: boolean;
}

/**
 * Read-safe permission allowlist for default (non-danger) mode
 *
 * This is the core configuration that defines which tools are available
 * when launched without the --with-danger flag. Both Claude Code and
 * GitHub Copilot integrations consume this identically.
 */
export const DEFAULT_READ_SAFE_PERMISSIONS: ToolPermission[] = [
  {
    name: "Bash",
    description: "Execute the dr CLI tool for model queries and operations",
    allowsWrite: false,
  },
  {
    name: "Read",
    description: "Read files from the codebase",
    scope: ".",
    allowsWrite: false,
  },
  {
    name: "Read",
    description: "Read from the documentation-robotics model folder (.dr/)",
    scope: ".dr",
    allowsWrite: false,
  },
  {
    name: "Read",
    description: "Read from the dr configuration folder",
    scope: ".dr",
    allowsWrite: false,
  },
];

/**
 * Convert read-safe permissions to Claude Code CLI format
 *
 * Claude Code uses the --allowedTools flag with a comma-separated list of tool names.
 * This function formats the permission list as expected by Claude Code's --allowedTools parameter.
 *
 * @returns String formatted for Claude Code --allowedTools flag
 */
export function formatForClaudeCode(): string {
  // Extract unique tool names and format as comma-separated list
  const toolNames = Array.from(new Set(DEFAULT_READ_SAFE_PERMISSIONS.map((p) => p.name)));
  return toolNames.join(",");
}

/**
 * Check if a specific tool is in the read-safe allowlist
 *
 * @param toolName Name of the tool to check
 * @returns true if tool is in the allowlist, false otherwise
 */
export function isToolAllowed(toolName: string): boolean {
  return DEFAULT_READ_SAFE_PERMISSIONS.some((p) => p.name === toolName);
}

/**
 * Get all permissions for a specific tool
 *
 * @param toolName Name of the tool
 * @returns Array of ToolPermission objects for that tool
 */
export function getToolPermissions(toolName: string): ToolPermission[] {
  return DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.name === toolName);
}

/**
 * Validate that all permissions in the allowlist are read-safe
 *
 * Ensures no write/edit/delete operations are permitted.
 * This should be called during initialization to validate the configuration.
 *
 * @throws Error if any permission allows write operations
 */
export function validateReadSafeConstraints(): void {
  const unsafePermissions = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.allowsWrite);

  if (unsafePermissions.length > 0) {
    const unsafeNames = unsafePermissions.map((p) => p.name).join(", ");
    throw new Error(
      `Invalid permission configuration: read-safe mode must not include write permissions. ` +
        `Found write-enabled tools: ${unsafeNames}`
    );
  }
}
