/**
 * What a layer's check says about itself (codebase_verify): checked and in step, checked and
 * drifted, or not checked, with how much of the layer it covered.
 *
 * A check that compared nothing used to read like a clean one: every bucket empty and a count or
 * two in the summary. `not_checked` is its own status here, and is never folded into `in_step`:
 * a layer is in step only when at least one of its elements was compared and nothing differs.
 */
import { NOT_CHECKED_ID_LIMIT, type LayerVerifyCoverage, type LayerVerifyStatus, type NotCheckedGroup } from "./types.js";

/** A model element a check could not compare, with why and what would make it checkable. */
export interface NotCheckedElement {
  id: string;
  reason: string;
  to_check?: string;
}

/** Elements that could not be checked, grouped by reason, the largest group first. */
export function groupNotChecked(elements: NotCheckedElement[]): NotCheckedGroup[] {
  const groups = new Map<string, NotCheckedGroup>();
  for (const e of elements) {
    let group = groups.get(e.reason);
    if (!group) {
      group = { reason: e.reason, ...(e.to_check ? { to_check: e.to_check } : {}), count: 0, ids: [] };
      groups.set(e.reason, group);
    }
    group.count++;
    if (group.ids.length < NOT_CHECKED_ID_LIMIT) group.ids.push(e.id);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** What a layer's check found, as counts. */
export interface LayerFindings {
  matched: number;
  /** In the code, not the model. */
  inCodeOnly: number;
  /** In the model, not found in the code. */
  inModelOnly: number;
  /** Sourced to files the analyzer didn't (fully) index. */
  notIndexed: number;
  /** Not compared, for any other reason (see {@link groupNotChecked}). */
  notChecked: number;
  /** Model-only entries an ignore rule covers: compared, and deliberately not drift. */
  ignoredInModel?: number;
  /** Relationships in the code only or the model only (the testing layer's `tests`). */
  relationshipDifferences?: number;
}

/** How a layer's check names what it compares, for its status sentence. */
export interface LayerNouns {
  /** The model's side: "API operations", "test cases". */
  model: string;
  /** The code's side: "HTTP routes", "test cases". */
  code: string;
  /** What the check reads to find them, for a layer with nothing on either side. */
  reads: string;
}

const count = (n: number) => n.toLocaleString("en-US");

/** The status, its sentence and the coverage of one layer's check. */
export function layerStatus(
  findings: LayerFindings,
  nouns: LayerNouns
): { status: LayerVerifyStatus; status_text: string; coverage: LayerVerifyCoverage } {
  const ignored = findings.ignoredInModel ?? 0;
  const checked = findings.matched + findings.inModelOnly + ignored;
  const notChecked = findings.notIndexed + findings.notChecked;
  const coverage: LayerVerifyCoverage = {
    model_elements: checked + notChecked,
    checked,
    not_checked: notChecked,
    code_entries: findings.matched + findings.inCodeOnly,
  };
  const differences = findings.inCodeOnly + findings.inModelOnly + (findings.relationshipDifferences ?? 0);
  const unchecked =
    notChecked > 0
      ? ` ${count(notChecked)} of the model's ${count(coverage.model_elements)} ${nouns.model} could not be checked (not_checked says why).`
      : "";

  if (differences > 0) {
    const parts = [
      findings.inCodeOnly > 0 ? `${count(findings.inCodeOnly)} ${nouns.code} in the code only` : "",
      findings.inModelOnly > 0 ? `${count(findings.inModelOnly)} ${nouns.model} in the model only` : "",
      findings.relationshipDifferences ? `${count(findings.relationshipDifferences)} relationship difference(s)` : "",
    ].filter(Boolean);
    const text =
      coverage.model_elements === 0
        ? `Drifted: the model has no ${nouns.model}, and the analyzer found ${parts.join(", ")}.`
        : `Checked ${count(checked)} of the model's ${count(coverage.model_elements)} ${nouns.model}: drifted, ${parts.join(", ")}.`;
    return { status: "drifted", status_text: `${text}${unchecked}`, coverage };
  }
  if (checked > 0) {
    return {
      status: "in_step",
      status_text: `Checked ${count(checked)} of the model's ${count(coverage.model_elements)} ${nouns.model}: in step with the code.${unchecked}`,
      coverage,
    };
  }
  if (coverage.model_elements === 0) {
    return {
      status: "not_checked",
      status_text:
        `Not checked: nothing to compare. The model has no ${nouns.model} and the analyzer found no ${nouns.code} in the code ` +
        `(this check reads ${nouns.reads}).`,
      coverage,
    };
  }
  return {
    status: "not_checked",
    status_text:
      `Not checked: none of the model's ${count(coverage.model_elements)} ${nouns.model} could be compared with the code, and the analyzer ` +
      `found no ${nouns.code} (this check reads ${nouns.reads}). not_checked says why for each group and what would make it checkable.`,
    coverage,
  };
}
