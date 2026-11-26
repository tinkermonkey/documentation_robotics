/**
 * Does a plan staged in another checkout look like the one about to be made here (#1368)? A
 * heuristic over the plan's name, intent and the issue numbers they cite, to word a warning: it
 * never refuses anything, and a plan it doesn't flag may still be the same work.
 */

import type { SiblingPlan } from "./checkout-types.js";

export interface PlanCandidate {
  name: string;
  description?: string;
}

export interface SiblingPlanMatch {
  plan: SiblingPlan;
  /** Why it looks like the same work, in words. */
  reasons: string[];
}

const NAME_OVERLAP = 0.5;
/** One shared word (viewer, model, export) is no sign of the same work, whatever the name's length. */
const NAME_SHARED_MIN = 2;
/** Intents are long, so they must share a good part of their words (Jaccard), not just the shorter one's. */
const INTENT_JACCARD = 0.4;
/** Words this short or this common say nothing about what a plan is for. */
const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "plan", "add", "adds", "fix", "when", "what", "will", "are", "its"]);

function nameWords(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
}

function sharedWords(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.min(a.size, b.size);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** The issue numbers a text cites: `#1368`, `issues/1368`, `issue 1368`. */
export function issueRefs(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:(?<![\w&])#|issues?\/|\bissues?\s+)(\d{3,5})\b/gi)) found.add(m[1]);
  return found;
}

export function matchSiblingPlans(candidate: PlanCandidate, plans: SiblingPlan[]): SiblingPlanMatch[] {
  const candName = nameWords(candidate.name);
  const candIntent = nameWords(candidate.description ?? "");
  const candIssues = issueRefs(`${candidate.name} ${candidate.description ?? ""}`);
  const matches: SiblingPlanMatch[] = [];
  for (const plan of plans) {
    const reasons: string[] = [];
    if (plan.name.toLowerCase() === candidate.name.toLowerCase()) {
      reasons.push("the same name");
    } else if (sharedWords(candName, nameWords(plan.name)) >= NAME_SHARED_MIN && overlap(candName, nameWords(plan.name)) >= NAME_OVERLAP) {
      reasons.push(`a similar name ("${plan.name}")`);
    }
    const shared = [...issueRefs(`${plan.name} ${plan.description ?? ""}`)].filter((n) => candIssues.has(n));
    if (shared.length > 0) reasons.push(`the same issue (${shared.map((n) => `#${n}`).join(", ")})`);
    if (plan.description && candIntent.size >= 4 && jaccard(candIntent, nameWords(plan.description)) >= INTENT_JACCARD) {
      reasons.push("a similar intent");
    }
    if (reasons.length > 0) matches.push({ plan, reasons });
  }
  return matches;
}
