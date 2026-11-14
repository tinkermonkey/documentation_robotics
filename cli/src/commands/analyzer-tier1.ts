/**
 * `dr analyzer tier1`: the per-checkout opt-in to Tier 1 (the decision model) and its spend
 * (docs/analyzers/TIER1_DESIGN.md sections 2 and 4.3).
 *
 * - enable: write `.dr/analyzers/<analyzer>/tier1.json` (mode 0600), after making sure `.dr/` is
 *   git-ignored; keys are prompted for without echo, or come from the environment; runs the probe
 * - disable: delete the file (`--clear-cache` also deletes the cache); the spend ledger stays
 * - set: change one non-secret setting (`monthly-cap`, `concurrency`, `model`, `upstreams`)
 * - status: state, provider, model, where each key comes from (never its value), the month's spend
 * - test: the probe: a synthetic card through the configured adapter
 * - cache status | cache clear
 *
 * A person runs these; no MCP tool writes `tier1.json`. Nothing here prints a key.
 */
import { Command } from "commander";
import { isCancel, password } from "@clack/prompts";
import ansis from "ansis";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  credentialEnv,
  DEFAULT_CONCURRENCY,
  DEFAULT_MONTHLY_CAP_USD,
  defaultGit,
  formatDay,
  formatUsd,
  MAX_CONCURRENCY,
  monthLine,
  nearCapWarning,
  openTier1,
  parseUsd,
  providerDisplayName,
  providerNames,
  readTier1File,
  registeredModels,
  resolveModel,
  resolveTier1,
  setTier1Value,
  SETTABLE,
  SpendLedger,
  spendSummary,
  Tier1Cache,
  tier1Paths,
  writeTier1File,
  assertNoSymlink,
  probeCostEstimate,
  trackedUnder,
  credentialSources,
  probeAffordable,
  runProbe,
  tier1Status,
  type ProbeResult,
} from "../analyzers/classifier/index.js";
import { readSession } from "../analyzers/session-state.js";
import { dotDrIgnoreWarnings, ensureDotDrIgnored } from "../core/dot-dr-ignore.js";
import { Model } from "../core/model.js";
import { CLIError, ErrorCategory, ModelNotFoundError } from "../utils/errors.js";
import { findProjectRoot } from "../utils/project-paths.js";

/** The analyzer Tier 1 is configured for: `--name`, else the active one, else `cbm`. */
async function analyzerOf(projectRoot: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const session = await readSession(projectRoot).catch(() => null);
  return session?.active_analyzer ?? "cbm";
}

async function projectContext(name?: string): Promise<{ projectRoot: string; analyzer: string; codebaseRoot: string }> {
  const projectRoot = await findProjectRoot();
  if (!projectRoot) throw new ModelNotFoundError();
  const analyzer = await analyzerOf(projectRoot, name);
  let codebaseRoot = projectRoot;
  try {
    codebaseRoot = (await Model.load(projectRoot, { lazyLoad: true })).codebaseRoot;
  } catch {
    // the tracked check then runs from the project root only
  }
  return { projectRoot, analyzer, codebaseRoot };
}

function userError(e: unknown): never {
  if (e instanceof CLIError || e instanceof ModelNotFoundError) throw e;
  throw new CLIError(e instanceof Error ? e.message : String(e), ErrorCategory.USER);
}

/** The ignore rule that decides `.dr/`'s fate, from `git check-ignore -v` (a `!` rule un-ignores it). */
function deciding(projectRoot: string, rel: string): string | null {
  const r = defaultGit(projectRoot, ["check-ignore", "-v", "--no-index", "--", rel]);
  const line = r?.stdout.split("\n").find((l) => l.trim());
  return line ? line.split("\t")[0] : null;
}

function printProbe(probe: ProbeResult): void {
  const mark = probe.ok ? ansis.green("✓") : ansis.yellow("!");
  console.log(`${mark} Probe through ${providerDisplayName(probe.provider)} (${probe.model}) in ${probe.latencyMs} ms, $${probe.costUsd.toFixed(4)} (${probe.inputTokens} input tokens)`);
  if (probe.servedModel) console.log(`  answered by: ${probe.servedModel}${probe.upstream ? ` via ${probe.upstream}` : ""}`);
  if (probe.layer) {
    const top3 = Object.entries(probe.layer.probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(", ");
    console.log(`  layer: ${top3 || "no answer"}`);
  }
  if (probe.type) console.log(`  type:  ${probe.type.top ?? "none"}${probe.type.p !== null ? ` ${probe.type.p.toFixed(2)}` : ""}`);
  for (const f of probe.flags) console.log(ansis.yellow(`  ${f}`));
}

export function tier1Commands(analyzer: Command, program: Command): void {
  const tier1 = analyzer
    .command("tier1")
    .description("Opt this checkout in to Tier 1 (decision-model classification) and manage its spend and cache")
    .addHelpText(
      "after",
      `
Tier 1 sends Tier-0-undecided symbol cards to a decision model. It is off until enabled here,
per checkout, in .dr/analyzers/<analyzer>/tier1.json (git-ignored, mode 600). It spends at most
$${DEFAULT_MONTHLY_CAP_USD} a month by default: change it with \`dr analyzer tier1 set monthly-cap <dollars>\`
(0 sends nothing and uses only cached answers).

Examples:
  $ dr analyzer tier1 enable --provider cloudflare-workers-ai --model clef
  $ dr analyzer tier1 enable --provider cloudflare-workers-ai --model clef --use-env --monthly-cap 5
  $ dr analyzer tier1 status
  $ dr analyzer tier1 set monthly-cap 40
  $ dr analyzer tier1 test
  $ dr analyzer tier1 cache clear
  $ dr analyzer tier1 disable`
    );

  tier1
    .command("enable")
    .description("Write tier1.json (mode 600) for this checkout, after making sure .dr/ is git-ignored, and test it")
    .requiredOption("--provider <name>", `Decision-model provider (${providerNames().join(", ")})`)
    .requiredOption("--model <id>", "Model, e.g. clef or clef-flash")
    .option("--monthly-cap <usd>", `Monthly spend cap in dollars (default ${DEFAULT_MONTHLY_CAP_USD}; 0 sends nothing)`)
    .option("--concurrency <n>", `Cards in flight (default ${DEFAULT_CONCURRENCY}, at most ${MAX_CONCURRENCY})`)
    .option("--use-env", "Don't prompt for keys: the environment supplies them (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN)")
    .option("--no-test", "Don't send the probe after enabling")
    .option("--name <n>", "Analyzer name (defaults to the active one, else cbm)")
    .action(async (options) => {
      try {
        const { projectRoot, analyzer: name, codebaseRoot } = await projectContext(options.name);
        const paths = tier1Paths(projectRoot, name);
        const provider = String(options.provider);
        if (!providerNames().includes(provider)) {
          throw new CLIError(
            provider === "openrouter" ? "The openrouter provider is not available in this version of the CLI" : `Unknown provider "${provider}"`,
            ErrorCategory.USER,
            [`Available: ${providerNames().join(", ")}`]
          );
        }
        const registered = resolveModel(provider, String(options.model));
        if (!registered) {
          throw new CLIError(`Unknown model "${options.model}" for ${provider}`, ErrorCategory.USER, [
            `Known: ${registeredModels(provider)
              .map((m) => m.name)
              .join(", ")}`,
          ]);
        }
        const cap = options.monthlyCap !== undefined ? parseUsd(String(options.monthlyCap)) : undefined;
        let concurrency: number | undefined;
        if (options.concurrency !== undefined) {
          concurrency = Number(options.concurrency);
          if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
            throw new CLIError(`--concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`, ErrorCategory.USER);
          }
        }

        // Before any prompt or write. Tracked files under the analyzer's folder: an ignore rule
        // doesn't untrack them (git check-ignore calls a tracked path ignored all the same), so keys
        // written there would land in `git diff`. A symbolic link on the way can put the file in
        // a tracked folder that neither check sees.
        await assertNoSymlink(paths);
        const tracked = trackedUnder(paths, [projectRoot, codebaseRoot]);
        if (tracked.length) {
          const dirRel = path.posix.dirname(paths.configRelative);
          throw new CLIError(`git tracks ${tracked.length} file(s) under ${dirRel}/ (${tracked.slice(0, 3).join(", ")}${tracked.length > 3 ? ", ..." : ""}), so Tier 1 won't write tier1.json there`, ErrorCategory.USER, [
            `Untrack them: git rm -r --cached ${dirRel}`,
            "If tier1.json was committed with keys, rotate them: they are in the history",
          ]);
        }

        // .dr/ out of git first: the file may hold keys.
        const ignore = await ensureDotDrIgnored(projectRoot);
        const notIgnored = ignore.gitChecked ? !ignore.ignored : ignore.negated;
        const interactive = !options.useEnv && process.stdin.isTTY === true && process.stdout.isTTY === true;
        if (notIgnored && interactive) {
          const rule = deciding(projectRoot, paths.configRelative);
          throw new CLIError(".dr/ is not git-ignored, so keys won't be written to tier1.json", ErrorCategory.USER, [
            rule ? `This rule un-ignores it: ${rule}` : "Another ignore file un-ignores it",
            "Remove the rule (DR adds /.dr/ to .gitignore), or pass --use-env to keep the keys in the environment",
          ]);
        }

        // Keep keys already in the file for the same provider, unless new ones are entered.
        let previous: Record<string, unknown> | null = null;
        if (existsSync(paths.config)) previous = await readTier1File(paths).catch(() => null);
        const credentials: Record<string, string> = {};
        if (previous && previous.provider === provider && previous.credentials && typeof previous.credentials === "object") {
          for (const [k, v] of Object.entries(previous.credentials as Record<string, unknown>)) if (typeof v === "string" && v) credentials[k] = v;
        }
        if (!interactive && !options.useEnv) console.log(ansis.dim("No terminal to prompt for keys on: the environment supplies them (as with --use-env)."));
        if (interactive) {
          for (const [cred, variable] of Object.entries(credentialEnv(provider))) {
            const kept = credentials[cred] ? "keep the one in tier1.json" : `use ${variable} from the environment`;
            const value = await password({ message: `${cred} for ${providerDisplayName(provider)} (Enter to ${kept})` });
            if (isCancel(value)) throw new CLIError("Cancelled: tier1.json was not written", ErrorCategory.USER);
            const v = String(value).trim();
            if (v) credentials[cred] = v;
          }
        }

        const content: Record<string, unknown> = {
          version: 1,
          provider,
          model: registered.name,
          ...(Object.keys(credentials).length ? { credentials } : {}),
          monthlyCapUsd: cap ?? (typeof previous?.monthlyCapUsd === "number" ? previous.monthlyCapUsd : DEFAULT_MONTHLY_CAP_USD),
          ...(concurrency !== undefined ? { concurrency } : typeof previous?.concurrency === "number" ? { concurrency: previous.concurrency } : {}),
        };
        if (Object.keys(credentials).length && notIgnored) {
          throw new CLIError(".dr/ is not git-ignored, so keys won't be written to tier1.json", ErrorCategory.USER, [
            "Fix the ignore rule, or delete tier1.json and enable with --use-env",
          ]);
        }
        await writeTier1File(paths, content);

        console.log(ansis.green(`✓ Tier 1 enabled: ${providerDisplayName(provider)} ${registered.name} (${registered.id}), written to ${paths.configRelative} (mode 600)`));
        if (ignore.added) console.log(`  Added /.dr/ to ${ignore.path}: commit it with your code.`);
        for (const w of dotDrIgnoreWarnings(ignore)) console.log(ansis.yellow(`  ${w}`));

        const env = process.env;
        const resolved = await resolveTier1(projectRoot, name, { codebaseRoot, env });
        for (const [cred, s] of Object.entries(credentialSources(resolved, env))) {
          console.log(`  ${cred}: ${s.set ? `set (from ${s.from})` : ansis.yellow(`not set: put ${credentialEnv(provider)[cred]} in the environment`)}`);
        }
        const monthlyCap = Number(content.monthlyCapUsd);
        console.log(`  Monthly cap: ${formatUsd(monthlyCap)}${monthlyCap === 0 ? " (sends nothing, uses only cached answers)" : ""}. Change it with \`dr analyzer tier1 set monthly-cap <dollars>\`.`);
        for (const w of resolved.state === "off" ? [] : resolved.warnings) console.log(ansis.yellow(`  ${w}`));

        if (resolved.state !== "ready") {
          console.log(ansis.yellow(`  Tier 1 is ${resolved.state}: ${resolved.reason}`));
          return;
        }
        if (options.test === false) return;
        const session = await openTier1(projectRoot, name, { codebaseRoot });
        if (session.state !== "ready") return;
        if (!probeAffordable(session)) {
          console.log(ansis.dim(`  The probe was not sent: the month has ${formatUsd(session.month.remainingUsd)} left, less than the probe's ~$${probeCostEstimate(session.model).toFixed(4)}. \`dr analyzer tier1 test\` sends it once the cap allows.`));
          return;
        }
        console.log(ansis.dim(`  Testing: one synthetic card (no project code) to ${session.party}...`));
        printProbe(await runProbe(session));
      } catch (e) {
        userError(e);
      }
    });

  tier1
    .command("disable")
    .description("Delete tier1.json (the spend ledger stays; --clear-cache also deletes the cache)")
    .option("--clear-cache", "Also delete the Tier-1 cache for this checkout")
    .option("--name <n>", "Analyzer name (defaults to the active one, else cbm)")
    .action(async (options) => {
      try {
        const { projectRoot, analyzer: name } = await projectContext(options.name);
        const paths = tier1Paths(projectRoot, name);
        const existed = existsSync(paths.config);
        await rm(paths.config, { force: true });
        console.log(existed ? ansis.green(`✓ Tier 1 disabled: ${paths.configRelative} deleted`) : `Tier 1 was not enabled (no ${paths.configRelative})`);
        if (options.clearCache) {
          const cleared = await new Tier1Cache(paths.cache).clear();
          console.log(`  Cache cleared: ${cleared.entries.toLocaleString("en-US")} answers (${(cleared.bytes / 1024).toFixed(0)} KB).`);
        } else if (existsSync(paths.cache)) {
          console.log(ansis.dim("  The cache is kept, so enabling again doesn't pay twice (`dr analyzer tier1 cache clear` deletes it)."));
        }
        if (existsSync(paths.ledger)) console.log(ansis.dim("  The spend ledger is kept: this month's spend still counts if Tier 1 is enabled again."));
      } catch (e) {
        userError(e);
      }
    });

  tier1
    .command("set <setting> <value>")
    .description(`Change a setting in tier1.json: ${SETTABLE.join(", ")} (keys are set with enable)`)
    .option("--name <n>", "Analyzer name (defaults to the active one, else cbm)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr analyzer tier1 set monthly-cap 40     # dollars per calendar month (UTC); 0 sends nothing
  $ dr analyzer tier1 set concurrency 2
  $ dr analyzer tier1 set model clef-flash`
    )
    .action(async (setting: string, value: string, options) => {
      try {
        const { projectRoot, analyzer: name } = await projectContext(options.name);
        const paths = tier1Paths(projectRoot, name);
        const what = await setTier1Value(paths, setting, value);
        console.log(ansis.green(`✓ ${what} in ${paths.configRelative}`));
        if (setting === "monthly-cap") {
          const content = await readTier1File(paths);
          const month = await new SpendLedger(paths.ledger).month(Number(content.monthlyCapUsd));
          console.log(`  ${monthLine(month)}`);
        }
      } catch (e) {
        userError(e);
      }
    });

  tier1
    .command("status")
    .description("Show whether Tier 1 is on, its provider and model, where its keys come from, and this month's spend")
    .option("--json", "Output as JSON")
    .option("--name <n>", "Analyzer name (defaults to the active one, else cbm)")
    .action(async (options) => {
      const jsonMode = options.json ?? program.opts().json;
      try {
        const { projectRoot, analyzer: name, codebaseRoot } = await projectContext(options.name);
        const out = await tier1Status(projectRoot, name, { codebaseRoot, env: process.env });
        if (jsonMode) {
          console.log(JSON.stringify(out, null, 2));
          return;
        }
        const { state, month, cache } = out;
        const colour = state === "on" ? ansis.green : state === "off" ? ansis.dim : ansis.yellow;
        console.log("");
        console.log(ansis.bold(`Tier 1: ${colour(state)}`) + (out.reason ? ` (${out.reason})` : ""));
        console.log(ansis.dim("─".repeat(60)));
        console.log(`  Config:      ${out.config}${existsSync(path.join(projectRoot, out.config)) ? "" : " (none)"}`);
        if (out.provider) {
          console.log(`  Provider:    ${providerDisplayName(out.provider)}, model ${out.model}${out.modelId ? ` (${out.modelId})` : ""}`);
          console.log(`  Concurrency: ${out.concurrency}`);
        }
        for (const [cred, s] of Object.entries(out.credentials)) console.log(`  ${cred.padEnd(12)} ${s.set ? `set (from ${s.from})` : ansis.yellow("not set")}`);
        console.log(`  Spend:       ${spendSummary(month)}, resets ${formatDay(month.resetsAt)} (UTC)`);
        console.log(`  Monthly cap: ${formatUsd(month.capUsd)}; change it with \`dr analyzer tier1 set monthly-cap <dollars>\``);
        const near = nearCapWarning(month);
        if (near) console.log(ansis.yellow(`  ${near}`));
        console.log(`  Cache:       ${cache.entries.toLocaleString("en-US")} answers, ${(cache.bytes / 1024).toFixed(0)} KB${cache.lastCompaction ? `, compacted ${cache.lastCompaction}` : ""}`);
        for (const w of out.warnings) console.log(ansis.yellow(`  ${w}`));
        console.log(ansis.dim("  The ledger counts this checkout only, not other clones or machines on the same account."));
        console.log("");
      } catch (e) {
        userError(e);
      }
    });

  tier1
    .command("test")
    .description("Send the probe (one synthetic card, no project code) through the configured provider")
    .option("--json", "Output as JSON")
    .option("--name <n>", "Analyzer name (defaults to the active one, else cbm)")
    .action(async (options) => {
      const jsonMode = options.json ?? program.opts().json;
      try {
        const { projectRoot, analyzer: name, codebaseRoot } = await projectContext(options.name);
        const session = await openTier1(projectRoot, name, { codebaseRoot });
        if (session.state !== "ready") throw new CLIError(`Tier 1 is ${session.state}: ${session.block.reason}`, ErrorCategory.USER);
        if (!probeAffordable(session)) {
          throw new CLIError(
            `The probe was not sent: it costs about $${probeCostEstimate(session.model).toFixed(4)} and ${monthLine(session.month)}`,
            ErrorCategory.USER,
            ["Raise the cap: `dr analyzer tier1 set monthly-cap <dollars>`"]
          );
        }
        if (!jsonMode) console.log(ansis.dim(`Sending one synthetic card (no project code) to ${session.party}...`));
        const probe = await runProbe(session);
        if (jsonMode) console.log(JSON.stringify(probe, null, 2));
        else printProbe(probe);
        if (!probe.ok) throw new CLIError("The probe found a problem with this configuration", ErrorCategory.USER, probe.flags);
      } catch (e) {
        userError(e);
      }
    });

  const cache = tier1.command("cache").description("Tier 1's answer cache: status and clear");

  cache
    .command("status")
    .description("Show the cache's entries, size, hosts and last compaction")
    .option("--json", "Output as JSON")
    .option("--name <n>", "Analyzer name (defaults to the active one, else cbm)")
    .action(async (options) => {
      const jsonMode = options.json ?? program.opts().json;
      try {
        const { projectRoot, analyzer: name } = await projectContext(options.name);
        const status = await new Tier1Cache(tier1Paths(projectRoot, name).cache).status();
        if (jsonMode) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }
        console.log("");
        console.log(ansis.bold(`Tier-1 cache: ${status.entries.toLocaleString("en-US")} answers, ${(status.bytes / 1024).toFixed(0)} KB`));
        console.log(ansis.dim("─".repeat(60)));
        for (const f of status.files) {
          console.log(`  ${`${f.qset} / ${f.host} / ${f.model}`.padEnd(48)} ${String(f.entries).padStart(7)}  ${(f.bytes / 1024).toFixed(0).padStart(6)} KB  ${f.lastWrite ?? ""}`);
        }
        if (!status.files.length) console.log(ansis.dim("  (empty)"));
        console.log(status.lastCompaction ? `  Last compaction: ${status.lastCompaction.at} (${status.lastCompaction.droppedEntries} dropped)` : ansis.dim("  Never compacted"));
        console.log("");
      } catch (e) {
        userError(e);
      }
    });

  cache
    .command("clear")
    .description("Delete the cache for this checkout (refilling it costs money); --qset/--model limit it")
    .option("--qset <id>", "Only this question set's answers")
    .option("--model <name>", "Only this model's answers (canonical name, e.g. clef)")
    .option("--name <n>", "Analyzer name (defaults to the active one, else cbm)")
    .action(async (options) => {
      try {
        const { projectRoot, analyzer: name } = await projectContext(options.name);
        const paths = tier1Paths(projectRoot, name);
        const cleared = await new Tier1Cache(paths.cache).clear({
          ...(options.qset ? { qset: String(options.qset) } : {}),
          ...(options.model ? { model: String(options.model) } : {}),
        });
        if (!cleared.entries) {
          console.log("The cache held nothing to clear.");
          return;
        }
        let concurrency = DEFAULT_CONCURRENCY;
        const raw = existsSync(paths.config) ? await readTier1File(paths).catch(() => null) : null;
        if (raw && typeof raw.concurrency === "number") concurrency = raw.concurrency;
        const minutes = (cleared.entries * 0.739) / concurrency / 60;
        console.log(ansis.green(`✓ Cleared ${cleared.entries.toLocaleString("en-US")} cached answers (${(cleared.bytes / 1024).toFixed(0)} KB).`));
        console.log(`  Refilling them costs about ${formatUsd(cleared.costUsd)} and ${minutes < 1 ? "under a minute" : `${Math.round(minutes)} minutes`} at concurrency ${concurrency}, against the monthly cap.`);
      } catch (e) {
        userError(e);
      }
    });
}
