/**
 * Generate cli/src/integrations/shipped-entries.ts: every DR-named file and folder a dr has
 * installed into an integration's folders, with the content hash of every version of each file.
 *
 * `dr upgrade` offers to remove leftovers of older integration layouts. A name alone can't tell a
 * leftover from a project's own file (`dr-helper.md` may be the team's), so an entry is offered
 * only when its contents are a version dr shipped. This script reads them from the repository's
 * whole git history: every blob that was ever at a path under an integration source folder
 * (`claude_code/` or the older `claude_integration/`, `github_copilot/` or `copilot_integration/`),
 * in `agents/`, `commands/`, `skills/`, `reference_sheets/` or `knowledge/` (the last two both
 * install to `knowledge/`), whose top-level name starts with `dr-` or `dr_`.
 *
 * Run it (from cli/) when a release drops or changes integration files:
 *   bun run scripts/generate-shipped-entries.ts
 * It needs the full history: in a shallow clone it refuses.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");
const OUT = join(REPO, "cli", "src", "integrations", "shipped-entries.ts");

const INTEGRATIONS: Record<string, string> = {
  claude_code: "claude_code",
  claude_integration: "claude_code",
  github_copilot: "github_copilot",
  copilot_integration: "github_copilot",
};
const TARGETS: Record<string, string> = {
  agents: "agents",
  commands: "commands",
  skills: "skills",
  reference_sheets: "knowledge",
  knowledge: "knowledge",
};

function git(args: string[], input?: string): string {
  const result = spawnSync("git", args, { cwd: REPO, encoding: "utf-8", input, maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
  throw new Error("A shallow clone lacks the history this table comes from: fetch with --unshallow first.");
}

/** Where a path sits in an integration, or null: integration, target folder, entry name, path inside it */
function place(path: string): { integration: string; target: string; entry: string; inner: string } | null {
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 2; i++) {
    const integration = INTEGRATIONS[parts[i]];
    const target = TARGETS[parts[i + 1]];
    if (!integration || !target) continue;
    const entry = parts[i + 2];
    if (!/^dr[-_]/.test(entry)) return null;
    return { integration, target, entry, inner: parts.slice(i + 3).join("/") };
  }
  return null;
}

// Every blob ever at a matching path: `git log --raw` lists the old and new blob of each change
const blobs = new Map<string, Set<string>>();
for (const line of git(["log", "--all", "--raw", "--no-abbrev", "--no-renames", "--format="]).split("\n")) {
  const match = /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) \w+\t(.+)$/.exec(line);
  if (!match || !place(match[3])) continue;
  for (const sha of [match[1], match[2]]) {
    if (/^0+$/.test(sha)) continue;
    blobs.set(match[3], (blobs.get(match[3]) ?? new Set()).add(sha));
  }
}

/** sha256 of a blob's content, as computeFileHash in hash-utils.ts gives it (8 hex digits) and in full */
const contentHash = new Map<string, string>();
const shas = [...new Set([...blobs.values()].flatMap((set) => [...set]))];
const batch = spawnSync("git", ["cat-file", "--batch"], { cwd: REPO, input: shas.join("\n") + "\n", maxBuffer: 1 << 30 });
let offset = 0;
const out = batch.stdout as Buffer;
for (const sha of shas) {
  const headerEnd = out.indexOf(10, offset);
  const [, , size] = out.subarray(offset, headerEnd).toString().split(" ");
  const start = headerEnd + 1;
  const content = out.subarray(start, start + Number(size));
  contentHash.set(sha, createHash("sha256").update(content).digest("hex").slice(0, 16));
  offset = start + Number(size) + 1;
}

// integration -> target -> entry -> path inside the entry ("" for a file entry) -> hashes
const table: Record<string, Record<string, Record<string, Record<string, Set<string>>>>> = {};
for (const [path, set] of blobs) {
  const at = place(path)!;
  const byPath = (((table[at.integration] ??= {})[at.target] ??= {})[at.entry] ??= {});
  const hashes = (byPath[at.inner] ??= new Set());
  for (const sha of set) hashes.add(contentHash.get(sha)!);
}

const sorted = (record: Record<string, unknown>) => Object.keys(record).sort();
const lines: string[] = [];
for (const integration of sorted(table)) {
  lines.push(`  ${integration}: {`);
  for (const target of sorted(table[integration])) {
    lines.push(`    ${target}: {`);
    for (const entry of sorted(table[integration][target])) {
      const paths = table[integration][target][entry];
      lines.push(`      ${JSON.stringify(entry)}: {`);
      for (const inner of sorted(paths)) {
        lines.push(`        ${JSON.stringify(inner)}: ${JSON.stringify([...paths[inner]].sort())},`);
      }
      lines.push("      },");
    }
    lines.push("    },");
  }
  lines.push("  },");
}

writeFileSync(
  OUT,
  `/**
 * Every DR-named file and folder a released dr has installed into an integration's folders, with
 * the content of every version it shipped. GENERATED by cli/scripts/generate-shipped-entries.ts
 * from this repository's git history: do not edit; run the script when a release drops or changes
 * an integration file.
 *
 * \`dr upgrade\` offers an entry in a project's \`.claude/\` or \`.github/\` as a leftover of an older
 * layout only when its name is here and its contents are a version listed here
 * (BaseIntegrationManager.findStaleEntries). A name alone is not enough: \`dr-helper.md\` may be the
 * project's own file, and offering it put the project's work one flag away from deletion (PR 1266
 * review).
 *
 * By integration source folder (\`integrations/<name>/\`), then the component's target folder in the
 * project, then the entry's name. Each entry maps the path of a file inside it ("" for an entry
 * that is a file itself) to the first 16 hex digits of the sha256 of every version shipped there.
 */

/** Path inside an entry ("" for a file entry) to the content hashes of every version shipped */
export type ShippedVersions = Readonly<Record<string, readonly string[]>>;

export const SHIPPED_ENTRIES: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, ShippedVersions>>>>>
> = {
${lines.join("\n")}
};

/** The names dr has ever installed in one of an integration's target folders */
export function shippedEntries(integrationSourceDir: string, targetFolder: string): readonly string[] {
  return Object.keys(SHIPPED_ENTRIES[integrationSourceDir]?.[targetFolder] ?? {});
}

/** The versions dr shipped of one entry, or undefined when dr never installed that name there */
export function shippedVersions(
  integrationSourceDir: string,
  targetFolder: string,
  entry: string
): ShippedVersions | undefined {
  return SHIPPED_ENTRIES[integrationSourceDir]?.[targetFolder]?.[entry];
}
`
);
console.log(`Wrote ${OUT}: ${blobs.size} paths, ${shas.length} versions`);
