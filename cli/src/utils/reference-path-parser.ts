/**
 * Reference path parser for qualified and unqualified element references.
 *
 * Supports parsing reference targets in the following formats:
 * - Unqualified: {layer}.{type}.{name} (e.g., motivation.goal.increase-revenue)
 * - Unqualified UUID: UUIDv4 format
 * - Qualified: @{model-name}/{layer}.{type}.{name} (e.g., @auth-service/api.operation.authenticate)
 *
 * The parser distinguishes between parse-level errors (malformed qualified paths)
 * and reference resolution errors (unknown model or broken reference).
 */

export interface ParsedReferencePath {
  /** Model qualifier if present (without @ or /) */
  modelName?: string;
  /** The underlying {layer}.{type}.{name} segment or UUID */
  segment: string;
  /** Whether this is a qualified reference */
  isQualified: boolean;
}

export class ReferencePathParseError extends Error {
  readonly kind = "malformed-qualified-path" as const;

  constructor(message: string) {
    super(message);
    this.name = "ReferencePathParseError";
    Object.setPrototypeOf(this, ReferencePathParseError.prototype);
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const QUALIFIED_PREFIX_PATTERN = /^@([a-z0-9][a-z0-9_-]*)\//i;
const ELEMENT_PATH_PATTERN = /^[a-z_][a-z0-9_-]*(\.[a-z_][a-z0-9_-]*)+$/;

/**
 * Parse a reference path, extracting model qualifier and underlying segment.
 *
 * @param path The reference path string to parse
 * @returns Parsed reference information on success
 * @throws ReferencePathParseError if the path is malformed
 *
 * @example
 * // Unqualified path
 * parseReferencePath("motivation.goal.increase-revenue")
 * // => { modelName: undefined, segment: "motivation.goal.increase-revenue", isQualified: false }
 *
 * // Qualified path
 * parseReferencePath("@auth-service/api.operation.authenticate")
 * // => { modelName: "auth-service", segment: "api.operation.authenticate", isQualified: true }
 *
 * // UUID
 * parseReferencePath("550e8400-e29b-41d4-a716-446655440000")
 * // => { modelName: undefined, segment: "550e8400-e29b-41d4-a716-446655440000", isQualified: false }
 *
 * // Qualified UUID (not yet supported, will throw)
 * parseReferencePath("@model/550e8400-e29b-41d4-a716-446655440000")
 * // => throws ReferencePathParseError
 */
export function parseReferencePath(path: string): ParsedReferencePath {
  if (!path || typeof path !== "string" || path.trim() === "") {
    throw createParseError("Empty reference path");
  }

  const trimmedPath = path.trim();

  // Check for qualified prefix (@model-name/)
  const qualifiedMatch = trimmedPath.match(QUALIFIED_PREFIX_PATTERN);

  if (qualifiedMatch) {
    const modelName = qualifiedMatch[1].toLowerCase();
    const segment = trimmedPath.substring(qualifiedMatch[0].length);

    // Validate segment format
    if (!segment || segment.trim() === "") {
      throw createParseError(
        "Qualified reference missing segment after '@{model-name}/'"
      );
    }

    // Qualified paths must use dot-separated format, not UUIDs
    if (UUID_PATTERN.test(segment)) {
      throw createParseError(
        "Qualified references cannot reference UUIDs; use '@{model-name}/{layer}.{type}.{name}' format"
      );
    }

    // Validate segment is a valid element path
    if (!ELEMENT_PATH_PATTERN.test(segment)) {
      throw createParseError(
        `Qualified reference has invalid element path: '${segment}'. Use format '@{model-name}/{layer}.{type}.{name}'`
      );
    }

    return {
      modelName,
      segment,
      isQualified: true,
    };
  }

  // Unqualified reference
  // Accept either UUID or dot-separated element path
  if (UUID_PATTERN.test(trimmedPath)) {
    return {
      modelName: undefined,
      segment: trimmedPath,
      isQualified: false,
    };
  }

  if (ELEMENT_PATH_PATTERN.test(trimmedPath)) {
    return {
      modelName: undefined,
      segment: trimmedPath,
      isQualified: false,
    };
  }

  // Invalid format
  throw createParseError(
    `Invalid reference path format: '${trimmedPath}'. ` +
      "Use one of: '{layer}.{type}.{name}', UUID, or '@{model-name}/{layer}.{type}.{name}'"
  );
}


function createParseError(message: string): ReferencePathParseError {
  return new ReferencePathParseError(message);
}
