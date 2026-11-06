/**
 * Surface-aware error hints.
 *
 * The CLI and the MCP server share validation code, but a user at the terminal passes
 * `--source-provenance` and runs `dr schema`, while an agent over MCP passes the
 * `sourceProvenance` parameter and calls the `spec_type` tool. Errors built from shared code
 * take a surface and name things the way that caller can act on them.
 */

export type HintSurface = "cli" | "mcp";

/** Option keys that shared validators name in their messages. */
export type HintOption =
  | "sourceFile"
  | "sourceSymbol"
  | "sourceProvenance"
  | "sourceRepoRemote"
  | "sourceRepoCommit"
  | "clearSourceReference";

const CLI_FLAGS: Record<HintOption, string> = {
  sourceFile: "--source-file",
  sourceSymbol: "--source-symbol",
  sourceProvenance: "--source-provenance",
  sourceRepoRemote: "--source-repo-remote",
  sourceRepoCommit: "--source-repo-commit",
  clearSourceReference: "--clear-source-reference",
};

/** How the caller names an option: `--source-file` on the CLI, `sourceFile` over MCP. */
export function optionName(surface: HintSurface, option: HintOption): string {
  return surface === "mcp" ? option : CLI_FLAGS[option];
}

/** How the caller passes an option with a value, for examples in hints. */
export function optionExample(surface: HintSurface, option: HintOption, value: string): string {
  return surface === "mcp" ? `${option}: "${value}"` : `${CLI_FLAGS[option]} "${value}"`;
}

/** Where to look up a type's required attributes: `dr schema` on the CLI, `spec_type` over MCP. */
export function schemaLookupHint(surface: HintSurface, layer: string, type: string): string {
  return surface === "mcp"
    ? `Call "spec_type" with layer "${layer}" and type "${type}" to see the required attributes`
    : `Run "dr schema node ${layer}.${type}" to see the required attributes`;
}

/**
 * Warning for an update to an element whose current type the spec does not define (an obsolete
 * `product.capability`). With no type schema there is nothing to check its attributes against, so
 * the update goes through; the hint names the type change that fixes it, because looking up the
 * obsolete type with `spec_type` or `dr schema node` cannot work.
 */
export function undefinedTypeWarning(
  surface: HintSurface,
  layer: string,
  elementId: string,
  type: string,
  replacements: string[]
): { message: string; hint: string } {
  const message =
    `Element '${elementId}' has type '${type}', which the spec does not define for the ${layer} layer, ` +
    `so its attributes were not checked against a type schema`;
  const replacement = replacements[0];
  let hint: string;
  if (surface === "mcp") {
    hint = replacement
      ? `Pass type "${replacement}" to model_update to move the element to a type the spec defines`
      : `Call "spec_type" with layer "${layer}" and no type to list the layer's types, then pass one as type to model_update`;
  } else {
    hint = replacement
      ? `Run "dr update ${elementId} --type ${replacement}" to move the element to a type the spec defines`
      : `Run "dr schema types ${layer}" to list the layer's types, then "dr update ${elementId} --type <type>"`;
  }
  return { message, hint };
}
