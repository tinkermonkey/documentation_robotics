import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load the nearest `.env` file (walking up from cwd) into process.env.
 * Existing environment variables win. Values are never logged.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      for (const rawLine of readFileSync(candidate, "utf8").split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function requireEnv(name: string, hint: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. ${hint}`);
  }
  return v;
}

/** Repository root (three levels above this harness directory). */
export function repoRoot(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..", "..", "..");
}

/** Harness directory (cli/scripts/classify-eval). */
export function harnessDir(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..");
}
