/**
 * dr changeset verify — compare a planned changeset with what was built (another changeset, or the
 * base model). The same comparison as the `changeset_verify` MCP tool; see
 * `cli/src/core/changeset-verify.ts`. Read-only, unless `--adopt-source-references` asks it to copy
 * the source references it lists onto the plan, as the `changeset_adopt_source_references` MCP tool
 * does (see `cli/src/core/source-reference-adoption.ts`).
 */

import ansis from "ansis";
import { Model } from "../core/model.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { verifyChangesetInModel, type VerifyReport } from "../core/changeset-verify.js";
import type { Changeset } from "../core/changeset.js";
import {
  adoptVerifiedSourceReferences,
  type VerifiedAdoptionReport,
} from "../core/source-reference-adoption.js";
import { CLIError, getErrorMessage } from "../utils/errors.js";
import { isJson } from "../utils/globals.js";

export interface ChangesetVerifyOptions {
  model?: string;
  against?: string;
  base?: boolean;
  /** With base: apply the extraction rule (the as-built side landed from codebase_extract). */
  extracted?: boolean;
  json?: boolean;
  matchBySource?: boolean;
  /** Copy the source references verify lists onto the plan (exact matches; probable ones via ids). */
  adoptSourceReferences?: boolean;
  /** With adoptSourceReferences: planned element ids, comma-separated, whose probable matches are confirmed. */
  ids?: string;
}

/** The ids of `--ids a,b`: trimmed, empties dropped. */
export function parseIdList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export async function changesetVerifyCommand(
  planned: string | undefined,
  options: ChangesetVerifyOptions = {}
): Promise<void> {
  const json = options.json === true || isJson();
  const fail = (message: string, hint?: string): never => {
    if (json) {
      console.log(JSON.stringify({ status: "error", code: 1, message, ...(hint ? { hint } : {}) }));
    } else {
      console.error(ansis.red(`Error: ${message}`));
      if (hint) console.error(ansis.dim(hint));
    }
    process.exit(1);
  };

  try {
    if (options.against && options.base) {
      fail("Pass either --against <changeset> or --base, not both");
    }
    if (options.extracted && !options.base) {
      fail("--extracted goes with --base");
    }
    if (options.ids !== undefined && !options.adoptSourceReferences) {
      fail("--ids goes with --adopt-source-references", "It names the probable matches you confirmed, to copy");
    }
    if (!options.against && !options.base) {
      fail(
        "Nothing to verify against",
        "Use --against <changeset> to compare with an as-built changeset, or --base to compare with the base model"
      );
    }

    const model = await Model.load(options.model, { lazyLoad: false });
    const manager = new StagingAreaManager(model.rootPath, model);
    const load = async (name: string, role: string): Promise<Changeset> => {
      const changeset = await manager.load(name);
      if (!changeset) return fail(`${role} changeset '${name}' not found`, "Run 'dr changeset list' to see changesets");
      return changeset;
    };

    const plannedName = planned ?? (await manager.getActiveId());
    if (!plannedName) {
      return fail("No changeset named and none is active", "Pass the planned changeset's name or ID");
    }
    const plannedChangeset = await load(plannedName, "Planned");
    const asBuilt = options.against ? await load(options.against, "As-built") : undefined;

    const report = await verifyChangesetInModel(model, {
      planned: plannedChangeset,
      against: asBuilt ? { changeset: asBuilt } : { base: true, extracted: options.extracted === true },
      matchBySource: options.matchBySource,
    });

    if (options.adoptSourceReferences) {
      const result = await adoptVerifiedSourceReferences(model, manager, {
        planned: plannedChangeset,
        asBuilt,
        report,
        confirmed: parseIdList(options.ids),
        sameChangesetHint: planned
          ? "Pass the plan as [planned] and the as-built changeset with --against"
          : "Pass the plan as [planned]: the active changeset is the as-built one codebase_extract left active",
      });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatAdoptionReport(result));
      }
      return;
    }

    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatVerifyReport(report));
    }
  } catch (error) {
    fail(getErrorMessage(error), error instanceof CLIError ? error.suggestions?.join("\n") : undefined);
  }
}

/** Human-readable rendering of what `--adopt-source-references` copied onto the plan. */
export function formatAdoptionReport(result: VerifiedAdoptionReport): string {
  const lines: string[] = [];
  lines.push(ansis.bold(`Adopt source references: ${result.plannedChangeset.name}`));
  lines.push(result.adopted.length > 0 ? ansis.green(result.next) : ansis.dim(result.next));
  const where = (g: { missing: Array<{ file: string; symbol?: string }> }) =>
    g.missing.map((l) => (l.symbol ? `${l.file}#${l.symbol}` : l.file)).join(", ");
  if (result.adopted.length > 0) {
    lines.push("", ansis.bold("Copied"));
    for (const g of result.adopted) lines.push(`  ${ansis.green("✓")} ${g.planned}: ${where(g)}`);
  }
  if (result.skipped && result.skipped.length > 0) {
    lines.push("", ansis.bold("Not copied"));
    for (const s of result.skipped) lines.push(`  ${ansis.yellow("-")} ${s.planned}: ${s.reason}`);
    if (result.missing?.some((g) => g.match === "probable" && !g.builtByAgent)) {
      lines.push(
        ansis.dim("  Confirm a probable match in the code, then pass its planned id: --adopt-source-references --ids <id,id>")
      );
    }
  }
  if (result.unknownIds && result.unknownIds.length > 0) {
    lines.push("", ansis.yellow(`--ids that name no listed element (nothing to confirm): ${result.unknownIds.join(", ")}`));
  }
  return lines.join("\n");
}

const rel = (r: { source: string; predicate: string; target: string }) => `${r.source} --${r.predicate}--> ${r.target}`;
const value = (v: unknown) => (v === undefined || v === null ? "(none)" : JSON.stringify(v));

/** Human-readable rendering of a verify report. */
export function formatVerifyReport(report: VerifyReport): string {
  const lines: string[] = [];
  const verdictColor =
    report.verdict === "match"
      ? ansis.green
      : report.verdict === "probable-match"
        ? ansis.cyan
        : report.verdict === "diverges"
          ? ansis.yellow
          : report.verdict === "incomplete"
            ? ansis.red
            : ansis.dim;
  const unverifiable = (n: number) => (n > 0 ? `, ${n} unverifiable` : "");

  lines.push(ansis.bold(`Verify: ${report.planned.label}  vs  ${report.against.label}`));
  lines.push(verdictColor(`${report.verdict}: ${report.verdictText}`));
  const e = report.summary.elements;
  const r = report.summary.relationships;
  lines.push(
    ansis.dim(
      `Elements: ${e.planned} planned, ${e.matched} matched (${e.divergent} with differences), ${e.missing} missing` +
        `${unverifiable(e.unverifiable)}, ${e.unplanned} unplanned, ${e.deletionsNotDone} deletions not done (${e.probable} probable)`
    )
  );
  lines.push(
    ansis.dim(
      `Relationships: ${r.planned} planned, ${r.matched} matched (${r.divergent} with differences), ${r.missing} missing` +
        `${unverifiable(r.unverifiable)}, ${r.unplanned} unplanned, ${r.deletionsNotDone} deletions not done (${r.probable} probable)`
    )
  );
  const share = report.extraction?.asBuilt;
  if (share) {
    const provenance = Object.entries(share.elements.byProvenance)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    lines.push(
      ansis.dim(
        `As-built: ${share.elements.total} elements (${provenance || "none"} declared; ${share.elements.fromExtraction} ` +
          `from extraction, ${share.elements.agentAdded} added by the agent), ${share.relationships.total} relationships ` +
          `(${share.relationships.betweenExtracted} between extracted elements)`
      )
    );
  }
  if (report.warning) lines.push(ansis.yellow(`Warning: ${report.warning}`));

  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("", ansis.bold(title));
    for (const item of items) lines.push(`  ${item}`);
  };
  const probable = (m: { match: string; reason?: string }) => (m.match === "probable" ? ansis.cyan(` [probable: ${m.reason}]`) : "");

  section(
    "Missing elements (planned, not built)",
    report.elements.missing.map(
      (m) =>
        `${ansis.red("-")} ${m.planned} (${m.op}): ${m.reason}` +
        (m.candidates ? `\n      candidates: ${m.candidates.join(", ")}` : "") +
        (m.fields ? m.fields.map((f) => `\n      ${f.field}: planned ${value(f.planned)}, built ${value(f.built)}`).join("") : "")
    )
  );
  section(
    "Unverifiable elements (extraction can't see them)",
    report.elements.unverifiable.map((u) => `${ansis.dim("?")} ${u.planned} (${u.op}): ${u.reason}`)
  );
  section(
    "Divergent elements",
    report.elements.divergent.map(
      (d) =>
        `${ansis.yellow("~")} ${d.planned}${d.built !== d.planned ? ` → ${d.built}` : ""}${probable(d)}` +
        d.fields.map((f) => `\n      ${f.field}: planned ${value(f.planned)}, built ${value(f.built)}`).join("")
    )
  );
  section(
    "Planned deletions that still exist",
    report.elements.deletionsNotDone.map((d) => `${ansis.red("!")} ${d.built}`)
  );
  section(
    "Unplanned elements (built, not planned)",
    report.elements.unplanned.map((u) => `${ansis.yellow("+")} ${u.id} (${u.change})`)
  );
  section(
    "Matched elements",
    report.elements.matched.map(
      (m) =>
        `${ansis.green("✓")} ${m.planned}${m.built !== m.planned ? ` → ${m.built}` : ""} (${m.op})${probable(m)}` +
        (m.lifecycle ?? []).map((f) => ansis.dim(`\n      ${f.field}: ${value(f.planned)} → ${value(f.built)} (lifecycle)`)).join("") +
        (m.notes ?? []).map((f) => ansis.dim(`\n      ${f.field} differs (note): built ${value(f.built)}`)).join("") +
        (m.unverifiableFields ?? [])
          .map((f) => ansis.dim(`\n      ${f.field}: planned ${value(f.planned)} (extraction doesn't write it)`))
          .join("")
    )
  );

  section(
    "Missing relationships",
    report.relationships.missing.map(
      (m) =>
        `${ansis.red("-")} ${rel(m.planned)}: ${m.reason}` +
        (m.candidates ? `\n      candidates: ${m.candidates.map(rel).join(", ")}` : "")
    )
  );
  section(
    "Unverifiable relationships (extraction can't see them)",
    report.relationships.unverifiable.map((u) => `${ansis.dim("?")} ${rel(u.planned)}: ${u.reason}`)
  );
  section(
    "Divergent relationships",
    report.relationships.divergent.map(
      (d) =>
        `${ansis.yellow("~")} ${rel(d.planned)} built as ${rel(d.built)}${probable(d)}` +
        d.fields.map((f) => `\n      ${f.field}: planned ${value(f.planned)}, built ${value(f.built)}`).join("")
    )
  );
  section(
    "Planned relationship deletions that still exist",
    report.relationships.deletionsNotDone.map((d) => `${ansis.red("!")} ${rel(d.built)}`)
  );
  section(
    "Unplanned relationships",
    report.relationships.unplanned.map((u) => `${ansis.yellow("+")} ${rel(u)} (${u.change})`)
  );
  section(
    "Matched relationships",
    report.relationships.matched.map((m) => `${ansis.green("✓")} ${rel(m.built)} (${m.op})${probable(m)}`)
  );

  const sourceReferences = report.sourceReferences;
  if (sourceReferences && sourceReferences.missing.length > 0) {
    section(
      "Source references the plan lacks (its as-built match has them)",
      sourceReferences.missing.map(
        (g) =>
          `${g.builtByAgent ? ansis.dim("?") : ansis.cyan("→")} ${g.planned}` +
          `${g.built !== g.planned ? ` → ${g.built}` : ""}` +
          `${g.match === "probable" ? ansis.cyan(` [probable${g.matchReason ? `: ${g.matchReason}` : ""}]`) : ""}` +
          `${g.builtByAgent ? ansis.dim(" [not staged by extraction: not copied]") : ""}: ` +
          g.missing.map((l) => (l.symbol ? `${l.file}#${l.symbol}` : l.file)).join(", ")
      )
    );
    if (sourceReferences.missing.some((g) => !g.builtByAgent)) {
      lines.push(
        ansis.dim(
          "  Copy them onto the plan before it lands: rerun with --adopt-source-references (exact matches; " +
            "add --ids <id,id> for probable matches you confirmed in the code)."
        )
      );
    }
  }

  section(
    "Notes",
    report.notes.map((n) => ansis.dim(n))
  );
  return lines.join("\n");
}
