/**
 * McpResourceRegistry — registers spec and model manifest resources onto an
 * MCP server, per the "MCP Resources" section of the architecture design.
 *
 * - dr://spec/manifest       — index of all 12 compiled specification layers
 * - dr://spec/base           — base schemas + predicates shared across layers
 * - dr://spec/layer/{name}   — node/relationship schemas for a single layer
 * - dr://model/manifest      — metadata and layer summary for the current model
 * - dr://model/annotations   — all annotations across the current model
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnnotationStore } from "../core/annotation-store.js";
import { CANONICAL_LAYER_NAMES } from "../core/layers.js";
import { getErrorMessage } from "../utils/errors.js";
import { loadModel } from "./tools/shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_SCHEMAS_DIR = path.join(__dirname, "../schemas/bundled");

/** Exported for direct unit testing of the ENOENT-to-actionable-error translation. */
export async function readBundledSchema(fileName: string): Promise<string> {
  try {
    return await fs.readFile(path.join(BUNDLED_SCHEMAS_DIR, fileName), "utf-8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Bundled schema "${fileName}" is missing from ${BUNDLED_SCHEMAS_DIR}. ` +
          `This usually means the CLI build is incomplete or corrupted — run "npm run build" in cli/ to regenerate it.`
      );
    }
    throw error;
  }
}

export class McpResourceRegistry {
  /** Registers every spec/model resource onto the given MCP server instance. */
  async registerAll(server: McpServer): Promise<void> {
    const { ResourceTemplate } = await import("@modelcontextprotocol/sdk/server/mcp.js");

    server.registerResource(
      "spec-manifest",
      "dr://spec/manifest",
      {
        title: "Specification manifest",
        description: "Index of all 12 architecture layers in the compiled specification.",
        mimeType: "application/json",
      },
      async (uri) => {
        const text = await readBundledSchema("manifest.json");
        return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
      }
    );

    server.registerResource(
      "spec-base",
      "dr://spec/base",
      {
        title: "Base specification schemas",
        description: "Base schemas and predicates shared across all layers.",
        mimeType: "application/json",
      },
      async (uri) => {
        const text = await readBundledSchema("base.json");
        return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
      }
    );

    server.registerResource(
      "spec-layer",
      new ResourceTemplate("dr://spec/layer/{name}", {
        list: async () => ({
          resources: CANONICAL_LAYER_NAMES.map((name) => ({
            name: `spec-layer-${name}`,
            uri: `dr://spec/layer/${name}`,
            title: `${name} layer schemas`,
            mimeType: "application/json",
          })),
        }),
      }),
      {
        title: "Layer specification schemas",
        description: "Node and relationship schemas for a single architecture layer.",
        mimeType: "application/json",
      },
      async (uri, variables) => {
        const name = String(variables.name);
        if (!(CANONICAL_LAYER_NAMES as readonly string[]).includes(name)) {
          throw new Error(
            `Unknown spec layer "${name}". Valid layers: ${CANONICAL_LAYER_NAMES.join(", ")}`
          );
        }
        const text = await readBundledSchema(`${name}.json`);
        return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
      }
    );

    server.registerResource(
      "model-manifest",
      "dr://model/manifest",
      {
        title: "Model manifest",
        description: "Metadata and layer summary for the current architecture model.",
        mimeType: "application/json",
      },
      async (uri) => {
        try {
          const model = await loadModel();
          const manifest = {
            name: model.manifest.name,
            version: model.manifest.version,
            specVersion: model.manifest.specVersion,
            description: model.manifest.description,
            author: model.manifest.author,
            created: model.manifest.created,
            modified: model.manifest.modified,
            layers: model.getLayerNames(),
          };
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(manifest, null, 2) }],
          };
        } catch (error) {
          throw new Error(`Failed to load model manifest: ${getErrorMessage(error)}`);
        }
      }
    );

    server.registerResource(
      "model-annotations",
      "dr://model/annotations",
      {
        title: "Model annotations",
        description: "All annotations on elements in the current architecture model.",
        mimeType: "application/json",
      },
      async (uri) => {
        try {
          const model = await loadModel();
          const store = new AnnotationStore(model.rootPath);
          const annotations = await store.list();
          return {
            contents: [
              { uri: uri.href, mimeType: "application/json", text: JSON.stringify({ annotations }, null, 2) },
            ],
          };
        } catch (error) {
          throw new Error(`Failed to load model annotations: ${getErrorMessage(error)}`);
        }
      }
    );
  }
}
