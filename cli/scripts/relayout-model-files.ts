/**
 * Lay a model's element files out as dr writes them, data unchanged.
 *
 * dr and prettier lay long YAML strings out differently (#1246). Once a project lists
 * `documentation-robotics/model/` in `.prettierignore` (dr init and dr upgrade add it), each
 * element file settles into dr's layout the first time dr writes a real change to it, and that
 * one commit mixes the change with a re-layout of the whole file. Running this once, in a commit
 * of its own, takes that noise out of every later diff. dr itself can't do it: its writer leaves a
 * file alone when the data would not change.
 *
 * Only the element files (`documentation-robotics/model/NN_layer/*.yaml`) are rewritten. The
 * manifest and relationships.yaml are written whole by dr on every change and are left alone.
 * Each file is checked to parse to the same data before it is written.
 *
 * Usage (from cli/):
 *   bun run scripts/relayout-model-files.ts [project-root] [--check]
 *
 * --check writes nothing and exits 1 when a file is not in dr's layout.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import yaml from "yaml";

const args = process.argv.slice(2);
const check = args.includes("--check");
const root = resolve(args.find((arg) => !arg.startsWith("--")) ?? "..");
const modelDir = join(root, "documentation-robotics", "model");

let total = 0;
const changed: string[] = [];
for (const layer of await readdir(modelDir, { withFileTypes: true })) {
  if (!layer.isDirectory() || !/^\d{2}_/.test(layer.name)) continue;
  for (const name of (await readdir(join(modelDir, layer.name))).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const file = join(modelDir, layer.name, name);
    const text = await readFile(file, "utf-8");
    const data = yaml.parse(text);
    // The same call the model writer makes (Model.writeLayer)
    const laidOut = yaml.stringify(data);
    total++;
    if (laidOut === text) continue;
    if (!isDeepStrictEqual(yaml.parse(laidOut), data)) {
      throw new Error(`${file}: re-laying it out would change its data; left alone`);
    }
    changed.push(relative(root, file));
    if (!check) await writeFile(file, laidOut, "utf-8");
  }
}

for (const file of changed) console.log(`${check ? "not in dr's layout" : "re-laid out"}: ${file}`);
console.log(`${changed.length} of ${total} element file(s) ${check ? "are not in" : "rewritten in"} dr's layout`);
if (check && changed.length > 0) process.exit(1);
