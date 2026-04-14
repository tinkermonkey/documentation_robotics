/**
 * Source Reference Validator
 *
 * Validates that source_reference fields on model elements still point to real,
 * unchanged code by using an active CodePrism session to detect stale, moved,
 * and type-mismatched references.
 *
 * Validation checks:
 * 1. File existence: Call find_files to check if file still exists
 * 2. Symbol existence: Call explain_symbol to verify symbol exists at declared location
 * 3. Symbol identity: Compare DR element type to CodePrism construct type
 * 4. Symbol moved: Call search_symbols by name if symbol is not found
 * 5. Dead reference: Call find_references for extracted elements with zero inbound refs
 */

import ansis from "ansis";
import { Element } from "../core/element.js";
import { type SourceLocation } from "../types/index.js";
import { type MCPClient } from "./mcp-client.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Validation result for a single source reference location
 */
export interface LocationValidationResult {
  file: string;
  symbol?: string;
  status: "ok" | "stale" | "symbol_missing" | "symbol_type_mismatch" | "symbol_moved" | "error";
  message: string;
  newLocation?: SourceLocation;
  context?: {
    declaredType?: string;
    actualType?: string;
    codeprismOutput?: string;
  };
}

/**
 * Validation result for an element's source references
 */
export interface ElementValidationResult {
  elementId: string;
  elementType: string;
  provenance: string;
  locations: LocationValidationResult[];
  isDead?: boolean;
  overallStatus: "ok" | "warning" | "error";
  summary: string;
}

/**
 * Map DR element types to CodePrism construct types
 * Used for symbol identity validation
 */
const DR_TO_CODEPRISM_TYPES: Record<string, string[]> = {
  // Application layer
  "service": ["class", "interface"],
  "component": ["class", "function"],
  "function": ["function"],
  "method": ["method"],
  "property": ["property"],
  "variable": ["variable"],

  // Data model layer
  "entity": ["class", "interface", "type"],
  "property_model": ["property", "field"],

  // API layer
  "endpoint": ["method", "function"],
  "operation": ["function", "method"],

  // UX layer
  "component_ui": ["class", "function"],
  "screen": ["class", "component"],

  // Generic/other
  "class": ["class"],
  "function_generic": ["function"],
  "interface": ["interface"],
};

/**
 * Parse CodePrism construct type string and normalize it
 * Handles various CodePrism output formats
 */
function normalizeCodePrismType(codeprismType: string): string {
  const normalized = codeprismType.toLowerCase().trim();
  // Handle compound types like "async function", "static method", etc.
  if (normalized.includes("function")) return "function";
  if (normalized.includes("method")) return "method";
  if (normalized.includes("class")) return "class";
  if (normalized.includes("interface")) return "interface";
  if (normalized.includes("property") || normalized.includes("field")) return "property";
  if (normalized.includes("variable")) return "variable";
  return normalized;
}

/**
 * Extract element type from a fully-qualified element ID
 * e.g., "api.endpoint.create-user" -> "endpoint"
 */
function extractElementTypeFromId(elementId: string): string {
  const parts = elementId.split(".");
  return parts.length >= 2 ? parts[1] : "unknown";
}

/**
 * Validate that a declared element type matches a CodePrism construct type
 */
function validateSymbolType(drElementType: string, codeprismType: string): boolean {
  const normalized = normalizeCodePrismType(codeprismType);
  const expectedTypes = DR_TO_CODEPRISM_TYPES[drElementType] || [];
  return expectedTypes.includes(normalized);
}

/**
 * Validate a single source location by checking file and symbol existence
 *
 * @param client - MCP client for CodePrism queries
 * @param location - Source location to validate
 * @param elementType - DR element type for type matching
 * @returns Validation result with status and any correction info
 */
export async function validateSourceLocation(
  client: MCPClient,
  location: SourceLocation,
  elementType: string
): Promise<LocationValidationResult> {
  const { file, symbol } = location;

  try {
    // Step 1: Check file existence
    const fileCheckResult = await client.callTool("find_files", {
      path_pattern: file,
    });

    const hasFile = fileCheckResult.some((result) => {
      if (result.type === "text") {
        try {
          const parsed = JSON.parse(result.text);
          return Array.isArray(parsed) && parsed.length > 0;
        } catch {
          // If not JSON, treat as found if non-empty
          return result.text && result.text.trim().length > 0;
        }
      }
      return false;
    });

    if (!hasFile) {
      return {
        file,
        symbol,
        status: "stale",
        message: `File not found: ${file}`,
      };
    }

    // If no symbol to check, we're done
    if (!symbol) {
      return {
        file,
        symbol,
        status: "ok",
        message: `File exists: ${file}`,
      };
    }

    // Step 2: Check symbol existence at declared location
    const explainResult = await client.callTool("explain_symbol", {
      path: file,
      symbol: symbol,
    });

    const explainText = explainResult
      .filter((r) => r.type === "text")
      .map((r) => (r.type === "text" ? r.text : ""))
      .join("\n");

    const isSymbolFound = explainText && explainText.trim().length > 0 && !explainText.includes("not found");

    if (!isSymbolFound) {
      // Step 4: Symbol not found at original location, try search_symbols
      const searchResult = await client.callTool("search_symbols", {
        name: symbol,
        language: guessLanguageFromFile(file),
      });

      const searchText = searchResult
        .filter((r) => r.type === "text")
        .map((r) => (r.type === "text" ? r.text : ""))
        .join("\n");

      // Try to parse search results to find moved symbol
      let movedLocation: SourceLocation | undefined;
      if (searchText && searchText.trim().length > 0) {
        try {
          const parsed = JSON.parse(searchText);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstMatch = parsed[0];
            if (firstMatch && typeof firstMatch === "object" && "file" in firstMatch) {
              movedLocation = {
                file: firstMatch.file as string,
                ...(firstMatch.symbol && { symbol: firstMatch.symbol as string }),
              };
            }
          }
        } catch {
          // If search results aren't JSON, treat as not found
        }
      }

      if (movedLocation) {
        return {
          file,
          symbol,
          status: "symbol_moved",
          message: `Symbol moved to: ${movedLocation.file}${movedLocation.symbol ? `:${movedLocation.symbol}` : ""}`,
          newLocation: movedLocation,
          context: {
            codeprismOutput: searchText,
          },
        };
      }

      return {
        file,
        symbol,
        status: "symbol_missing",
        message: `Symbol '${symbol}' not found at ${file}`,
        context: {
          codeprismOutput: searchText,
        },
      };
    }

    // Step 3: Symbol found, validate type match
    // Extract the construct type from explain output
    const typeMatch = explainText.match(/(?:type|kind|construct)\s*[:=]\s*(\w+)/i);
    const actualType = typeMatch ? normalizeCodePrismType(typeMatch[1]) : "unknown";

    if (!validateSymbolType(elementType, actualType)) {
      return {
        file,
        symbol,
        status: "symbol_type_mismatch",
        message: `Symbol type mismatch: expected ${elementType}, got ${actualType}`,
        context: {
          declaredType: elementType,
          actualType: actualType,
          codeprismOutput: explainText,
        },
      };
    }

    return {
      file,
      symbol,
      status: "ok",
      message: `✓ Valid: ${file}${symbol ? `:${symbol}` : ""}`,
    };
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    return {
      file,
      symbol,
      status: "error",
      message: `Error validating reference: ${errorMsg}`,
      context: {
        codeprismOutput: errorMsg,
      },
    };
  }
}

/**
 * Check if an element has any inbound references (for dead reference detection)
 * Only applies to extracted elements
 */
export async function checkElementReferences(
  client: MCPClient,
  _elementId: string,
  locations: SourceLocation[]
): Promise<boolean> {
  if (locations.length === 0) {
    return false;
  }

  try {
    // For each location, check if there are any references to it
    for (const location of locations) {
      if (!location.symbol) continue;

      const refResult = await client.callTool("find_references", {
        path: location.file,
        symbol: location.symbol,
      });

      const refText = refResult
        .filter((r) => r.type === "text")
        .map((r) => (r.type === "text" ? r.text : ""))
        .join("\n");

      // If we found at least one reference, the element is not dead
      if (refText && refText.trim().length > 0) {
        try {
          const parsed = JSON.parse(refText);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return true;
          }
        } catch {
          // Even if we can't parse, non-empty output likely means references exist
          return true;
        }
      }
    }

    return false;
  } catch {
    // On error, conservatively assume not dead
    return true;
  }
}

/**
 * Validate all source references for an element
 */
export async function validateElementReferences(
  client: MCPClient,
  element: Element
): Promise<ElementValidationResult> {
  const elementId = element.path || element.id;
  const elementType = extractElementTypeFromId(elementId);
  const sourceRef = element.source_reference;

  if (!sourceRef) {
    return {
      elementId,
      elementType,
      provenance: "unknown",
      locations: [],
      overallStatus: "error",
      summary: "No source reference found",
    };
  }

  const locations = sourceRef.locations || [];

  if (locations.length === 0) {
    // For extracted and manual provenance, missing locations is an issue
    if (sourceRef.provenance === "extracted" || sourceRef.provenance === "manual") {
      return {
        elementId,
        elementType,
        provenance: sourceRef.provenance,
        locations: [],
        overallStatus: "warning",
        summary: "No locations defined for extracted/manual provenance",
      };
    }

    // For inferred/generated, missing locations is acceptable
    return {
      elementId,
      elementType,
      provenance: sourceRef.provenance,
      locations: [],
      overallStatus: "ok",
      summary: "No locations (acceptable for inferred/generated provenance)",
    };
  }

  // Validate each location
  const locationResults: LocationValidationResult[] = [];
  for (const location of locations) {
    const result = await validateSourceLocation(client, location, elementType);
    locationResults.push(result);
  }

  // Check for dead references (extracted elements with zero inbound references)
  let isDead = false;
  if (sourceRef.provenance === "extracted") {
    isDead = !(await checkElementReferences(client, elementId, locations));
  }

  // Determine overall status
  const hasErrors = locationResults.some((r) => r.status === "error");
  const hasStale = locationResults.some((r) => r.status === "stale");
  const hasTypeMismatch = locationResults.some((r) => r.status === "symbol_type_mismatch");
  const hasMoved = locationResults.some((r) => r.status === "symbol_moved");
  const hasSymbolMissing = locationResults.some((r) => r.status === "symbol_missing");

  let overallStatus: "ok" | "warning" | "error" = "ok";
  let summary = "✓ All references valid";

  if (hasErrors) {
    overallStatus = "error";
    summary = "Validation errors encountered";
  } else if (hasStale || hasTypeMismatch) {
    overallStatus = "error";
    summary = hasStale ? "File(s) not found (stale)" : "Symbol type mismatch";
  } else if (hasSymbolMissing || hasMoved) {
    overallStatus = "warning";
    summary = hasSymbolMissing ? "Symbol missing from original location" : "Symbol moved to new location";
  } else if (isDead) {
    overallStatus = "warning";
    summary = "Potentially dead reference (no inbound references found)";
  }

  return {
    elementId,
    elementType,
    provenance: sourceRef.provenance,
    locations: locationResults,
    isDead,
    overallStatus,
    summary,
  };
}

/**
 * Guess language from file extension
 */
function guessLanguageFromFile(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "cs":
      return "csharp";
    case "cpp":
    case "cc":
    case "cxx":
      return "cpp";
    case "c":
      return "c";
    default:
      return "typescript"; // Default to TypeScript for unknown extensions
  }
}

/**
 * Format validation result for console output
 */
export function formatValidationResult(result: ElementValidationResult): string {
  const statusIcon = result.overallStatus === "ok" ? ansis.green("✓") : result.overallStatus === "warning" ? ansis.yellow("⚠") : ansis.red("✗");

  let output = `${statusIcon} ${result.elementId}\n`;
  output += `  Type: ${result.elementType}, Provenance: ${result.provenance}\n`;

  if (result.isDead) {
    output += ansis.yellow(`  ⚠ Potentially dead (no inbound references)\n`);
  }

  for (const loc of result.locations) {
    const locIcon = loc.status === "ok" ? ansis.green("✓") : ansis.red("✗");
    output += `  ${locIcon} ${loc.file}`;
    if (loc.symbol) {
      output += `:${loc.symbol}`;
    }
    output += ` - ${loc.message}\n`;

    if (loc.newLocation) {
      output += ansis.green(`     → Fixed location: ${loc.newLocation.file}`);
      if (loc.newLocation.symbol) {
        output += `:${loc.newLocation.symbol}`;
      }
      output += "\n";
    }
  }

  return output;
}
