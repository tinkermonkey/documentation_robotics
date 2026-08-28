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
 *
 * IMPORTANT: This array is deeply immutable via Object.freeze() and validated at module load time.
 * Mutating or adding entries after module initialization will not re-validate constraints.
 */
const PERMISSIONS_DEFINITION: ToolPermission[] = [
  {
    name: "Bash",
    description: "Execute the dr CLI tool for read-safe model queries",
    scope: "dr query|dr show|dr list|dr search|dr export|dr validate|dr info|dr stats|dr report|dr audit|dr chat|dr version|dr conformance",
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

export const DEFAULT_READ_SAFE_PERMISSIONS: readonly ToolPermission[] = Object.freeze(
  PERMISSIONS_DEFINITION.map((p) => Object.freeze({ ...p }))
);

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
 * Validate read-safe permission constraints
 *
 * Called during module initialization to verify the permission allowlist maintains
 * its safety invariants: all permissions are read-only, required tools are present,
 * and no dangerous tools are included.
 *
 * Throws an error if constraints are violated, preventing runtime with an invalid configuration.
 *
 * @throws {Error} If any constraint is violated
 */
export function validateReadSafeConstraints(): void {
  // Constraint 1: Non-empty allowlist
  if (!Array.isArray(DEFAULT_READ_SAFE_PERMISSIONS) || DEFAULT_READ_SAFE_PERMISSIONS.length === 0) {
    throw new Error(
      "DEFAULT_READ_SAFE_PERMISSIONS must be a non-empty array"
    );
  }

  // Constraint 2: All permissions must have required fields with correct types
  for (let i = 0; i < DEFAULT_READ_SAFE_PERMISSIONS.length; i++) {
    const perm = DEFAULT_READ_SAFE_PERMISSIONS[i];

    if (typeof perm.name !== "string" || perm.name.length === 0) {
      throw new Error(
        `Permission[${i}].name must be a non-empty string, got: ${typeof perm.name}`
      );
    }

    if (typeof perm.description !== "string" || perm.description.length === 0) {
      throw new Error(
        `Permission[${i}].description must be a non-empty string, got: ${typeof perm.description}`
      );
    }

    if (typeof perm.allowsWrite !== "boolean") {
      throw new Error(
        `Permission[${i}].allowsWrite must be a boolean, got: ${typeof perm.allowsWrite}`
      );
    }
  }

  // Constraint 3: No permission should allow write operations (read-safe invariant)
  const writePerms = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.allowsWrite);
  if (writePerms.length > 0) {
    throw new Error(
      `Read-safe permissions must not allow write operations. Found ${writePerms.length} permission(s) with allowsWrite=true`
    );
  }

  // Constraint 4: Only Bash and Read tools allowed (allowlist validation, not denylist)
  const allowedToolNames = new Set(["Bash", "Read"]);
  const disallowedTools = DEFAULT_READ_SAFE_PERMISSIONS.filter(
    (p) => !allowedToolNames.has(p.name)
  );
  if (disallowedTools.length > 0) {
    throw new Error(
      `Read-safe permissions must only include Bash and Read tools. Found disallowed tool(s): ${disallowedTools.map((p) => p.name).join(", ")}`
    );
  }

  // Constraint 5: Bash must be for dr CLI only with properly restricted scope (no wildcards or bare patterns)
  const bashPerms = DEFAULT_READ_SAFE_PERMISSIONS.filter((p) => p.name === "Bash");
  if (bashPerms.length > 0) {
    const invalidBash = bashPerms.filter((p) => {
      const hasValidDescription = p.description.toLowerCase().includes("dr") && p.description.toLowerCase().includes("cli");
      const hasValidScope = typeof p.scope === "string" && p.scope.length > 0;

      // Validate scope content: reject bare wildcards and unsafe patterns
      let hasValidScopeContent = true;
      if (hasValidScope) {
        const scope = p.scope;
        // Reject dangerous scope patterns: bare "*", ".", or "dr *"
        if (scope === "*" || scope === "." || scope === "dr *" || scope.startsWith("dr *")) {
          hasValidScopeContent = false;
        }
        // Ensure scope starts with "dr " for Bash tool
        if (!scope.startsWith("dr ")) {
          hasValidScopeContent = false;
        }
      }

      return !hasValidDescription || !hasValidScope || !hasValidScopeContent;
    });
    if (invalidBash.length > 0) {
      const errors = invalidBash.map((p) => {
        const issues = [];
        if (!p.description.toLowerCase().includes("dr") || !p.description.toLowerCase().includes("cli")) {
          issues.push("invalid description (must include 'dr' and 'cli')");
        }
        if (typeof p.scope !== "string" || p.scope.length === 0) {
          issues.push("missing or empty scope");
        } else {
          const scope = p.scope;
          if (scope === "*" || scope === "." || scope === "dr *" || scope.startsWith("dr *")) {
            issues.push("scope uses dangerous wildcard pattern (must specify read-safe commands)");
          }
          if (!scope.startsWith("dr ")) {
            issues.push("scope must start with 'dr ' for Bash tool");
          }
        }
        return `${p.description} (${issues.join(", ")})`;
      });
      throw new Error(
        `Bash permission must be for dr CLI only with properly restricted scope. Found invalid Bash permission(s): ${errors.join("; ")}`
      );
    }
  }

  // Constraint 6: Must have Read permission for codebase
  const codebaseRead = DEFAULT_READ_SAFE_PERMISSIONS.find(
    (p) => p.name === "Read" && p.description.toLowerCase().includes("codebase")
  );
  if (!codebaseRead) {
    throw new Error("Read-safe permissions must include Read permission for codebase");
  }

  // Constraint 7: Must have Read permission for documentation-robotics folder
  const docRoboticsRead = DEFAULT_READ_SAFE_PERMISSIONS.find(
    (p) => p.name === "Read" && p.description.includes("documentation-robotics")
  );
  if (!docRoboticsRead) {
    throw new Error("Read-safe permissions must include Read permission for documentation-robotics folder");
  }

  // Constraint 8: Must have Read permission for .dr folder
  const drFolderRead = DEFAULT_READ_SAFE_PERMISSIONS.find(
    (p) => p.name === "Read" && (p.scope === ".dr" || p.description.includes(".dr"))
  );
  if (!drFolderRead) {
    throw new Error("Read-safe permissions must include Read permission for .dr folder");
  }

  // All constraints passed
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
 * @param testSpawnSync Optional injected spawnSync for testing (allows mocking CLI probe)
 */
export function applyCopilotPermissions(
  cmd: string[],
  variant: string,
  copilotCommand: string,
  withDanger: boolean,
  onTelemetry?: (attr: string, value: any) => void,
  testSpawnSync?: typeof spawnSync
): void {
  const spawnSyncFn = testSpawnSync || spawnSync;

  if (withDanger) {
    try {
      const helpResult = spawnSyncFn(
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
      const helpResult = spawnSyncFn(
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
        // Flag not advertised in help, but still try to apply it optimistically
        // (fail-safe: try to restrict access even if we're not 100% sure the flag exists)
        const allowedToolsValue = formatForCopilot();
        cmd.push("--allowedTools", allowedToolsValue);
        onTelemetry?.("process.readSafePermissionsApplied", true);
        onTelemetry?.("process.allowedTools", allowedToolsValue);
        console.warn(
          ansis.yellow(
            `Note: Your ${variant} version doesn't advertise --allowedTools in help, ` +
              `but attempting to apply it. If not supported, ` +
              `please upgrade @github/copilot for granular permission controls.`
          )
        );
      }
    } catch {
      onTelemetry?.("process.readSafePermissionCheckFailed", true);
      // Graceful degradation: unable to verify support, so launch without restrictions
      // rather than failing the launch. Warn user that this is less secure.
      onTelemetry?.("process.readSafePermissionsApplied", false);
      console.warn(
        ansis.yellow(
          `WARNING: Could not verify read-safe permission support for ${variant}. ` +
            `Launching without granular permission restrictions. ` +
            `For better security, please ensure your ${variant} CLI is up-to-date.`
        )
      );
    }
  }
}

// Validate read-safe constraints during module initialization
validateReadSafeConstraints();
