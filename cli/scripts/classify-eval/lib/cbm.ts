import { spawnSync } from "node:child_process";
import { StdioClient } from "../../../src/analyzers/stdio-client.js";
import { CbmTools } from "../../../src/analyzers/cbm-responses.js";
import { buildEdgeIndex, cbmCardGraph, type CardGraph, type EdgeIndex } from "../../../src/analyzers/cards/index.js";

export type { EdgeIndex, GraphNode } from "../../../src/analyzers/cards/index.js";

/**
 * Session over codebase-memory-mcp (CBM) for the eval harness: opens the CLI's StdioClient,
 * resolves (or builds) a corpus's index, and hands out the same CardGraph that
 * `dr analyzer classify` uses, so cards and facts are built by production code.
 */

export function findCbmBinary(): string {
  const which = spawnSync("which", ["codebase-memory-mcp"], { encoding: "utf8" });
  const p = which.stdout.trim();
  if (!p) throw new Error("codebase-memory-mcp not found on PATH");
  return p;
}

export class CbmSession {
  private client = new StdioClient();
  private tools = new CbmTools(this.client);
  private opened = false;
  project: string | null = null;

  async open(): Promise<void> {
    if (this.opened) return;
    this.client.spawn(findCbmBinary());
    await this.client.initialize({ name: "dr-classify-eval", version: "0.0.1" });
    this.opened = true;
  }

  close(): void {
    if (this.opened) this.client.close();
    this.opened = false;
  }

  /** Resolve (and optionally build) the index for a repository root. */
  async ensureIndexed(root: string, opts: { reindex?: boolean; mode?: "full" | "moderate" | "fast" } = {}): Promise<string> {
    const existing = (await this.tools.listProjects()).find((p) => p.root_path === root);
    if (existing && !opts.reindex) {
      this.project = existing.name;
      return existing.name;
    }
    process.stderr.write(`Indexing ${root} with codebase-memory-mcp (${opts.mode ?? "full"})...\n`);
    const r = (await this.client.invokeTool("index_repository", { repo_path: root, mode: opts.mode ?? "full", format: "json" }, { timeout: 20 * 60 * 1000 })) as Record<string, unknown>;
    process.stderr.write(`Indexed: nodes=${String(r.nodes)} edges=${String(r.edges)}\n`);
    const after = (await this.tools.listProjects()).find((p) => p.root_path === root);
    if (!after) throw new Error(`Project not listed after indexing: ${root}`);
    this.project = after.name;
    return after.name;
  }

  /** The production card graph over the selected project. */
  graph(): CardGraph {
    if (!this.project) throw new Error("No project selected; call ensureIndexed first");
    return cbmCardGraph(this.tools, this.project);
  }

  async buildEdgeIndex(): Promise<EdgeIndex> {
    return buildEdgeIndex(this.graph());
  }
}
