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
