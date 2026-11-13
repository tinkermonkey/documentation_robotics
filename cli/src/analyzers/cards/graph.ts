/**
 * The card builder's view of a CBM project, over the analyzer's {@link CbmTools}.
 */
import { CbmToolError, type CbmGraphNode, type CbmTools } from "../cbm-responses.js";
import type { CardGraph, GraphNode } from "./types.js";

/**
 * Flatten a normalised search_graph node: its properties become top-level fields. A Route keeps
 * its full qualified name (`__route__GET__/owners`) as its name, since CBM's own name for it is
 * only the path, or a fragment of it.
 */
export function graphNodeOf(node: CbmGraphNode): GraphNode {
  const qualifiedName = String(node.qualified_name ?? node.name ?? "");
  const props = node.properties ?? {};
  return {
    ...props,
    label: node.label,
    // search_graph's row name is a qualified-name fragment; an EnvVar's own name is its key.
    name: node.label === "Route" ? qualifiedName : node.label === "EnvVar" && typeof props.env_key === "string" && props.env_key ? props.env_key : String(node.name ?? ""),
    qualified_name: qualifiedName,
    file_path: typeof node.file_path === "string" ? node.file_path : "",
  };
}

export function cbmCardGraph(tools: CbmTools, project: string): CardGraph {
  return {
    project,
    async search(label, filePattern, fields) {
      const nodes = await tools.searchGraph({
        project,
        label,
        ...(filePattern ? { file_pattern: filePattern } : {}),
        ...(fields.length ? { fields } : {}),
      });
      return nodes.map(graphNodeOf);
    },
    async rows(cypher) {
      return (await tools.queryGraph(cypher, project)).rows;
    },
    async snippet(qualifiedName) {
      try {
        // CBM 0.12's default ("auto") outlines containers of 200+ lines and caps output at about
        // 2,500 tokens; "full" returns the source (up to 500 lines, uncapped).
        const raw = (await tools.call("get_code_snippet", { project, qualified_name: qualifiedName, source_mode: "full" })) as { source?: unknown };
        return raw && typeof raw.source === "string" ? { source: raw.source } : null;
      } catch (error) {
        // An unknown or source-less symbol comes back as an error payload: no source.
        if (error instanceof CbmToolError) return null;
        throw error;
      }
    },
  };
}
