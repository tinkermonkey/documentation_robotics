import { mkdirSync, readdirSync } from "node:fs";
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

/** Decisions are stored per backend and per layer: data/triage/decisions/<backend[@tag]>/<layer>.jsonl */
export function decisionsDir(backendKey: string): string {
  const dir = path.join(harnessDir(), "data", "triage", "decisions", backendKey);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function listDecisionBackends(): string[] {
  const root = path.join(harnessDir(), "data", "triage", "decisions");
  try {
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}
