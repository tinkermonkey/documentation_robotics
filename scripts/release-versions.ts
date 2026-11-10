/**
 * Checks, and optionally sets, every place the CLI and spec versions live, so a release
 * can't ship with one of them stale.
 *
 * Usage (from the repo root):
 *   npx tsx scripts/release-versions.ts                          check the tree is consistent
 *   npx tsx scripts/release-versions.ts --cli 0.4.0 --spec 0.12.0  check against the target versions
 *   npx tsx scripts/release-versions.ts --set --cli 0.4.0 [--spec 0.12.0]
 *                                                                write the hand-edited locations
 *   add --remote to also check tags on origin, the npm registry and the latest viewer release
 *
 * Without --cli/--spec the targets are cli/package.json's version and spec/VERSION.
 *
 * --set writes only the locations a person edits: cli/package.json and its lockfile (through
 * `npm version`), the plugin manifest, the README badges, CLAUDE.md, spec/VERSION and the test
 * baseline's manifest. Generated locations (spec/dist, the CLI's bundled schemas,
 * BUNDLED_SPEC_VERSION) come from `npm run build:spec` and `npm run build` in cli/. Changelog
 * sections and migration-registry entries are written by hand. The check reports all of them.
 *
 * Exit code 1 when any check fails.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const PATHS = {
  cliPackage: "cli/package.json",
  cliLock: "cli/package-lock.json",
  pluginManifest: "integrations/claude_code/.claude-plugin/plugin.json",
  readme: "README.md",
  claudeMd: "CLAUDE.md",
  specVersion: "spec/VERSION",
  specDist: "spec/dist",
  bundled: "cli/src/schemas/bundled",
  specVersionTs: "cli/src/utils/spec-version.ts",
  baselineManifest: "cli-validation/test-project/baseline/documentation-robotics/model/manifest.yaml",
  migrationRegistry: "cli/src/core/migration-registry.ts",
  cliChangelog: "cli/CHANGELOG.md",
  specChangelog: "spec/CHANGELOG.md",
  viewerScript: "cli/scripts/download-viewer.sh",
} as const;

interface Args {
  cli?: string;
  spec?: string;
  set: boolean;
  remote: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { set: false, remote: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--set") args.set = true;
    else if (arg === "--remote") args.remote = true;
    else if (arg === "--cli" || arg === "--spec") {
      const value = argv[++i];
      if (!value || !SEMVER.test(value)) fail(`${arg} needs a version like 1.2.3, got ${value ?? "nothing"}`);
      args[arg === "--cli" ? "cli" : "spec"] = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf-8").split("*/")[0]);
      process.exit(0);
    } else fail(`unknown argument ${arg}`);
  }
  if (args.set && !args.cli && !args.spec) fail("--set needs --cli and/or --spec");
  return args;
}

function fail(message: string): never {
  console.error(`release-versions: ${message}`);
  process.exit(2);
}

const read = (path: string) => readFileSync(join(root, path), "utf-8");
const write = (path: string, content: string) => writeFileSync(join(root, path), content);

// ---------------------------------------------------------------------------------------------
// Reading the current values
// ---------------------------------------------------------------------------------------------

function match(path: string, pattern: RegExp): string | undefined {
  return read(path).match(pattern)?.[1];
}

function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) out.push(...jsonFilesUnder(rel));
    else if (entry.endsWith(".json")) out.push(rel);
  }
  return out;
}

/** Distinct specVersion values across a directory of compiled spec files, with the files per value. */
function specVersionsIn(dir: string): Map<string, string[]> {
  const byVersion = new Map<string, string[]>();
  for (const file of jsonFilesUnder(dir)) {
    const version = (JSON.parse(read(file)) as { specVersion?: string }).specVersion;
    if (version === undefined) continue;
    byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
  }
  return byVersion;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function latestMigrationTarget(): string | undefined {
  const versions = [...read(PATHS.migrationRegistry).matchAll(/toVersion:\s*"([^"]+)"/g)].map((m) => m[1]);
  return versions.sort(compareVersions).at(-1);
}

/** The body of a `## [version]` section, or undefined when the changelog has none. */
function changelogSection(path: string, version: string): string | undefined {
  const lines = read(path).split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## ["));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function duplicateHeadings(section: string): string[] {
  const seen = new Map<string, number>();
  for (const line of section.split("\n")) {
    const heading = line.match(/^### (.+?)\s*$/)?.[1];
    if (heading) seen.set(heading, (seen.get(heading) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([heading]) => heading);
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

interface Row {
  location: string;
  found: string;
  ok: boolean;
  fix?: string;
}

const rows: Row[] = [];
const notes: string[] = [];

function expect(location: string, found: string | undefined, expected: string, fix?: string): void {
  rows.push({ location, found: found ?? "(missing)", ok: found === expected, fix });
}

function check(location: string, ok: boolean, found: string, fix?: string): void {
  rows.push({ location, found, ok, fix });
}

function checkCli(cli: string, spec: string): void {
  const pkg = JSON.parse(read(PATHS.cliPackage)) as { version: string };
  const lock = JSON.parse(read(PATHS.cliLock)) as { version: string; packages?: Record<string, { version?: string }> };
  const plugin = JSON.parse(read(PATHS.pluginManifest)) as { version?: string };
  const npmVersion = "run `npm version <v> --no-git-tag-version` in cli/ (or --set)";

  expect(PATHS.cliPackage, pkg.version, cli, npmVersion);
  expect(`${PATHS.cliLock} (version)`, lock.version, cli, npmVersion);
  expect(`${PATHS.cliLock} (packages[""])`, lock.packages?.[""]?.version, cli, npmVersion);
  expect(`${PATHS.pluginManifest} (version)`, plugin.version, cli, "--set writes it");
  expect(`${PATHS.readme} (CLI badge)`, match(PATHS.readme, /badge\/CLI-v([^-]+)-/), cli, "--set writes it");
  expect(`${PATHS.claudeMd} (Current Versions, CLI)`, match(PATHS.claudeMd, /\*\*Current Versions:\*\* CLI v(\S+?),/), cli, "--set writes it");

  const section = changelogSection(PATHS.cliChangelog, cli);
  check(`${PATHS.cliChangelog} ## [${cli}]`, section !== undefined, section ? "present" : "(missing)", "move [Unreleased] entries into a dated section");
  if (section !== undefined) {
    const support = section.match(/\*\*Specification Support:\*\*\s*v(\S+)/)?.[1];
    expect(`${PATHS.cliChangelog} [${cli}] Specification Support`, support, spec, `add **Specification Support:** v${spec}`);
    const dupes = duplicateHeadings(section);
    check(`${PATHS.cliChangelog} [${cli}] headings`, dupes.length === 0, dupes.length ? `duplicate: ${dupes.join(", ")}` : "no duplicates", "merge the duplicate headings");
  }
}

function checkSpec(spec: string): void {
  const generated = (cmd: string) => `generated: run ${cmd}`;
  expect(PATHS.specVersion, read(PATHS.specVersion).trim(), spec, "--set writes it");

  for (const [dir, cmd] of [
    [PATHS.specDist, "`npm run build:spec` at the root"],
    [PATHS.bundled, "`npm run build` in cli/"],
  ] as const) {
    const versions = specVersionsIn(dir);
    const found = [...versions.keys()];
    const stale = [...versions].filter(([v]) => v !== spec).flatMap(([, files]) => files);
    const total = [...versions.values()].flat().length;
    const staleText =
      stale.length === 0 ? "" : stale.length === total ? ` (all ${total} files)` : ` (stale: ${stale.map((f) => relative(dir, f)).join(", ")})`;
    check(
      `${dir}/**/*.json (specVersion)`,
      found.length === 1 && found[0] === spec,
      found.length ? found.join(", ") + staleText : "(none)",
      generated(cmd)
    );
  }

  expect(`${PATHS.specVersionTs} (BUNDLED_SPEC_VERSION)`, match(PATHS.specVersionTs, /BUNDLED_SPEC_VERSION = "([^"]+)"/), spec, generated("`npm run build` in cli/"));
  expect(`${PATHS.readme} (Specification badge)`, match(PATHS.readme, /badge\/Specification-v([^-]+)-/), spec, "--set writes it");
  expect(`${PATHS.claudeMd} (Current Versions, Spec)`, match(PATHS.claudeMd, /\*\*Current Versions:\*\* CLI v\S+, Spec v(\S+)/), spec, "--set writes it");
  expect(`${PATHS.baselineManifest} (spec_version)`, match(PATHS.baselineManifest, /^spec_version:\s*"?([^"\s]+)"?/m), spec, "--set writes it");
  expect(`${PATHS.migrationRegistry} (latest toVersion)`, latestMigrationTarget(), spec, "add a migration entry to the new spec version");

  const section = changelogSection(PATHS.specChangelog, spec);
  check(`${PATHS.specChangelog} ## [${spec}]`, section !== undefined, section ? "present" : "(missing)", "move [Unreleased] entries into a dated section");
  if (section !== undefined) {
    const dupes = duplicateHeadings(section);
    check(`${PATHS.specChangelog} [${spec}] headings`, dupes.length === 0, dupes.length ? `duplicate: ${dupes.join(", ")}` : "no duplicates", "merge the duplicate headings");
  }
}

function checkUnreleased(): void {
  for (const path of [PATHS.cliChangelog, PATHS.specChangelog]) {
    const section = changelogSection(path, "Unreleased");
    check(`${path} ## [Unreleased]`, section !== undefined, section !== undefined ? "present" : "(missing)", "keep an empty [Unreleased] section above the release");
  }
}

function run(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function checkRemote(cli: string, spec: string): void {
  for (const tag of [`cli-v${cli}`, `spec-v${spec}`]) {
    const remote = run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
    if (remote === undefined) {
      check(`origin tag ${tag}`, false, "(could not reach origin)");
    } else if (tag.startsWith("cli-")) {
      check(`origin tag ${tag}`, remote === "", remote === "" ? "free" : "already exists", "a stale tag blocks the release: inspect it before deleting");
    } else {
      // A spec tag that already exists is fine when the spec isn't changing in this release.
      notes.push(remote === "" ? `${tag} is free.` : `${tag} already exists: fine if the spec is unchanged, otherwise inspect it.`);
    }
  }

  const published = run("npm", ["view", "@documentation-robotics/cli", "version"]);
  if (published === undefined) check("npm @documentation-robotics/cli", false, "(could not reach npm)");
  else check("npm @documentation-robotics/cli", compareVersions(cli, published) > 0, `published ${published}`, `${cli} must be newer than what is published`);

  const viewer = match(PATHS.viewerScript, /VIEWER_VERSION="([^"]+)"/);
  const latestViewer = run("gh", ["release", "view", "--repo", "tinkermonkey/documentation_robotics_viewer", "--json", "tagName", "-q", ".tagName"]);
  notes.push(
    `Bundled viewer ${viewer ?? "(unknown)"}; latest viewer release ${latestViewer ?? "(could not read)"}.` +
      (latestViewer && viewer && latestViewer.replace(/^v/, "") !== viewer ? " Decide whether to bump VIEWER_VERSION." : "")
  );
}

// ---------------------------------------------------------------------------------------------
// Setting
// ---------------------------------------------------------------------------------------------

function replaceIn(path: string, pattern: RegExp, replacement: string): void {
  const before = read(path);
  if (!pattern.test(before)) fail(`${path}: pattern ${pattern} not found; edit it by hand`);
  write(path, before.replace(pattern, replacement));
}

function setVersions(cli?: string, spec?: string): void {
  if (cli) {
    execFileSync("npm", ["version", cli, "--no-git-tag-version", "--allow-same-version"], { cwd: join(root, "cli"), stdio: "ignore" });
    // Edit the text rather than re-serialize, so the manifest keeps its formatting.
    const manifest = read(PATHS.pluginManifest);
    if (/^\s*"version":/m.test(manifest)) replaceIn(PATHS.pluginManifest, /("version":\s*)"[^"]*"/, `$1"${cli}"`);
    else replaceIn(PATHS.pluginManifest, /^(\s*)("name":\s*"[^"]*",)$/m, `$1$2\n$1"version": "${cli}",`);
    replaceIn(PATHS.readme, /badge\/CLI-v[^-]+-/, `badge/CLI-v${cli}-`);
    replaceIn(PATHS.claudeMd, /(\*\*Current Versions:\*\* CLI v)\S+?,/, `$1${cli},`);
  }
  if (spec) {
    write(PATHS.specVersion, spec + "\n");
    replaceIn(PATHS.readme, /badge\/Specification-v[^-]+-/, `badge/Specification-v${spec}-`);
    replaceIn(PATHS.claudeMd, /(\*\*Current Versions:\*\* CLI v\S+, Spec v)\S+/, `$1${spec}`);
    replaceIn(PATHS.baselineManifest, /^spec_version:.*$/m, `spec_version: ${spec}`);
  }
  console.log(`Set${cli ? ` CLI ${cli}` : ""}${spec ? ` spec ${spec}` : ""}. Still to do by hand or by build:`);
  if (spec) console.log("  - npm run build:spec (root), then npm run build (cli/)");
  if (spec) console.log("  - a migration-registry entry to the new spec version, and the upgrade tests' expected version");
  console.log("  - changelog sections" + (cli ? " (with **Specification Support:**)" : ""));
  console.log("");
}

// ---------------------------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
if (args.set) setVersions(args.cli, args.spec);

const cliTarget = args.cli ?? (JSON.parse(read(PATHS.cliPackage)) as { version: string }).version;
const specTarget = args.spec ?? read(PATHS.specVersion).trim();
if (!existsSync(join(root, PATHS.pluginManifest))) fail(`${PATHS.pluginManifest} not found`);

checkCli(cliTarget, specTarget);
checkSpec(specTarget);
checkUnreleased();
if (args.remote) checkRemote(cliTarget, specTarget);

console.log(`Release versions: CLI ${cliTarget}, spec ${specTarget}\n`);
const width = Math.max(...rows.map((r) => r.location.length));
for (const row of rows) {
  const line = `${row.ok ? "ok  " : "FAIL"}  ${row.location.padEnd(width)}  ${row.found}`;
  console.log(row.ok || !row.fix ? line : `${line}  -> ${row.fix}`);
}
for (const note of notes) console.log(`note  ${note}`);

const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${failed === 0 ? "All version locations agree." : `${failed} problem(s).`}`);
process.exit(failed === 0 ? 0 : 1);
