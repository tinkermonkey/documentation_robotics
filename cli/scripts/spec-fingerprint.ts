/**
 * spec-fingerprint.ts
 *
 * Detects a stale build of the spec-derived files the CLI depends on.
 *
 * The chain is:
 *   spec/dist/  --(scripts/sync-spec-schemas.sh)-->  cli/src/schemas/bundled/
 *               --(generate-registry.ts, generate-validators.ts)-->  cli/src/generated/
 *
 * cli/src/generated/ is git-ignored, so after a pull that changes the spec it
 * silently keeps the old relationship catalog until `npm run build` is run.
 * Tests then fail in ways that look like test drift rather than a stale build.
 *
 * Each generator records a fingerprint of the bundled spec it read into
 * cli/src/generated/spec-fingerprint.json. The test preload recomputes the
 * fingerprints and refuses to run on a mismatch (see tests/spec-freshness.preload.ts).
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

export const SPEC_FINGERPRINT_FILE = "spec-fingerprint.json";

/** Generators that read cli/src/schemas/bundled/ and write cli/src/generated/. */
export const SPEC_GENERATORS = [
  "generate-registry",
  "generate-validators"
] as const;
export type SpecGenerator = (typeof SPEC_GENERATORS)[number];

function listJsonFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), {
    withFileTypes: true
  })) {
    if (entry.name.startsWith(".")) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listJsonFiles(dir, relPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(relPath);
    }
  }
  return out;
}

/**
 * sha256 over every .json file under `dir` (recursive, dotfiles skipped),
 * keyed by relative path so renames and additions change the result.
 * Throws if the directory is missing or holds no .json files.
 */
export function fingerprintSpecDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    throw new Error(`spec directory not found: ${dir}`);
  }
  const files = listJsonFiles(dir).sort();
  if (files.length === 0) {
    throw new Error(`spec directory has no .json files: ${dir}`);
  }
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(dir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Record, for one generator, the fingerprint of the bundled spec it just read.
 * Other generators' entries in the file are preserved.
 */
export function recordGeneratorFingerprint(
  generator: SpecGenerator,
  bundledDir: string,
  generatedDir: string
): void {
  const file = path.join(generatedDir, SPEC_FINGERPRINT_FILE);
  let recorded: Record<string, string> = {};
  if (fs.existsSync(file)) {
    try {
      recorded = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      recorded = {};
    }
  }
  recorded[generator] = fingerprintSpecDir(bundledDir);
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(recorded, null, 2) + "\n");
}

export interface SpecFreshnessPaths {
  /** cli/src/schemas/bundled */
  bundledDir: string;
  /** cli/src/generated */
  generatedDir: string;
  /** spec/dist; skipped when absent (e.g. outside the monorepo) */
  specDistDir?: string;
}

/**
 * Compare spec/dist, the bundled copy and the generated fingerprints.
 * Returns one line per problem; an empty array means everything is in sync.
 */
export function checkSpecFreshness(paths: SpecFreshnessPaths): string[] {
  const problems: string[] = [];

  let bundled: string;
  try {
    bundled = fingerprintSpecDir(paths.bundledDir);
  } catch (error) {
    return [
      `cli/src/schemas/bundled/ is unusable: ${(error as Error).message}`
    ];
  }

  if (paths.specDistDir && fs.existsSync(paths.specDistDir)) {
    let dist: string | undefined;
    try {
      dist = fingerprintSpecDir(paths.specDistDir);
    } catch (error) {
      problems.push(`spec/dist/ is unusable: ${(error as Error).message}`);
    }
    if (dist !== undefined && dist !== bundled) {
      problems.push(
        "cli/src/schemas/bundled/ does not match spec/dist/: the bundled copy is stale " +
          "(spec/dist/ changed since the last sync) or was edited by hand."
      );
    }
  }

  const fingerprintFile = path.join(paths.generatedDir, SPEC_FINGERPRINT_FILE);
  if (!fs.existsSync(fingerprintFile)) {
    problems.push(
      `cli/src/generated/${SPEC_FINGERPRINT_FILE} is missing: cli/src/generated/ was never built ` +
        "or predates this check."
    );
    return problems;
  }

  let recorded: Record<string, unknown>;
  try {
    recorded = JSON.parse(fs.readFileSync(fingerprintFile, "utf-8"));
  } catch (error) {
    problems.push(
      `cli/src/generated/${SPEC_FINGERPRINT_FILE} is unreadable: ${(error as Error).message}`
    );
    return problems;
  }

  const stale = SPEC_GENERATORS.filter((g) => recorded[g] !== bundled);
  if (stale.length > 0) {
    problems.push(
      `cli/src/generated/ is stale: ${stale.join(", ")} last ran against a different ` +
        "cli/src/schemas/bundled/ than the one on disk."
    );
  }

  return problems;
}

/** The message shown when checkSpecFreshness reports problems. */
export function formatSpecFreshnessError(problems: string[]): string {
  return [
    "",
    "STALE BUILD: the spec-derived files the CLI is built from are out of date.",
    ...problems.map((p) => `  - ${p}`),
    "",
    "Fix: run `npm run build` in cli/ (it re-syncs the bundled spec and regenerates cli/src/generated/).",
    "Tests are not run against a stale build because failures would look like test drift.",
    "(Set DR_SKIP_SPEC_FRESHNESS_CHECK=1 to bypass this check.)",
    ""
  ].join("\n");
}
