/**
 * dr-farm-v1 to dr-farm-v2 (`application.applicationfunction.migrate-farm-manifest`,
 * design `docs/design/USER_LEVEL_DR.md` section 6).
 *
 * A dr-farm-v1 farm has one entry per checkout. Entries are grouped by repository (git common
 * directory of `source`); the entry whose `source` is the main checkout names the project, else
 * the main checkout's folder name does. Every other entry in the group is a checkout, which git
 * discovers, so its name is dropped (never kept as an alias). `branch` is dropped.
 */

import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  FARM_SCHEMA_V1,
  FARM_SCHEMA_V2,
  FarmManifest,
  farmPathFor,
  resolveFarmPath,
  type FarmProject,
  type LegacyFarmEntry,
} from "./farm-manifest.js";
import { isProjectName, listCheckouts, resolveRepository, toKebabCase } from "./project-registry.js";

/** One v1 entry as the migration places it. */
export interface MigratedEntry {
  /** The v1 entry's name. */
  entry: string;
  /** The v1 entry's `source`. */
  source: string;
  /** The checkout key git gives the entry's folder (`main` or the worktree's name), when it is in git. */
  checkout?: string;
}

/** A dr-farm-v2 project the migration writes, with the v1 entries it came from. */
export interface MigratedProject {
  project: FarmProject;
  /** The v1 entries the project replaces, the naming one first. */
  entries: MigratedEntry[];
  /** True when the name came from the main checkout's folder (no entry was the main checkout). */
  nameDerived: boolean;
}

/** A v1 name that does not survive: its folder is a checkout of another entry's project. */
export interface DroppedName {
  name: string;
  /** The project whose checkout it is. */
  project: string;
  source: string;
  checkout?: string;
}

/** A problem that stops `--apply`. */
export interface MigrationConflict {
  name: string;
  message: string;
}

export interface FarmMigrationPlan {
  from: string;
  to: typeof FARM_SCHEMA_V2;
  /** True when the farm is already dr-farm-v2: nothing to do. */
  upToDate: boolean;
  projects: MigratedProject[];
  dropped: DroppedName[];
  /** v1 entries whose folder is not a git working tree: kept as projects of their own. */
  notInGit: string[];
  conflicts: MigrationConflict[];
  /** The dr-farm-v2 manifest to write, when there are no conflicts and the farm is not up to date. */
  manifest?: FarmManifest;
}

async function realOrResolved(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

function isWithin(target: string, base: string): boolean {
  return target === base || target.startsWith(base + path.sep);
}

interface Group {
  key: string;
  mainCheckout: string;
  inGit: boolean;
  entries: Array<{ entry: LegacyFarmEntry; full: string; checkout?: string }>;
  /** Checkout path to key, from git. */
  keys?: Map<string, string>;
}

/**
 * Plan the migration of `manifest` (loaded from `farmRoot`). Reads git; writes nothing. Running
 * it on a dr-farm-v2 farm returns `upToDate: true` and no manifest.
 */
export async function migrateFarmManifest(manifest: FarmManifest, farmRoot: string): Promise<FarmMigrationPlan> {
  const plan: FarmMigrationPlan = {
    from: manifest.schema,
    to: FARM_SCHEMA_V2,
    upToDate: manifest.schema === FARM_SCHEMA_V2,
    projects: [],
    dropped: [],
    notInGit: [],
    conflicts: [],
  };
  if (plan.upToDate) return plan;
  if (manifest.schema !== FARM_SCHEMA_V1 || !manifest.legacyEntries) {
    plan.conflicts.push({ name: manifest.name, message: `Cannot migrate farm schema '${manifest.schema}'` });
    return plan;
  }

  // 1. Group the v1 entries by repository, in file order.
  const groups = new Map<string, Group>();
  for (const entry of manifest.legacyEntries.values()) {
    const full = await realOrResolved(resolveFarmPath(farmRoot, entry.source));
    const repository = await resolveRepository(full);
    if (!repository) {
      plan.notInGit.push(entry.name);
      groups.set(`path:${full}`, { key: `path:${full}`, mainCheckout: full, inGit: false, entries: [{ entry, full }] });
      continue;
    }
    let group = groups.get(repository.commonDir);
    if (!group) {
      const checkouts = await listCheckouts(repository);
      group = {
        key: repository.commonDir,
        mainCheckout: repository.mainCheckout,
        inGit: true,
        entries: [],
        keys: new Map(checkouts.map((c) => [c.path, c.key])),
      };
      groups.set(repository.commonDir, group);
    }
    const keys = group.keys;
    let checkout: string | undefined;
    if (keys) {
      // The checkout whose folder holds the entry's source (the deepest one).
      let best: string | undefined;
      for (const [checkoutPath, key] of keys) {
        if (isWithin(full, checkoutPath) && (!best || checkoutPath.length > best.length)) {
          best = checkoutPath;
          checkout = key;
        }
      }
    }
    group.entries.push({ entry, full, checkout });
  }

  // 2-3. Name each project and drop the other names.
  const v2 = FarmManifest.create(manifest.name, {
    platform_view: manifest.platform_view,
    sync: manifest.sync,
  });
  v2.created = manifest.created;
  const taken = new Map<string, string>();

  for (const group of groups.values()) {
    const naming = group.entries.find((e) => e.full === group.mainCheckout);
    const name = naming ? naming.entry.name : toKebabCase(path.basename(group.mainCheckout));
    const first = naming ?? group.entries[0];

    if (!isProjectName(name) && !naming) {
      plan.conflicts.push({
        name,
        message: `Cannot derive a project name from ${group.mainCheckout}: give its main checkout an entry with a name, then migrate`,
      });
      continue;
    }
    const holder = taken.get(name);
    if (holder !== undefined) {
      plan.conflicts.push({
        name,
        message: `Two repositories would be named '${name}' (${holder} and ${group.mainCheckout}): rename one entry, then migrate`,
      });
      continue;
    }
    taken.set(name, group.mainCheckout);

    const repository = naming ? naming.entry.source : farmPathFor(farmRoot, group.mainCheckout);
    const project: FarmProject = {
      name,
      repository,
      model: migratedModel(farmRoot, first.entry.model, first.full, group.mainCheckout),
    };
    const remote = naming?.entry.remote ?? group.entries.find((e) => e.entry.remote)?.entry.remote;
    if (remote) project.remote = remote;

    const ordered = naming ? [naming, ...group.entries.filter((e) => e !== naming)] : group.entries;
    plan.projects.push({
      project,
      nameDerived: !naming,
      entries: ordered.map((e) => ({
        entry: e.entry.name,
        source: e.entry.source,
        ...(e.checkout ? { checkout: e.checkout } : {}),
      })),
    });
    for (const e of ordered) {
      if (e.entry.name === name) continue;
      plan.dropped.push({
        name: e.entry.name,
        project: name,
        source: e.entry.source,
        ...(e.checkout ? { checkout: e.checkout } : {}),
      });
    }
  }

  if (plan.conflicts.length === 0) {
    for (const migrated of plan.projects) {
      v2.projects.set(migrated.project.name, migrated.project);
    }
    plan.manifest = v2;
  }
  return plan;
}

/**
 * The v2 model path for a project whose model the v1 entry at `entryPath` recorded. A model
 * inside a linked worktree's folder moves to the same place in the main checkout (each checkout
 * follows it from there); any other model is kept as written.
 */
function migratedModel(farmRoot: string, model: string, entryPath: string, mainCheckout: string): string {
  if (entryPath === mainCheckout) return model;
  const full = resolveFarmPath(farmRoot, model);
  if (isWithin(full, entryPath)) {
    return farmPathFor(farmRoot, path.join(mainCheckout, path.relative(entryPath, full)));
  }
  return model;
}
