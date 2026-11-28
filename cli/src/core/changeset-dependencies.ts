/**
 * `dependsOn` between staged changesets (#1292). A changeset that depends on another builds on what
 * that one stages: its writes can name the dependency's staged elements, the reads (graph and
 * projection) show them, and it lands only after the dependency has.
 *
 * Which elements resolve is the dependency's staged changes, applied before the changeset's own as
 * if they had landed. This module only finds those changesets and checks the declaration; it never
 * decides how anything is modelled.
 */

import type { Changeset, StagedChange } from "./changeset.js";
import { sequenceOf } from "./changeset.js";
import { StagedChangesetStorage } from "./staged-changeset-storage.js";

/** A dependency the changeset names that cannot be read as a staged changeset. */
export interface MissingDependency {
  id: string;
  /** Why it is not usable: gone, or no longer staged (and so not landed either). */
  reason: string;
  requiredBy: string;
}

export interface DependencyChain {
  /** Staged dependencies, the ones depended on first, each once; never the changeset itself. */
  chain: Changeset[];
  /** Dependencies already landed: their changes are in the base. */
  landed: Changeset[];
  missing: MissingDependency[];
}

/** Loads a changeset by id, null when it is not there. */
async function loadQuietly(storage: StagedChangesetStorage, id: string): Promise<Changeset | null> {
  try {
    return await storage.load(id);
  } catch {
    return null;
  }
}

/**
 * The changesets `changeset` builds on, transitively, in the order they must be applied (a
 * dependency's own dependencies first). A cycle is cut where it closes: each changeset appears once.
 */
export async function loadDependencyChain(storage: StagedChangesetStorage, changeset: Changeset): Promise<DependencyChain> {
  const result: DependencyChain = { chain: [], landed: [], missing: [] };
  if (!changeset.dependsOn?.length) return result;
  const seen = new Set<string>([changeset.id]);
  const visit = async (owner: Changeset): Promise<void> => {
    for (const id of owner.dependsOn ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const dependency = await loadQuietly(storage, id);
      if (!dependency) {
        result.missing.push({ id, reason: "it no longer exists (discarded or deleted)", requiredBy: owner.name });
        continue;
      }
      if (dependency.status === "committed") {
        result.landed.push(dependency);
        continue;
      }
      if (dependency.status !== "staged") {
        result.missing.push({ id, reason: `it is ${dependency.status}, not staged`, requiredBy: owner.name });
        continue;
      }
      await visit(dependency);
      result.chain.push(dependency);
    }
  };
  await visit(changeset);
  return result;
}

/** The staged changes to apply for `changeset`: its dependencies' in order, then its own. */
export function changesWithDependencies(chain: Changeset[], changeset: Changeset): StagedChange[] {
  return [...chain, changeset].flatMap((cs) =>
    (cs.changes as StagedChange[])
      .map((change, index) => ({ change, sequence: sequenceOf(change, index) }))
      .sort((a, b) => a.sequence - b.sequence)
      .map(({ change }) => change)
  );
}

/** The staged changesets that depend on `id`, from metadata alone. */
export async function stagedDependentsOf(storage: StagedChangesetStorage, id: string): Promise<Array<{ id: string; name: string }>> {
  const { summaries } = await storage.listStagedSummaries();
  return summaries.filter((s) => s.id !== id && s.dependsOn?.includes(id)).map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Checks a `dependsOn` declaration and returns the ids it names: each must be a staged changeset
 * other than `selfId`, and none may lead back to `selfId` (a cycle). `resolve` reads a name or id.
 */
export async function resolveDependsOn(
  storage: StagedChangesetStorage,
  resolve: (nameOrId: string) => Promise<Changeset | null>,
  selfId: string | undefined,
  requested: string[],
  /** A reason a changeset cannot be depended on beyond not being staged (a record that never lands). */
  unusable?: (found: Changeset) => Promise<string | null>
): Promise<{ ids: string[]; problems: string[] }> {
  const ids: string[] = [];
  const problems: string[] = [];
  for (const ref of requested) {
    const found = await resolve(ref);
    if (!found) {
      problems.push(`'${ref}' is not a changeset (changeset_list shows the staged ones)`);
      continue;
    }
    if (found.id === selfId) {
      problems.push(`'${found.name}' is this changeset: it cannot depend on itself`);
      continue;
    }
    if (found.status !== "staged") {
      problems.push(`'${found.name}' is ${found.status}: only a staged changeset can be depended on${found.status === "committed" ? " (what it staged is already in the model)" : ""}`);
      continue;
    }
    const why = unusable ? await unusable(found) : null;
    if (why) {
      problems.push(why);
      continue;
    }
    if (!ids.includes(found.id)) ids.push(found.id);
  }
  if (selfId && ids.length > 0) {
    // A cycle: one of the dependencies already depends, through others, on this changeset.
    const { summaries } = await storage.listStagedSummaries();
    const byId = new Map(summaries.map((s) => [s.id, s]));
    for (const id of ids) {
      const stack = [id];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const next of byId.get(current)?.dependsOn ?? []) {
          if (next === selfId) {
            problems.push(`'${byId.get(id)?.name ?? id}' already depends on this changeset, so the two would wait for each other`);
            stack.length = 0;
            break;
          }
          stack.push(next);
        }
      }
    }
  }
  return { ids, problems };
}

/**
 * The dependencies of `changeset` that have not landed, so it cannot yet: those still staged, and
 * those that are gone. `landsFirst` names dependencies the same call lands before it.
 */
export async function unlandedDependencies(
  storage: StagedChangesetStorage,
  changeset: Changeset,
  landsFirst: ReadonlySet<string> = new Set()
): Promise<{ staged: Array<{ id: string; name: string }>; missing: MissingDependency[] }> {
  const { chain, missing } = await loadDependencyChain(storage, changeset);
  return {
    staged: chain.filter((c) => !landsFirst.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    missing,
  };
}
