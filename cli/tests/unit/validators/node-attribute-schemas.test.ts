/**
 * Every node type must be creatable with its required attributes: a required
 * attribute has to be one the schema defines, or a closed schema
 * (additionalProperties: false) rejects every element of that type.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../spec/dist"
);

interface AttributesSchema {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

function attributeSchemas(): Array<[string, AttributesSchema]> {
  const manifest = JSON.parse(
    readFileSync(join(DIST, "manifest.json"), "utf-8")
  );
  const layers: string[] = (manifest.layers ?? []).map(
    (l: { id?: string; name?: string } | string) =>
      typeof l === "string" ? l : (l.id ?? l.name)
  );
  const out: Array<[string, AttributesSchema]> = [];
  for (const layer of layers) {
    const file = JSON.parse(readFileSync(join(DIST, `${layer}.json`), "utf-8"));
    for (const [type, schema] of Object.entries(
      file.nodeSchemas ?? {}
    ) as Array<[string, any]>) {
      const attrs = schema?.properties?.attributes;
      if (attrs) out.push([`${layer}.${type}`, attrs]);
    }
  }
  return out;
}

describe("node attribute schemas", () => {
  const schemas = attributeSchemas();

  it("covers every layer's node types", () => {
    expect(schemas.length).toBeGreaterThan(150);
  });

  it("requires only attributes it defines when the schema is closed", () => {
    const broken = schemas
      .filter(([, a]) => a.additionalProperties === false)
      .flatMap(([type, a]) =>
        (a.required ?? [])
          .filter((r) => !(r in (a.properties ?? {})))
          .map((r) => `${type}: ${r}`)
      );
    expect(broken).toEqual([]);
  });
});
