/**
 * Keeps a project's `.dr/` folder out of git.
 *
 * `.dr/` holds the installed spec reference, analyzer state (index jobs, extraction records, the
 * CBM index metadata) and, later, decision-model settings that can carry API keys. All of it is
 * per checkout and recreated by the CLI, so it is git-ignored; `documentation-robotics/` (the model
 * and its changesets) is what a project commits.
 *
 * `dr init`, `dr upgrade` and their MCP tools call {@link ensureDotDrIgnored}: it writes `/.dr/`
 * to the project's `.gitignore` when nothing ignores the folder yet, in place of any `.dr` rule or
 * comment the file already has, and leaves alone a `.gitignore` that negates it (`!/.dr/` is the
 * developer's choice).
 *
 * When git already tracks files under `.dr/`, an ignore rule alone leaves the repository in a half
 * state: the files stay tracked and modified, and `git add .dr` refuses them (#1185). So that case
 * is a decision for a person ({@link DotDrIgnoreResult.decision}), and nothing is written until the
 * caller passes their choice: untrack the files, keep them tracked (ignore the rest of `.dr/`), or
 * leave everything as it is.
 */

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** The line DR adds, anchored to the project root. */
export const DOT_DR_IGNORE_LINE = "/.dr/";

/** The comment DR writes above the line it adds. */
const HEADING = "# Documentation Robotics: per-checkout spec reference and analyzer state (recreated by the CLI)";

/** The comment above the lines that keep some of `.dr/` tracked. */
const KEEP_HEADING =
  "# Documentation Robotics: .dr/ is per-checkout state; only the paths re-included below stay tracked";

/** The pattern that ignores what is in `.dr/` without ignoring the folder, so paths in it can be re-included. */
const DOT_DR_CONTENTS_LINE = "/.dr/*";

/** What to do about the files git tracks under `.dr/`. */
export type DotDrTrackedChoice = "untrack" | "keep-tracked" | "skip";

export const DOT_DR_TRACKED_CHOICES: readonly DotDrTrackedChoice[] = ["untrack", "keep-tracked", "skip"];

/** How many tracked files the decision's lines name by default; the decision itself holds them all. */
export const DOT_DR_FILES_SHOWN = 10;

/** A choice the caller takes to the user: git tracks files under `.dr/`. */
export interface DotDrDecision {
  /** Files git tracks under `.dr/` that an ignore rule covers, or would. */
  wouldIgnoreTracked: number;
  /** All of them, by path. */
  files: string[];
  /** `.dr/` is already ignored: an earlier run added the rule and left the files tracked. */
  alreadyIgnored: boolean;
  /**
   * Each choice, what it means for the next commit, and exactly what it changes: the rule lines
   * it writes to `.gitignore` (`writes`), the lines about `.dr` already there that they replace
   * (`replaces`), and how many files it removes from git's index (`untracks`). `skip` has none.
   */
  options: Array<{
    choice: DotDrTrackedChoice;
    effect: string;
    writes?: string[];
    replaces?: string[];
    untracks?: number;
  }>;
}

export interface DotDrIgnoreResult {
  /** The project's `.gitignore`. */
  path: string;
  /** Whether this call wrote DR's lines to the file (creating it when needed). */
  added: boolean;
  /** With `dryRun`: the call would write DR's lines. */
  wouldAdd?: boolean;
  /** With `dryRun`: the rule lines it would write (`/.dr/`, or `/.dr/*` and the re-include lines). */
  wouldWrite?: string[];
  /** With `dryRun` and `untrack`: how many files it would remove from git's index. */
  wouldUntrack?: number;
  /**
   * Whether `.dr/` is ignored after the call. From `git check-ignore` inside a git work tree
   * (which also sees parent `.gitignore` files, `info/exclude` and the global excludes file);
   * outside git, from the project's own `.gitignore`.
   */
  ignored: boolean;
  /** The project's `.gitignore` negates `.dr/`; left as the developer wrote it. */
  negated: boolean;
  /** Files under `.dr/` git tracks after the call. */
  trackedFiles: number;
  /** Whether git answered (the project is in a git work tree and git is installed). */
  gitChecked: boolean;
  /**
   * Set when git tracks files under `.dr/` and no choice was passed: nothing was changed. Put it
   * to the user and call again with their choice.
   */
  decision?: DotDrDecision;
  /** The choice this call applied. */
  applied?: DotDrTrackedChoice;
  /** With `untrack`: how many files were removed from the index (they stay on disk). */
  untracked?: number;
  /** With `keep-tracked`: the re-include lines written, one per tracked path directly under `.dr/`. */
  keptTracked?: string[];
  /** The `.dr` rules and comments already in the file that DR's lines replaced (with `dryRun`: would replace). */
  replaced?: string[];
}

export interface DotDrIgnoreOptions {
  /** The user's choice when git tracks files under `.dr/`. Without it that case changes nothing. */
  tracked?: DotDrTrackedChoice;
  /** Report what the call would do; write nothing. */
  dryRun?: boolean;
}

/** How many times a git call that failed to run is tried before the failure is reported */
const GIT_ATTEMPTS = 3;

/**
 * Run git in the project. Null means git is not installed, which callers read as "not a git
 * repository". Any other failure to run it (a timeout, a spawn error on a loaded machine) is
 * retried and then thrown: what git tracks under `.dr/` decides whether an ignore rule is safe to
 * write, so "git did not answer" must never be taken for "git tracks nothing".
 */
function git(projectRoot: string, args: string[]): { status: number | null; stdout: string; stderr: string } | null {
  let failure: Error | undefined;
  for (let attempt = 0; attempt < GIT_ATTEMPTS; attempt++) {
    const result = spawnSync("git", args, { cwd: projectRoot, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    if (!result.error) return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") return null;
    failure = result.error;
  }
  throw new Error(`git ${args[0]} did not run: ${failure?.message ?? "unknown error"}`);
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

/** The files git tracks under `.dr/`, relative to the project root. */
function trackedUnderDotDr(projectRoot: string): string[] {
  const result = git(projectRoot, ["ls-files", "--", ".dr"]);
  if (!result) return [];
  // Inside a work tree this always succeeds: a failure is not "nothing is tracked"
  if (result.status !== 0) {
    throw new Error(`git ls-files could not list what is tracked under .dr/: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The path a `.gitignore` pattern names, without its negation, anchors or a trailing slash. */
function patternPath(line: string): string {
  return line.replace(/^!/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/** Whether a `.gitignore` line (not a comment) is a rule about `.dr` or something in it. */
function isDotDrRule(line: string): boolean {
  const pattern = patternPath(line.trim());
  return pattern === ".dr" || pattern.startsWith(".dr/");
}

/**
 * Whether a comment line names the `.dr` folder or a path in it: a word that is `.dr`, `.dr/`,
 * `/.dr/` or `.dr/spec` once the punctuation around it is set aside. `.dr-version`, `.drawio` and
 * `*.dr` (a file extension) are other things, and a comment about them is left alone.
 */
function commentNamesDotDr(line: string): boolean {
  return line
    .replace(/^#+/, "")
    .split(/\s+/)
    .map((word) => word.replace(/^[`'"(\[{<]+/, "").replace(/[`'")\]}>,.;:!?]+$/, ""))
    .some((word) => /^!?\/?\.dr(\/\S*)?$/.test(word));
}

/** The lines of a `.gitignore` that are about `.dr`: its rules, DR's own headings, and comments naming the folder. */
function dotDrLineIndexes(lines: string[]): number[] {
  const indexes: number[] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("#") ? line === HEADING || line === KEEP_HEADING || commentNamesDotDr(line) : isDotDrRule(line)) {
      indexes.push(index);
    }
  });
  return indexes;
}

/** The re-include lines that keep the tracked files tracked: one per path directly under `.dr/`. */
function keepLines(tracked: string[]): string[] {
  const kept = new Set<string>();
  for (const file of tracked) {
    const [, first, ...rest] = file.split("/");
    if (first) kept.add(rest.length > 0 ? `!/.dr/${first}/` : `!/.dr/${first}`);
  }
  return [...kept].sort();
}

/** What a choice would change, as a decision's option carries it */
type ChoiceChanges = { writes?: string[]; replaces?: string[]; untracks?: number };

function decisionFor(
  tracked: string[],
  alreadyIgnored: boolean,
  changes: Record<"untrack" | "keep-tracked", ChoiceChanges>
): DotDrDecision {
  const n = tracked.length;
  return {
    wouldIgnoreTracked: n,
    files: tracked,
    alreadyIgnored,
    options: [
      {
        choice: "untrack",
        ...changes.untrack,
        effect: `Ignore .dr/ and remove its ${n} file(s) from git's index (git rm -r --cached .dr; they stay on disk). The removals are staged, so the next commit drops them from the repository, and each checkout recreates .dr/ with dr. Stage the rest of the upgrade with git add -A: git refuses git add .dr once the folder is ignored.`,
      },
      {
        choice: "keep-tracked",
        ...changes["keep-tracked"],
        effect: `Keep the ${n} file(s) tracked: .gitignore ignores the rest of .dr/ (${DOT_DR_CONTENTS_LINE}) and re-includes the tracked paths, so git add .dr stages them and nothing else. Every dr upgrade then shows up as a change to them.`,
      },
      {
        choice: "skip",
        effect: alreadyIgnored
          ? `Leave .gitignore and the index as they are: the ${n} file(s) stay tracked under a rule that ignores them, so git add .dr refuses them (git add -u .dr still stages their changes).`
          : `Leave .gitignore and the index as they are: .dr/ stays unignored, and anything dr writes there shows up as untracked.`,
      },
    ],
  };
}

/**
 * Make sure the project's `.dr/` is git-ignored. Writes `/.dr/` to `<projectRoot>/.gitignore`
 * (creating it) unless git (or, outside git, that file) already ignores the folder, or the file
 * negates it. Any `.dr` rule or comment already in the file is replaced, not added to
 * (`replaced` lists them); no other line is touched.
 *
 * When git tracks files under `.dr/`, nothing is written without `options.tracked`: the result
 * carries the `decision` to put to the user. With it, `untrack` writes the rule and removes the
 * files from the index, `keep-tracked` ignores the rest of `.dr/` and re-includes the tracked
 * paths, and `skip` changes nothing.
 */
export async function ensureDotDrIgnored(
  projectRoot: string,
  options: DotDrIgnoreOptions = {}
): Promise<DotDrIgnoreResult> {
  const file = path.join(projectRoot, ".gitignore");
  let text = "";
  try {
    text = await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rawLines = text.split(/\r?\n/);
  const rules = rawLines.map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const negated = rules.some((line) => line.startsWith("!") && patternPath(line) === ".dr");
  const listed = rules.some((line) => !line.startsWith("!") && patternPath(line) === ".dr");
  // `/.dr/*` with re-included paths: the tracked files were kept on purpose (keep-tracked, or by hand)
  const keepsSome =
    rules.some((line) => !line.startsWith("!") && /^\.dr\/\*\*?$/.test(patternPath(line))) &&
    rules.some((line) => line.startsWith("!") && patternPath(line).startsWith(".dr/"));

  const gitChecked = inGitWorkTree(projectRoot);
  const before = gitChecked ? gitSaysIgnored(projectRoot) : null;
  const alreadyIgnored = before ?? (listed && !negated);
  const tracked = gitChecked ? trackedUnderDotDr(projectRoot) : [];

  const result: DotDrIgnoreResult = {
    path: file,
    added: false,
    ignored: alreadyIgnored,
    negated,
    trackedFiles: tracked.length,
    gitChecked,
  };
  // The developer's own arrangement: `!/.dr/`, or `/.dr/*` with paths re-included
  if (negated || keepsSome) {
    return { ...result, ignored: keepsSome ? true : result.ignored };
  }

  // The file's own lines about .dr, which DR's block takes the place of
  const indexes = dotDrLineIndexes(rawLines);
  const existing = indexes.map((index) => rawLines[index].trim());

  /** The existing lines a block takes the place of: the ones that are not themselves in the block */
  const replacedBy = (block: string[]): string[] => existing.filter((line) => !block.includes(line));

  /** Put DR's block where the file's `.dr` lines were (or at its end) and write it. */
  const writeBlock = async (block: string[]): Promise<void> => {
    if (indexes.length === 0) {
      const separator = text === "" || text.endsWith(`${eol}${eol}`) ? "" : text.endsWith(eol) ? eol : `${eol}${eol}`;
      await writeFile(file, `${text}${separator}${block.join(eol)}${eol}`, "utf-8");
      return;
    }
    const drop = new Set(indexes);
    const lines = rawLines.flatMap((line, index) => (index === indexes[0] ? block : drop.has(index) ? [] : [line]));
    await writeFile(file, lines.join(eol) + (text.endsWith(eol) || lines[lines.length - 1] === "" ? "" : eol), "utf-8");
  };
  const withReplaced = (replaced: string[]) => (replaced.length > 0 ? { replaced } : {});
  /** What a dry run says a block would do: the rule lines written, and the lines they replace */
  const wouldWrite = (block: string[]) => ({
    wouldAdd: true,
    wouldWrite: block.filter((line) => !line.startsWith("#")),
    ...withReplaced(replacedBy(block)),
  });

  const ignoreBlock = [HEADING, DOT_DR_IGNORE_LINE];
  // Lines here that say something else about .dr than "ignore the folder": a comment that is not
  // DR's heading (a note that the spec pin stays tracked, say), or a rule for a path inside it.
  // With them the file contradicts an untrack even when git already ignores the folder (#1185).
  const saysOtherwise = existing.some((line) =>
    line.startsWith("#") ? line !== HEADING : patternPath(line) !== ".dr"
  );

  if (tracked.length > 0) {
    const choice = options.tracked;
    if (!choice) {
      const changesOf = (block: string[] | null, untracks?: number): ChoiceChanges => ({
        ...(block ? { writes: block.filter((line) => !line.startsWith("#")) } : {}),
        ...(block && replacedBy(block).length > 0 ? { replaces: replacedBy(block) } : {}),
        ...(untracks ? { untracks } : {}),
      });
      return {
        ...result,
        decision: decisionFor(tracked, alreadyIgnored, {
          untrack: changesOf(!alreadyIgnored || saysOtherwise ? ignoreBlock : null, tracked.length),
          "keep-tracked": changesOf([KEEP_HEADING, DOT_DR_CONTENTS_LINE, ...keepLines(tracked)]),
        }),
      };
    }
    if (choice === "skip") {
      return { ...result, applied: choice };
    }
    if (choice === "keep-tracked") {
      const keptTracked = keepLines(tracked);
      const block = [KEEP_HEADING, DOT_DR_CONTENTS_LINE, ...keptTracked];
      if (options.dryRun) return { ...result, applied: choice, keptTracked, ...wouldWrite(block) };
      const replaced = replacedBy(block);
      await writeBlock(block);
      return { ...result, added: true, ignored: true, applied: choice, keptTracked, ...withReplaced(replaced) };
    }
    // untrack. The rule is written when nothing ignores the folder yet, and also when the file's
    // own lines say otherwise, so it does not go on contradicting what was just done.
    const writes = !alreadyIgnored || saysOtherwise;
    if (options.dryRun) {
      return { ...result, applied: choice, wouldUntrack: tracked.length, ...(writes ? wouldWrite(ignoreBlock) : {}) };
    }
    // The rule first, so a failure to untrack leaves the half state the user already had
    const replaced = writes ? replacedBy(ignoreBlock) : [];
    if (writes) await writeBlock(ignoreBlock);
    const removed = git(projectRoot, ["rm", "-r", "--cached", "--quiet", "--", ".dr"]);
    if (!removed || removed.status !== 0) {
      throw new Error(
        `could not untrack the files under .dr/ (git rm -r --cached .dr): ${removed?.stderr.trim() || "git did not run"}`
      );
    }
    return {
      ...result,
      added: writes,
      ignored: gitSaysIgnored(projectRoot) ?? true,
      trackedFiles: trackedUnderDotDr(projectRoot).length,
      applied: choice,
      untracked: tracked.length,
      ...withReplaced(replaced),
    };
  }

  if (alreadyIgnored) return result;
  if (options.dryRun) return { ...result, ...wouldWrite(ignoreBlock) };

  const replaced = replacedBy(ignoreBlock);
  await writeBlock(ignoreBlock);
  const after = gitChecked ? gitSaysIgnored(projectRoot) : null;
  return { ...result, added: true, ignored: after ?? true, ...withReplaced(replaced) };
}

/**
 * The decision as lines for a person: the count, the files and each choice with its effect. The
 * first {@link DOT_DR_FILES_SHOWN} files are named, with how many more there are and how to list
 * them, unless `full` asks for all.
 */
export function dotDrDecisionLines(decision: DotDrDecision, options: { full?: boolean } = {}): string[] {
  const shown = options.full ? decision.files : decision.files.slice(0, DOT_DR_FILES_SHOWN);
  const more = decision.files.length - shown.length;
  return [
    decision.alreadyIgnored
      ? `git tracks ${decision.wouldIgnoreTracked} file(s) under .dr/, which .gitignore already ignores: they stay tracked and modified, and git add .dr refuses them.`
      : `git tracks ${decision.wouldIgnoreTracked} file(s) under .dr/, which is per-checkout state dr recreates. An ignore rule alone would not untrack them, so .gitignore was left alone.`,
    `  ${shown.join(", ")}${more > 0 ? `, and ${more} more of ${decision.files.length} (git ls-files .dr lists them all)` : ""}`,
    ...decision.options.flatMap((option) => [
      `  ${option.choice}: ${option.effect}`,
      ...(option.writes ? [`      writes to .gitignore: ${option.writes.join("  ")}`] : []),
      ...(option.replaces ? [`      removes from .gitignore: ${option.replaces.join(" | ")}`] : []),
      ...(option.untracks ? [`      removes from git's index: ${option.untracks} file(s) under .dr/`] : []),
    ]),
  ];
}

/** What the call did to `.gitignore` and the index, one line per thing (empty when it changed nothing). */
export function dotDrIgnoreNotes(result: DotDrIgnoreResult): string[] {
  const notes: string[] = [];
  const file = path.basename(result.path);
  if (result.applied === "keep-tracked" && result.added) {
    notes.push(
      `${file} now ignores .dr/ except ${result.keptTracked?.map((line) => line.slice(1)).join(", ")} (commit the .gitignore change)`
    );
  } else if (result.added) {
    notes.push(
      result.ignored && result.replaced?.length && result.applied === "untrack"
        ? `${file} now says only ${DOT_DR_IGNORE_LINE} about .dr/ (commit the .gitignore change)`
        : `Added ${DOT_DR_IGNORE_LINE} to ${file} (DR's per-checkout state; commit the .gitignore change)`
    );
  }
  if (result.untracked) {
    notes.push(
      `Removed ${result.untracked} file(s) under .dr/ from git's index (they stay on disk); the removals are staged for the next commit`
    );
  }
  if (result.replaced?.length) {
    notes.push(`Removed ${result.replaced.length} line(s) about .dr that ${file} already had: ${result.replaced.join(" | ")}`);
  }
  if (result.applied === "skip") {
    notes.push(`Left ${file} and the ${result.trackedFiles} file(s) git tracks under .dr/ as they are`);
  }
  return notes;
}

/**
 * Notes for the user about a problem the call could not settle, one per problem (empty when
 * `.dr/` is ignored and nothing under it is tracked against the developer's wishes). A pending
 * {@link DotDrIgnoreResult.decision} is not a warning: callers put it to the user.
 */
export function dotDrIgnoreWarnings(result: DotDrIgnoreResult): string[] {
  const warnings: string[] = [];
  if (result.negated) {
    warnings.push(
      `${result.path} un-ignores .dr/ (a "!" line), so DR left it alone. .dr/ holds per-checkout state and should not be committed.`
    );
  } else if (!result.ignored && result.added) {
    warnings.push(
      `.dr/ is still not git-ignored after adding ${DOT_DR_IGNORE_LINE} to ${result.path}: another ignore file un-ignores it.`
    );
  }
  return warnings;
}
