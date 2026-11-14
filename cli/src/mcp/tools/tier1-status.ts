/**
 * tier1_status — where Tier 1 (the decision model codebase_extract asks about the cards Tier 0
 * can't decide) stands for this checkout: on or why not, provider and model, where each key comes
 * from (never its value), this month's spend against the cap and by source, the cache
 * (docs/analyzers/TIER1_DESIGN.md sections 2.4 and 4.3). With `probe: true` it sends the probe, one
 * fixed synthetic card with no project code, through the configured provider and records its
 * cost, so a user can test a configuration.
 *
 * Read-only apart from the probe's ledger line: it never writes `tier1.json` (a person enables,
 * changes and disables Tier 1 with `dr analyzer tier1 ...`) and no result holds a key.
 */
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readSession } from "../../analyzers/session-state.js";
import { probeCostEstimate } from "../../analyzers/classifier/decision-model/probe.js";
import { openTier1 } from "../../analyzers/classifier/session.js";
import { monthLine } from "../../analyzers/classifier/spend.js";
import { describeTier1Status, probeAffordable, runProbe, tier1Status } from "../../analyzers/classifier/status.js";
import { jsonResult, loadModel, rootPathSchema, runTool, type McpToolDefinition } from "./shared.js";
import { canonicalRoots, type CodebaseToolDeps } from "./codebase-shared.js";

const inputSchema = {
  probe: z
    .literal(true)
    .optional()
    .describe(
      "Send the probe: one fixed synthetic card (no project code) through the configured provider, about a third of a cent, recorded in this month's spend. " +
        "Use it when the user asks to test the configuration."
    ),
  analyzer: z.string().min(1).optional().describe("The analyzer Tier 1 is configured for (default: the active one, else cbm)."),
  rootPath: rootPathSchema,
};

export type Tier1StatusArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export type Tier1StatusDeps = Pick<CodebaseToolDeps, "tier1" | "tier1Spec">;

export function createTier1StatusHandler(deps: Tier1StatusDeps = {}) {
  return async function tier1StatusHandler(args: Tier1StatusArgs): Promise<CallToolResult> {
    return runTool(async () => {
      const model = await loadModel(args.rootPath);
      const { projectRoot, codebaseRoot } = await canonicalRoots(model);
      const analyzer = args.analyzer ?? (await readSession(projectRoot).catch(() => null))?.active_analyzer ?? "cbm";
      const open = deps.tier1 ?? {};
      const status = await tier1Status(projectRoot, analyzer, {
        codebaseRoot,
        ...(open.env ? { env: open.env } : {}),
        ...(open.git ? { git: open.git } : {}),
        ...(open.now ? { now: open.now } : {}),
      });
      let probe: Record<string, unknown> | undefined;
      if (args.probe) {
        const session = await openTier1(projectRoot, analyzer, { codebaseRoot, ...open });
        if (session.state !== "ready") {
          probe = { sent: false, reason: `Tier 1 is ${session.state}: ${session.block.reason}` };
        } else if (!probeAffordable(session)) {
          probe = { sent: false, reason: `the probe costs about $${probeCostEstimate(session.model).toFixed(4)} and ${monthLine(session.month)}` };
        } else {
          const result = await runProbe(session, deps.tier1Spec);
          probe = {
            sent: true,
            notice: `Sent one synthetic card (no project code) to ${session.party}, because ${session.resolved.paths.configRelative} enables Tier 1.`,
            ...result,
          };
        }
      }
      // GET /api/tier1 on the visualization server returns the same body, without the probe.
      return jsonResult({ ...status, ...(probe ? { probe } : {}), ...describeTier1Status(status) }, { compact: true });
    });
  };
}

export const tier1StatusHandler = createTier1StatusHandler();

export const tier1StatusTool: McpToolDefinition<typeof inputSchema> = {
  name: "tier1_status",
  description:
    "Whether Tier 1 (the decision model codebase_extract asks about cards Tier 0 can't decide) is on for this checkout: its state " +
    "(off, misconfigured, no-credentials, on, capped) and why, provider and model, where each key comes from (never its value), " +
    "this month's spend against the cap and by source, and the answer cache. probe: true tests the configuration with one synthetic " +
    "card (no project code; its small cost is recorded). Never changes the configuration: the user does that with dr analyzer tier1.",
  inputSchema,
  handler: tier1StatusHandler,
};
