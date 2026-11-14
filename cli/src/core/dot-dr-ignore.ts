/**
 * Keeps a project's `.dr/` folder out of git.
 *
 * `.dr/` holds the installed spec reference, analyzer state (index jobs, extraction records, the
 * CBM index metadata) and, later, decision-model settings that can carry API keys. All of it is
 * per checkout and recreated by the CLI, so it is git-ignored; `documentation-robotics/` (the model
 * and its changesets) is what a project commits.
 *
 * `dr init`, `dr upgrade` and their MCP tools call {@link ensureDotDrIgnored}: it appends `/.dr/`
 * to the project's `.gitignore` when nothing ignores the folder yet, leaves alone a `.gitignore`
 * that negates it (`!/.dr/` is the developer's choice), and reports files git already tracks under
 * `.dr/`, which an ignore rule does not untrack.
 */

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** The line DR adds, anchored to the project root. */
export const DOT_DR_IGNORE_LINE = "/.dr/";

/** The comment DR writes above the line it adds. */
const HEADING = "# Documentation Robotics: per-checkout spec reference and analyzer state (recreated by the CLI)";

export interface DotDrIgnoreResult {
  /** The project's `.gitignore`. */
  path: string;
  /** Whether this call appended {@link DOT_DR_IGNORE_LINE} (creating the file when needed). */
  added: boolean;
  /**
   * Whether `.dr/` is ignored after the call. From `git check-ignore` inside a git work tree
   * (which also sees parent `.gitignore` files, `info/exclude` and the global excludes file);
   * outside git, from the project's own `.gitignore`.
   */
  ignored: boolean;
  /** The project's `.gitignore` negates `.dr/`; left as the developer wrote it. */
  negated: boolean;
  /** Files under `.dr/` git already tracks. An ignore rule doesn't untrack them. */
  trackedFiles: number;
  /** Whether git answered (the project is in a git work tree and git is installed). */
  gitChecked: boolean;
}

function git(projectRoot: string, args: string[]): { status: number | null; stdout: string } | null {
  try {
    const result = spawnSync("git", args, { cwd: projectRoot, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    if (result.error) return null;
    return { status: result.status, stdout: result.stdout ?? "" };
  } catch {
    return null;
  }
}

/** True inside a git work tree with git installed. */
function inGitWorkTree(projectRoot: string): boolean {
  const result = git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  return result?.status === 0 && result.stdout.trim() === "true";
}

/** git's verdict on `.dr/`: true ignored, false not ignored, null when git couldn't say. */
function gitSaysIgnored(projectRoot: string): boolean | null {
  // Exit 0: ignored; 1: not ignored; anything else: an error.
  const result = git(projectRoot, ["check-ignore", "-q", "--no-index", ".dr/"]);
  if (result?.status === 0) return true;
  if (result?.status === 1) return false;
  return null;
}

function trackedUnderDotDr(projectRoot: string): number {
  const result = git(projectRoot, ["ls-files", "--", ".dr"]);
  if (!result || result.status !== 0) return 0;
  return result.stdout.split("\n").filter((line) => line.trim()).length;
}

/** The folder a `.gitignore` pattern names, without anchors or a trailing slash. */
function patternFolder(line: string): string {
  return line.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Make sure the project's `.dr/` is git-ignored. Appends `/.dr/` to `<projectRoot>/.gitignore`
 * (creating it) unless git (or, outside git, that file) already ignores the folder, or the file
 * negates it. Never removes or rewrites the developer's lines, and never untracks files.
 */
export async function ensureDotDrIgnored(projectRoot: string): Promise<DotDrIgnoreResult> {
  const file = path.join(projectRoot, ".gitignore");
  let text = "";
  try {
    text = await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const negated = lines.some((line) => line.startsWith("!") && patternFolder(line.slice(1)) === ".dr");
  const listed = lines.some((line) => !line.startsWith("!") && patternFolder(line) === ".dr");

  const gitChecked = inGitWorkTree(projectRoot);
  const before = gitChecked ? gitSaysIgnored(projectRoot) : null;
  const alreadyIgnored = before ?? (listed && !negated);

  let added = false;
  if (!alreadyIgnored && !negated) {
    const separator = text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(file, `${text}${separator}${HEADING}\n${DOT_DR_IGNORE_LINE}\n`, "utf-8");
    added = true;
  }

  const after = gitChecked ? gitSaysIgnored(projectRoot) : null;
  return {
    path: file,
    added,
    ignored: after ?? (alreadyIgnored || added),
    negated,
    trackedFiles: gitChecked ? trackedUnderDotDr(projectRoot) : 0,
    gitChecked,
  };
}

/**
 * Notes for the user about the result, one per problem (empty when `.dr/` is ignored and
 * nothing under it is tracked).
 */
export function dotDrIgnoreWarnings(result: DotDrIgnoreResult): string[] {
  const warnings: string[] = [];
  if (result.negated) {
    warnings.push(
      `${result.path} un-ignores .dr/ (a "!" line), so DR left it alone. .dr/ holds per-checkout state and should not be committed.`
    );
  } else if (!result.ignored) {
    warnings.push(
      `.dr/ is still not git-ignored after adding ${DOT_DR_IGNORE_LINE} to ${result.path}: another ignore file un-ignores it.`
    );
  }
  if (result.trackedFiles > 0) {
    warnings.push(
      `git tracks ${result.trackedFiles} file(s) under .dr/, which an ignore rule doesn't untrack. Untrack them with: git rm -r --cached .dr`
    );
  }
  return warnings;
}
