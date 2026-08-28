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
 * 3. Reading the `documentation-robotics/` folder
 * 4. Reading the `.dr/` folder
 */

import { spawnSync } from "child_process";
import ansis from "ansis";

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
    scope: "dr *",
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
    description: "Read from the documentation-robotics model folder",
    scope: "documentation-robotics",
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
 * Claude Code uses the --allowedTools flag with scoped tool permissions.
 * This function formats the permission list as expected by Claude Code's --allowedTools parameter,
 * including scope constraints for each tool (e.g., "Bash(dr *),Read(.),Read(documentation-robotics)").
 *
 * @returns String formatted for Claude Code --allowedTools flag
 */
export function formatForClaudeCode(): string {
  // Format each permission as "ToolName" or "ToolName(scope)" with scope constraints
  const formatted = DEFAULT_READ_SAFE_PERMISSIONS.map((p) => {
    if (p.scope) {
      return `${p.name}(${p.scope})`;
    }
    return p.name;
  });
  return formatted.join(",");
}

/**
 * Convert read-safe permissions to GitHub Copilot CLI format
 *
 * GitHub Copilot CLI may support a --allowedTools flag (or equivalent) for granular permission control.
 * This function formats the permission list similarly to Claude Code for potential future Copilot versions
 * that support granular scoped permissions. If the installed Copilot version doesn't support this flag,
 * the caller should gracefully degrade (e.g., launch without the flag, with a warning).
 *
 * Format: "Bash(dr *),Read(.),Read(documentation-robotics),Read(.dr)"
 *
 * @returns String formatted for Copilot --allowedTools flag (if supported)
 */
export function formatForCopilot(): string {
  return formatForClaudeCode();
}

/**
 * Apply Copilot permissions to command arguments with graceful degradation
 *
 * Shared utility for both CopilotClient and VisualizationServer to probe
 * Copilot CLI capability and apply appropriate permission flags.
 * Handles both default mode (read-safe --allowedTools) and danger mode (--allow-all-tools).
 *
 * @param cmd The command array to modify (mutated in place)
 * @param variant Display name for error messages (e.g., "gh copilot" or "copilot")
 * @param copilotCommand The copilot CLI name ("copilot" or "gh")
 * @param withDanger Whether to use danger mode (--allow-all-tools)
 * @param onTelemetry Optional callback for telemetry logging
 */
export function applyCopilotPermissions(
  cmd: string[],
  variant: string,
  copilotCommand: string,
  withDanger: boolean,
  onTelemetry?: (attr: string, value: any) => void
): void {

  if (withDanger) {
    try {
      const helpResult = spawnSync(
        copilotCommand === "copilot" ? "copilot" : "gh",
        copilotCommand === "copilot" ? ["--help"] : ["copilot", "--help"],
        { stdio: "pipe", encoding: "utf-8", timeout: 1000 }
      );
      if (
        helpResult.stdout?.includes("--allow-all-tools") ||
        helpResult.stdout?.includes("allow-all-tools")
      ) {
        cmd.push("--allow-all-tools");
        onTelemetry?.("process.allowAllToolsSupported", true);
      } else {
        onTelemetry?.("process.allowAllToolsSupported", false);
        console.warn(
          ansis.yellow(`Note: --allow-all-tools flag not supported by your ${variant} version`)
        );
      }
    } catch {
      onTelemetry?.("process.allowAllToolsCheckFailed", true);
      console.warn(
        ansis.yellow(
          `WARNING: Could not verify --allow-all-tools support for ${variant}. ` +
            `Launching WITHOUT permission escalation. If you need full tool access, ` +
            `please ensure your ${variant} CLI is up-to-date.`
        )
      );
    }
  } else {
    try {
      const helpResult = spawnSync(
        copilotCommand === "copilot" ? "copilot" : "gh",
        copilotCommand === "copilot" ? ["--help"] : ["copilot", "--help"],
        { stdio: "pipe", encoding: "utf-8", timeout: 1000 }
      );

      const helpText = helpResult.stdout || "";
      const supportsAllowedTools =
        helpText.includes("--allowedTools") ||
        helpText.includes("allowedTools") ||
        helpText.includes("--allowed-tools") ||
        helpText.includes("allowed-tools");

      if (supportsAllowedTools) {
        const allowedToolsValue = formatForCopilot();
        cmd.push("--allowedTools", allowedToolsValue);
        onTelemetry?.("process.readSafePermissionsApplied", true);
        onTelemetry?.("process.allowedTools", allowedToolsValue);
      } else {
        onTelemetry?.("process.readSafePermissionsApplied", false);
        console.warn(
          ansis.yellow(
            `Note: Your ${variant} version doesn't support granular permissions. ` +
              `Consider upgrading @github/copilot for permission controls.`
          )
        );
      }
    } catch {
      onTelemetry?.("process.readSafePermissionCheckFailed", true);
      // Fail-closed: Apply permissions optimistically. If the CLI doesn't support
      // --allowedTools, the command will fail, preventing unrestricted access.
      const allowedToolsValue = formatForCopilot();
      cmd.push("--allowedTools", allowedToolsValue);
      console.warn(
        ansis.yellow(
          `WARNING: Could not verify read-safe permission support for ${variant}. ` +
            `Applying read-safe restrictions optimistically. If ${variant} doesn't support ` +
            `the flag, the launch will fail — please upgrade your ${variant} CLI for compatibility.`
        )
      );
    }
  }
}
