/**
 * Keeps prettier away from the files dr writes: a project's `documentation-robotics/` folder.
 *
 * dr writes the model (the element files, relationships.yaml, the manifest), the changesets
 * (changes.yaml, metadata.yaml, base-index.json) and the layer reports in its own layout. In a
 * project that runs prettier (often as a pre-commit hook), prettier lays long strings out
 * differently, so each side undoes the other: a commit that touches one of these files fails once
 * while prettier rewrites it, and the next dr write puts every long string back (#1155 for
 * changesets, #1246 for the model). prettier's target is a project's code and documentation, not
 * its DR folder, so `dr init`, `dr upgrade` and their MCP tools call
 * {@link ensurePrettierIgnoresDrFiles}, which lists the whole folder in `.prettierignore` when the
 * project uses prettier.
 *
 * One entry for the folder, not one per sub-folder: everything in it is written by dr, a folder dr
 * adds later is covered without another upgrade, and it is the entry a person would write.
 *
 * prettier reads `.prettierignore` from its working directory, which for hooks and CI is usually
 * the repository root. So the file is written at the git repository root when prettier is
 * configured there, else at the project root (the folder holding `documentation-robotics/`), and
 * the entry is relative to the folder the file is in.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

/** The folder dr writes, relative to the project root. */
export const DR_FOLDER = "documentation-robotics";

/** The comment DR writes above the line it adds. */
const HEADING = "# Documentation Robotics: dr writes the files in this folder in its own layout";

/** The comment dr 0.6.0 wrote above the changesets folder alone (#1155); replaced by {@link HEADING}. */
const EARLIER_HEADING = "# Documentation Robotics: dr writes its changeset files in its own layout";

/** prettier's config file names (https://prettier.io/docs/configuration). */
const CONFIG_FILE = /^(\.prettierrc(\.(json|json5|ya?ml|toml|[cm]?[jt]s))?|prettier\.config\.[cm]?[jt]s)$/;

export interface PrettierIgnoreResult {
  /**
   * `added`: this call added the entry (creating the file when needed); `present`: the file
   * already ignores the folder (by its entry or a folder above it); `not-using-prettier`: no sign
   * of prettier at the project or repository root, nothing written; `missing`: with `dryRun`, the
   * entry would be added, nothing written.
   */
  status: "added" | "present" | "not-using-prettier" | "missing";
  /** The `.prettierignore` written or checked; unset when the project doesn't use prettier. */
  path?: string;
  /**
   * The folder as the ignore file names it, relative to the file's folder, in a list so a result
   * reads the same whether one line was added or more. Unset when the project doesn't use prettier.
   */
  entries?: string[];
  /**
   * DR's own narrower entries that the folder entry replaced: the changesets line dr 0.6.0 wrote
   * under its heading. Never a line the developer wrote.
   */
  replaced?: string[];
  /** What showed prettier is in use, e.g. `.prettierrc.json`, `package.json devDependencies`. */
  signals: string[];
}

/** The git repository root containing a folder, or null outside git (or without git). */
function gitTopLevel(folder: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: folder,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (result.error || result.status !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The signs in one folder that prettier is in use there. */
export async function prettierSignals(folder: string): Promise<string[]> {
  const signals: string[] = [];

  const names = await readdir(folder).catch(() => [] as string[]);
  signals.push(...names.filter((name) => CONFIG_FILE.test(name)).sort());

  const pkgText = await readText(path.join(folder, "package.json"));
  if (pkgText !== null) {
    try {
      const pkg = JSON.parse(pkgText) as Record<string, unknown>;
      if (pkg.prettier !== undefined) signals.push("package.json prettier");
      for (const field of ["dependencies", "devDependencies"]) {
        const deps = pkg[field];
        if (deps && typeof deps === "object" && "prettier" in deps) signals.push(`package.json ${field}`);
      }
    } catch {
      // An unparseable package.json says nothing about prettier.
    }
  }

  const preCommit = await readText(path.join(folder, ".pre-commit-config.yaml"));
  if (preCommit !== null && preCommitRunsPrettier(preCommit)) signals.push(".pre-commit-config.yaml");

  return signals;
}

/** Whether a `.pre-commit-config.yaml` has a prettier hook (by repo URL or hook id). */
function preCommitRunsPrettier(text: string): boolean {
  let config: unknown;
  try {
    config = yaml.parse(text);
  } catch {
    // Unparseable: fall back to an uncommented mention.
    return text.split(/\r?\n/).some((line) => !line.trim().startsWith("#") && /prettier/i.test(line));
  }
  const repos = (config as { repos?: unknown })?.repos;
  if (!Array.isArray(repos)) return false;
  return repos.some((repo) => {
    if (!repo || typeof repo !== "object") return false;
    const { repo: url, hooks } = repo as { repo?: unknown; hooks?: unknown };
    if (typeof url === "string" && /prettier/i.test(url)) return true;
    return (
      Array.isArray(hooks) &&
      hooks.some((hook) => {
        const { id, entry } = (hook ?? {}) as { id?: unknown; entry?: unknown };
        return (typeof id === "string" && /prettier/i.test(id)) || (typeof entry === "string" && /prettier/i.test(entry));
      })
    );
  });
}

/** A `.prettierignore` pattern as a folder path: no anchor, no trailing slash or `/**`. */
function patternFolder(line: string): string {
  return line
    .replace(/^\/+/, "")
    .replace(/(\/\*\*?)+$/, "")
    .replace(/\/+$/, "");
}

/** Whether a pattern ignores the folder: names it or a folder above it. */
function covers(line: string, folder: string): boolean {
  const pattern = patternFolder(line);
  return pattern !== "" && (pattern === folder || folder.startsWith(`${pattern}/`));
}

/**
 * List the folder dr writes in `.prettierignore` when the project uses prettier. Looks for prettier
 * at the git repository root (when the project is in one) and at the project root, writes at the
 * first that has it, and adds `<relative path>/documentation-robotics/` unless a line already
 * ignores that folder or a folder above it. A file that has the block dr 0.6.0 wrote (its heading
 * and the changesets folder) gets that block replaced by the folder entry. A line the developer
 * wrote is never removed or rewritten.
 */
export async function ensurePrettierIgnoresDrFiles(
  projectRoot: string,
  options: { dryRun?: boolean } = {}
): Promise<PrettierIgnoreResult> {
  const project = path.resolve(projectRoot);
  // git prints the repository root with symlinks resolved (macOS /var is /private/var), so the
  // project's place in the repository is worked out on resolved paths.
  const resolvedProject = await realpath(project).catch(() => project);
  const topLevel = gitTopLevel(project);
  const repo = topLevel ? await realpath(topLevel).catch(() => topLevel) : null;
  const inRepo = repo !== null ? path.relative(repo, resolvedProject) : "";

  // The repository root first: hooks and CI run prettier from there.
  const roots =
    repo && inRepo !== "" && !inRepo.startsWith("..") && !path.isAbsolute(inRepo)
      ? [
          { root: repo, prefix: inRepo },
          { root: project, prefix: "" },
        ]
      : [{ root: project, prefix: "" }];
  let chosen: { root: string; prefix: string } | undefined;
  let signals: string[] = [];
  for (const candidate of roots) {
    signals = await prettierSignals(candidate.root);
    if (signals.length > 0) {
      chosen = candidate;
      break;
    }
  }
  if (!chosen) return { status: "not-using-prettier", signals: [] };
  const { root, prefix } = chosen;

  const folder = path.join(prefix, DR_FOLDER).split(path.sep).join("/");
  const entries = [`${folder}/`];
  const file = path.join(root, ".prettierignore");
  const text = (await readText(file)) ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  const isPattern = (line: string) => line !== "" && !line.startsWith("#") && !line.startsWith("!");
  if (lines.map((line) => line.trim()).some((line) => isPattern(line) && covers(line, folder))) {
    return { status: "present", path: file, entries, signals };
  }
  if (options.dryRun) return { status: "missing", path: file, entries, signals };

  // The block an earlier dr wrote: its heading, then its entries for folders inside this one.
  // Those lines are dr's own, so the folder entry takes their place.
  const heading = lines.findIndex((line) => line.trim() === EARLIER_HEADING || line.trim() === HEADING);
  if (heading !== -1) {
    let end = heading + 1;
    while (end < lines.length && isPattern(lines[end].trim()) && patternFolder(lines[end].trim()).startsWith(`${folder}/`)) {
      end++;
    }
    const replaced = lines.slice(heading + 1, end).map((line) => line.trim());
    lines.splice(heading, end - heading, HEADING, ...entries);
    await writeFile(file, lines.join(eol), "utf-8");
    return { status: "added", path: file, entries, ...(replaced.length > 0 ? { replaced } : {}), signals };
  }

  const separator = text === "" || text.endsWith(`${eol}${eol}`) ? "" : text.endsWith(eol) ? eol : `${eol}${eol}`;
  await writeFile(file, `${text}${separator}${HEADING}${eol}${entries.join(eol)}${eol}`, "utf-8");
  return { status: "added", path: file, entries, signals };
}

/**
 * One line for the user when the call added entries, else null.
 *
 * @param relativeTo - name the file relative to this folder (the project root) when it is inside it
 */
export function prettierIgnoreNote(result: PrettierIgnoreResult, relativeTo?: string): string | null {
  if (result.status !== "added" || !result.entries?.length || !result.path) return null;
  // Resolve symlinks on both sides: the repository root comes from git resolved (macOS /var is /private/var)
  const resolved = (folder: string) => {
    try {
      return realpathSync(folder);
    } catch {
      return folder;
    }
  };
  const inside = relativeTo
    ? path.join(path.relative(resolved(relativeTo), resolved(path.dirname(result.path))), path.basename(result.path))
    : result.path;
  const file = inside.startsWith("..") || path.isAbsolute(inside) ? result.path : inside;
  const inPlaceOf = result.replaced?.length ? `, in place of ${result.replaced.join(" and ")}` : "";
  return `Added ${result.entries.join(" and ")} to ${file}${inPlaceOf} so prettier doesn't reformat the files dr writes (commit the .prettierignore change)`;
}

/** What to tell the user to add by hand when the file could not be written. */
export const PRETTIER_IGNORE_BY_HAND = `${DR_FOLDER}/`;
