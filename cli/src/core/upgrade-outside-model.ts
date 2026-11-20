/**
 * What an upgrade touches outside the model (#1165).
 *
 * `dr upgrade` moves the model to a new spec version, and in the same run installs the spec
 * reference, upgrades the installed integrations (`.claude/`, `.github/`), generates layer reports
 * when there are none and adds lines to `.gitignore` and `.prettierignore`. A reviewer has to
 * separate all of that from the migration, so the plan names every one of those files before
 * anything is written, grouped by what it is, and `--model-only` leaves them all out.
 *
 * {@link scanOutsideModel} gathers the groups both `dr upgrade` and the `project_upgrade` MCP tool
 * report (the spec reference, reports, the two ignore files, the commit hook notes);
 * `dr upgrade` adds the integrations, which the MCP tool leaves alone. Nothing here writes.
 */

import path from "node:path";
import { ensureDotDrIgnored, type DotDrDecision, type DotDrTrackedChoice } from "./dot-dr-ignore.js";
import { ensurePrettierIgnoresDrFiles } from "./prettier-ignore.js";
import { commitHookNotes } from "./commit-hooks.js";
import type { UpgradeScan } from "./upgrade-plan.js";
import type { IntegrationUpgradePlan } from "../integrations/base-manager.js";
import { hasLayerReports } from "../commands/reports.js";
import { getErrorMessage } from "../utils/errors.js";

/** An installed integration and what upgrading it would change */
export interface IntegrationPlan extends IntegrationUpgradePlan {
  name: "claude" | "copilot";
  /** "Claude Code", "GitHub Copilot" */
  label: string;
  toVersion: string;
  /** False when the integration is at this dr's version: only its stale entries are reported */
  upgrade: boolean;
}

export interface OutsideModel {
  /** `.dr/`: installed or refreshed by the upgrade. Per-checkout, not committed. */
  specReference?: { folder: string; description: string };
  /** Layer reports and the README, generated when the project has none */
  reports?: { files: string[] };
  /**
   * `.gitignore` and git's index: the rule lines the upgrade would write (`add`), the lines about
   * `.dr` already there that they replace (`replace`), the files under `.dr/` it would remove from
   * the index (`untrack`), or the decision it needs before it does any of that.
   */
  gitignore?: { path: string; add?: string[]; replace?: string[]; untrack?: number; decision?: DotDrDecision };
  /** `.prettierignore`: the entries the upgrade would add */
  prettierignore?: { path: string; add: string[] };
  /** What the project's commit hooks would do to a commit of the files dr writes; dr changes nothing */
  commitHooks?: string[];
  /** Checks that failed; the upgrade goes on without them */
  errors: string[];
}

/** A path relative to the project root, with forward slashes */
function inProject(projectRoot: string, file: string): string {
  const relative = path.relative(projectRoot, file).split(path.sep).join("/");
  return relative.startsWith("..") ? file : relative;
}

/**
 * What the scanned upgrade would touch outside the model, apart from the integrations. Reads
 * only.
 *
 * @param options.dotDr - the user's choice for files git tracks under `.dr/`, when they gave one
 */
export async function scanOutsideModel(
  projectRoot: string,
  scan: UpgradeScan,
  options: { dotDr?: DotDrTrackedChoice } = {}
): Promise<OutsideModel> {
  const outside: OutsideModel = { errors: [] };

  const spec = scan.actions.find((action) => action.type === "spec");
  if (spec) {
    outside.specReference = {
      folder: ".dr/",
      description: `${spec.description} (v${spec.toVersion}): .dr/spec/ (15 files), .dr/manifest.json, .dr/README.md. Per-checkout, not committed.`,
    };
  }

  try {
    if (scan.model.state === "found" && !(await hasLayerReports(projectRoot))) {
      outside.reports = {
        files: ["documentation-robotics/reports/ (13 layer reports)", "documentation-robotics/README.md"],
      };
    }
  } catch (error) {
    outside.errors.push(`Could not check for layer reports: ${getErrorMessage(error)}`);
  }

  try {
    const ignore = await ensureDotDrIgnored(projectRoot, { dryRun: true, tracked: options.dotDr });
    const file = inProject(projectRoot, ignore.path);
    if (ignore.decision) {
      outside.gitignore = { path: file, decision: ignore.decision };
    } else if (ignore.wouldWrite || ignore.wouldUntrack) {
      outside.gitignore = {
        path: file,
        ...(ignore.wouldWrite ? { add: ignore.wouldWrite } : {}),
        ...(ignore.replaced?.length ? { replace: ignore.replaced } : {}),
        ...(ignore.wouldUntrack ? { untrack: ignore.wouldUntrack } : {}),
      };
    }
  } catch (error) {
    outside.errors.push(`Could not check .gitignore: ${getErrorMessage(error)}`);
  }

  try {
    const ignore = await ensurePrettierIgnoresDrFiles(projectRoot, { dryRun: true });
    if (ignore.status === "missing" && ignore.path && ignore.entries?.length) {
      outside.prettierignore = { path: inProject(projectRoot, ignore.path), add: ignore.entries };
    }
  } catch (error) {
    outside.errors.push(`Could not check .prettierignore: ${getErrorMessage(error)}`);
  }

  const hookNotes = await commitHookNotes(projectRoot);
  if (hookNotes.length > 0) outside.commitHooks = hookNotes;

  return outside;
}

/** Whether the upgrade would write any file outside the model (a pending decision counts) */
export function touchesOutsideModel(outside: OutsideModel, integrations: IntegrationPlan[] = []): boolean {
  return Boolean(
    outside.specReference ||
      outside.reports ||
      outside.gitignore ||
      outside.prettierignore ||
      integrations.some((plan) => plan.upgrade || plan.stale.length > 0)
  );
}

/**
 * How many files of an integration plan are listed by default. The group's heading always gives
 * the true count, and `full` lists every file.
 */
export const INTEGRATION_FILES_SHOWN = 40;

const ACTION_LABEL: Record<IntegrationUpgradePlan["files"][number]["action"], string> = {
  add: "add",
  update: "update",
  overwrite: "overwrite",
  remove: "remove",
};

/**
 * The plan as lines for the terminal: one group per kind of file, each file with what happens to
 * it. `skipped` (with --model-only) words it as what is left alone.
 */
export function outsideModelLines(
  outside: OutsideModel,
  integrations: IntegrationPlan[],
  options: { skipped?: boolean; full?: boolean } = {}
): string[] {
  const lines: string[] = [];
  const group = (title: string, entries: string[]) => {
    if (entries.length === 0) return;
    lines.push(`  ${title}`);
    for (const entry of entries) lines.push(`    ${entry}`);
  };

  if (outside.specReference && !options.skipped) {
    group("Spec reference", [outside.specReference.description]);
  }

  for (const plan of integrations) {
    const entries: string[] = [];
    if (plan.upgrade) {
      const listed = options.full ? plan.files : plan.files.slice(0, INTEGRATION_FILES_SHOWN);
      for (const file of listed) {
        entries.push(
          `${ACTION_LABEL[file.action].padEnd(9)} ${file.path}${file.action === "overwrite" ? "  (edited in this project; the edit is replaced)" : ""}`
        );
      }
      if (plan.files.length > listed.length) {
        entries.push(
          `...and ${plan.files.length - listed.length} more of ${plan.files.length} file(s); dr upgrade --dry-run --full lists them all`
        );
      }
      for (const file of plan.kept) entries.push(`${"keep".padEnd(9)} ${file}  (edited in this project)`);
      entries.push(`${"update".padEnd(9)} ${plan.versionFile}`);
    }
    for (const entry of plan.stale) {
      entries.push(`${"stale".padEnd(9)} ${entry}`);
    }
    if (plan.stale.length > 0) {
      entries.push(
"(stale: installed by an earlier dr under that name, absent from this dr's integration and from the version file, so no upgrade updates or removes it; kept unless you remove it: --remove-stale [path...])"
      );
    }
    const counts = plan.upgrade
      ? `${plan.fromVersion ?? "unknown"} → ${plan.toVersion}, ${plan.files.length + 1} file(s)`
      : `up to date (v${plan.toVersion})`;
    group(`${plan.label} integration (${plan.folder}/): ${counts}`, entries);
  }

  if (outside.reports) {
    group("Reports (none yet)", outside.reports.files.map((file) => `${"generate".padEnd(9)} ${file}`));
  }

  const ignoreFiles: string[] = [];
  if (outside.gitignore?.add) {
    ignoreFiles.push(`${"add".padEnd(9)} ${outside.gitignore.add.join(", ")} to ${outside.gitignore.path}`);
  }
  if (outside.gitignore?.replace) {
    ignoreFiles.push(
      `${"remove".padEnd(9)} ${outside.gitignore.replace.length} line(s) about .dr that ${outside.gitignore.path} already has: ${outside.gitignore.replace.join(" | ")}`
    );
  }
  if (outside.gitignore?.untrack) {
    ignoreFiles.push(
      `${"untrack".padEnd(9)} ${outside.gitignore.untrack} file(s) under .dr/ from git's index (git rm -r --cached .dr: staged removals, the files stay on disk)`
    );
  }
  if (outside.gitignore?.decision) {
    ignoreFiles.push(
      `${"decide".padEnd(9)} ${outside.gitignore.path}: git tracks ${outside.gitignore.decision.wouldIgnoreTracked} file(s) under .dr/ (--dot-dr untrack, keep-tracked or skip)`
    );
  }
  if (outside.prettierignore) {
    ignoreFiles.push(`${"add".padEnd(9)} ${outside.prettierignore.add.join(" and ")} to ${outside.prettierignore.path}`);
  }
  group("Ignore files and git's index", ignoreFiles);

  return lines;
}
