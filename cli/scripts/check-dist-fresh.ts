/**
 * check-dist-fresh.ts
 *
 * Rebuilds cli/dist/ when it is older than its sources (#1161).
 *
 * Integration and smoke tests spawn dist/cli.js. A guard that built only when
 * dist/cli.js was missing let a local run test whatever dist was last built
 * from, so a change passed locally and failed in CI. This compares
 * dist/cli.js's mtime with the newest file under the inputs below and runs
 * `npm run build` when dist is older. When dist is fresh it only stats files.
 *
 * Usage (from cli/): bun scripts/check-dist-fresh.ts
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface DistFreshnessPaths {
  /** The built entry point whose mtime stands for the whole build. */
  distEntry: string;
  /** Directories whose files the build reads. */
  sourceDirs: string[];
  /** Directories under sourceDirs to skip (written by the build itself). */
  excludeDirs: string[];
}

export interface NewestFile {
  file: string;
  mtimeMs: number;
}

/** The most recently modified file under `dirs`, skipping `excludeDirs` and dotfiles. */
export function newestFile(dirs: string[], excludeDirs: string[] = []): NewestFile | null {
  const excluded = new Set(excludeDirs.map((d) => path.resolve(d)));
  let newest: NewestFile | null = null;
  const walk = (dir: string): void => {
    if (excluded.has(path.resolve(dir))) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const mtimeMs = fs.statSync(full).mtimeMs;
        if (!newest || mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs };
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return newest;
}

/**
 * Why dist needs a rebuild, or null when it is fresh: dist/cli.js is missing,
 * or a source file is newer than it.
 */
export function distStaleReason(paths: DistFreshnessPaths): string | null {
  let distMtime: number;
  try {
    distMtime = fs.statSync(paths.distEntry).mtimeMs;
  } catch {
    return `${paths.distEntry} is missing`;
  }
  const newest = newestFile(paths.sourceDirs, paths.excludeDirs);
  if (newest && newest.mtimeMs > distMtime) {
    return `${newest.file} is newer than ${paths.distEntry}`;
  }
  return null;
}

/** The inputs of `npm run build`, relative to the cli/ directory `cliDir`. */
export function defaultPaths(cliDir: string): DistFreshnessPaths {
  return {
    distEntry: path.join(cliDir, "dist", "cli.js"),
    sourceDirs: [
      path.join(cliDir, "src"),
      path.join(cliDir, "..", "integrations"),
      path.join(cliDir, "..", "spec", "dist")
    ],
    excludeDirs: [path.join(cliDir, "src", "generated")]
  };
}

if (import.meta.main) {
  const cliDir = path.resolve(import.meta.dir, "..");
  const reason = distStaleReason(defaultPaths(cliDir));
  if (reason) {
    const shown = reason
      .replaceAll(cliDir + path.sep, "")
      .replaceAll(path.dirname(cliDir) + path.sep, ".." + path.sep);
    console.log(`dist is stale (${shown}): running npm run build`);
    execSync("npm run build", { cwd: cliDir, stdio: "inherit" });
  }
}
