import { mkdirSync } from "node:fs";
import path from "node:path";

/** This package's directory (cli/scripts/spec-enrich). */
export function harnessDir(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..");
}

export function proposalsDir(kind: "nodes" | "relationships", layer: string): string {
  const dir = path.join(harnessDir(), "data", "proposals", kind, layer);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureDataDirs(): void {
  mkdirSync(path.join(harnessDir(), "data", "batches"), { recursive: true });
}
