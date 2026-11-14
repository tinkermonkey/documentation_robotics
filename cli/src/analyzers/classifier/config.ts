/**
 * Tier 1's opt-in: `.dr/analyzers/<analyzer>/tier1.json` (TIER1_DESIGN.md section 2).
 *
 * Without the file Tier 1 is off, whatever credentials the environment holds. The file names the
 * provider and model and may hold keys; the main protection is that `.dr/` is git-ignored
 * (`ensureDotDrIgnored`, run by `dr init`, `dr upgrade` and `dr analyzer tier1 enable`). These
 * checks are defence in depth, run every time the file is read:
 *
 * - **Not tracked.** If git tracks the file (from the project root, and from the codebase root when
 *   it differs), Tier 1 refuses it: the keys are in the history.
 * - **Permissions.** Keys in a file readable by group or others are refused (chmod 600); without
 *   keys a loose mode is a warning. Windows has no POSIX mode bits: the check is skipped, and said.
 * - **Credentials.** Per credential, the file's value, else the provider's environment variable
 *   (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`). The CLI reads no `.env` file.
 *
 * Keys never leave this module in a form that prints: {@link Tier1Credentials} keeps them in a
 * private field, and its JSON and inspect forms name only where each came from. No message built
 * here quotes the file's content. No MCP tool writes this file.
 */
import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";
import { z } from "zod";
import { credentialEnv, providerNames, registeredModels, resolveModel, type RegisteredModel } from "./decision-model/registry.js";
import type { Thresholds } from "./bands.js";

export const TIER1_CONFIG_FILE = "tier1.json";
export const DEFAULT_MONTHLY_CAP_USD = 20;
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 16;

/** Providers the config shape knows, registered or not (`openrouter` is rollout PR 6). */
export const KNOWN_PROVIDERS = ["cloudflare-workers-ai", "openrouter"] as const;

/** Where Tier 1 keeps its per-checkout state. */
export interface Tier1Paths {
  /** `.dr/analyzers/<analyzer>` */
  dir: string;
  /** `tier1.json` */
  config: string;
  /** `tier1-cache/` */
  cache: string;
  /** `tier1-spend.jsonl` */
  ledger: string;
  /** `classify/`: one folder per `dr analyzer classify` run. */
  runs: string;
  /** The config file relative to the project root, for messages. */
  configRelative: string;
}

export function tier1Paths(projectRoot: string, analyzer: string): Tier1Paths {
  if (!analyzer || /[\\/]/.test(analyzer) || analyzer.includes("..")) throw new Error(`Invalid analyzer name: ${analyzer}`);
  const dir = path.join(projectRoot, ".dr", "analyzers", analyzer);
  return {
    dir,
    config: path.join(dir, TIER1_CONFIG_FILE),
    cache: path.join(dir, "tier1-cache"),
    ledger: path.join(dir, "tier1-spend.jsonl"),
    runs: path.join(dir, "classify"),
    configRelative: path.posix.join(".dr", "analyzers", analyzer, TIER1_CONFIG_FILE),
  };
}

const Probability = z.number().min(0).max(1);

const OpenRouterSchema = z.object({
  only: z.array(z.string().min(1)).min(1),
  allowFallbacks: z.boolean().optional(),
  dataCollection: z.enum(["deny", "allow"]).optional(),
  zdr: z.boolean().optional(),
});

const FileSchema = z
  .object({
    version: z.literal(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    credentials: z.record(z.string(), z.string()).optional(),
    monthlyCapUsd: z.number().finite().min(0).optional(),
    concurrency: z.number().int().min(1).max(MAX_CONCURRENCY).optional(),
    openrouter: OpenRouterSchema.optional(),
    thresholds: z.object({ layer: Probability, type: Probability, none: Probability }).partial().optional(),
    debug: z.object({ applyNotElement: z.boolean().optional() }).optional(),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    if (v.provider === "openrouter" && !v.openrouter?.only?.length) {
      ctx.addIssue({ code: "custom", path: ["openrouter", "only"], message: "openrouter.only must name the upstreams allowed to receive card text" });
    }
  });

const TOP_LEVEL_KEYS = new Set(["version", "provider", "model", "credentials", "monthlyCapUsd", "concurrency", "openrouter", "thresholds", "debug"]);

/** `tier1.json` as Tier 1 runs with it: defaults filled in, credentials out (see {@link Tier1Credentials}). */
export interface Tier1Config {
  version: 1;
  provider: string;
  model: string;
  monthlyCapUsd: number;
  concurrency: number;
  openrouter?: z.infer<typeof OpenRouterSchema>;
  thresholds?: Partial<Thresholds>;
  debug?: { applyNotElement?: boolean };
  /** Credential names the file holds a value for (never the values). */
  fileCredentials: string[];
}

/**
 * A provider's credentials, resolved. The values sit in a private field: `JSON.stringify` and
 * `inspect` show only where each came from, so a config logged by mistake leaks nothing.
 */
export class Tier1Credentials {
  readonly #values: Record<string, string>;
  /** Credential name -> where its value came from: `tier1.json` or an environment variable's name. */
  readonly sources: Readonly<Record<string, string>>;

  constructor(values: Record<string, string>, sources: Record<string, string>) {
    this.#values = { ...values };
    this.sources = Object.freeze({ ...sources });
  }

  /** The values, for handing to the adapter factory and nothing else. */
  reveal(): Record<string, string> {
    return { ...this.#values };
  }

  /** The last four characters of a non-secret identifier (the Cloudflare account id), for the notice. */
  tail(name: string): string | undefined {
    const v = this.#values[name];
    return v ? v.slice(-4) : undefined;
  }

  toJSON(): { sources: Record<string, string> } {
    return { sources: { ...this.sources } };
  }

  [inspect.custom](): string {
    return `Tier1Credentials { ${Object.entries(this.sources)
      .map(([k, s]) => `${k}: from ${s}`)
      .join(", ")} }`;
  }
}

export type ResolvedTier1 =
  | { state: "off"; paths: Tier1Paths; reason: string; /** Provider variables set in the environment and unused. */ envSet: string[] }
  | { state: "misconfigured"; paths: Tier1Paths; reason: string; warnings: string[] }
  | { state: "no-credentials"; paths: Tier1Paths; config: Tier1Config; reason: string; missing: string[]; warnings: string[] }
  | {
      state: "ready";
      paths: Tier1Paths;
      config: Tier1Config;
      model: RegisteredModel;
      credentials: Tier1Credentials;
      warnings: string[];
    };

export type GitRunner = (cwd: string, args: string[]) => { status: number | null; stdout: string } | null;

export interface ResolveTier1Options {
  /** The environment credentials are read from; default `process.env`. Tests pass their own. */
  env?: Record<string, string | undefined>;
  /** The platform the permission check runs for; default `process.platform`. */
  platform?: NodeJS.Platform;
  /** The codebase root, when it differs from the project root: the tracked check runs there too. */
  codebaseRoot?: string;
  git?: GitRunner;
}

export const defaultGit: GitRunner = (cwd, args) => {
  try {
    const r = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 10_000 });
    if (r.error) return null;
    return { status: r.status, stdout: r.stdout ?? "" };
  } catch {
    return null;
  }
};

/** True when git tracks `file` in the repository at `root`. */
export function isTrackedByGit(file: string, root: string, git: GitRunner = defaultGit): boolean {
  const r = git(root, ["ls-files", "--error-unmatch", "--", file]);
  return r?.status === 0;
}

/** Environment variables of every provider that are set (names only). */
export function providerEnvSet(env: Record<string, string | undefined>): string[] {
  const names = new Set<string>();
  for (const p of providerNames()) for (const v of Object.values(credentialEnv(p))) if (env[v]) names.add(v);
  if (env.OPENROUTER_API_KEY) names.add("OPENROUTER_API_KEY");
  return [...names].sort();
}

function issuesOf(error: z.ZodError): string {
  // Paths and expectations only: zod's messages don't quote values, and none are added here.
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(file)"}: ${i.message}`).join("; ");
}

/** Read and check `tier1.json` (section 2). Never throws for the file's content; never quotes it. */
export async function resolveTier1(projectRoot: string, analyzer: string, options: ResolveTier1Options = {}): Promise<ResolvedTier1> {
  const paths = tier1Paths(projectRoot, analyzer);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const git = options.git ?? defaultGit;
  const rel = paths.configRelative;

  let text: string;
  try {
    text = await readFile(paths.config, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const envSet = providerEnvSet(env);
      const unused = envSet.length ? ` (${envSet.join(", ")} ${envSet.length === 1 ? "is" : "are"} set and unused)` : "";
      return { state: "off", paths, envSet, reason: `no ${rel}: Tier 1 is opt-in${unused}. Enable it with \`dr analyzer tier1 enable --provider <name> --model <id>\`.` };
    }
    return { state: "misconfigured", paths, reason: `${rel} could not be read (${code ?? "error"})`, warnings: [] };
  }

  const warnings: string[] = [];
  for (const root of [...new Set([projectRoot, options.codebaseRoot].filter((r): r is string => !!r))]) {
    if (isTrackedByGit(paths.config, root, git)) {
      return {
        state: "misconfigured",
        paths,
        reason: `${rel} is tracked by git: \`git rm --cached ${rel}\`, and rotate any keys in it, which are in the history`,
        warnings,
      };
    }
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // The parser's message can quote the text around the error, which may be a key: not repeated.
    return { state: "misconfigured", paths, reason: `${rel} is not valid JSON`, warnings };
  }
  const parsed = FileSchema.safeParse(json);
  if (!parsed.success) return { state: "misconfigured", paths, reason: `${rel} is invalid: ${issuesOf(parsed.error)}`, warnings };
  const file = parsed.data;
  const fileCredentials = Object.entries(file.credentials ?? {})
    .filter(([, v]) => v !== "")
    .map(([k]) => k);

  if (platform === "win32") {
    warnings.push(`${rel}: the permission check is skipped on Windows (no POSIX mode bits); keep the file private`);
  } else {
    const mode = (await stat(paths.config)).mode & 0o777;
    if (mode & 0o077) {
      if (fileCredentials.length) {
        return { state: "misconfigured", paths, reason: `${rel} holds keys and is readable by others: chmod 600 ${rel}`, warnings };
      }
      warnings.push(`${rel} is readable by others (mode ${mode.toString(8)}); it holds no keys, but chmod 600 it before adding any`);
    }
  }

  const unknownKeys = Object.keys(file).filter((k) => !TOP_LEVEL_KEYS.has(k));
  if (unknownKeys.length) warnings.push(`${rel}: unknown setting${unknownKeys.length > 1 ? "s" : ""} ignored: ${unknownKeys.join(", ")}`);

  const config: Tier1Config = {
    version: 1,
    provider: file.provider,
    model: file.model,
    monthlyCapUsd: file.monthlyCapUsd ?? DEFAULT_MONTHLY_CAP_USD,
    concurrency: file.concurrency ?? DEFAULT_CONCURRENCY,
    ...(file.openrouter ? { openrouter: file.openrouter } : {}),
    ...(file.thresholds ? { thresholds: file.thresholds } : {}),
    ...(file.debug ? { debug: file.debug } : {}),
    fileCredentials,
  };

  if (!providerNames().includes(config.provider)) {
    const why = (KNOWN_PROVIDERS as readonly string[]).includes(config.provider)
      ? `provider "${config.provider}" is not available in this version of the CLI`
      : `unknown provider "${config.provider}"`;
    return { state: "misconfigured", paths, reason: `${rel}: ${why} (available: ${providerNames().join(", ")})`, warnings };
  }
  const model = resolveModel(config.provider, config.model);
  if (!model) {
    const known = registeredModels(config.provider).map((m) => m.name);
    return { state: "misconfigured", paths, reason: `${rel}: unknown model "${config.model}" for ${config.provider} (known: ${known.join(", ")})`, warnings };
  }

  const wanted = credentialEnv(config.provider);
  const extra = fileCredentials.filter((k) => !(k in wanted));
  if (extra.length) warnings.push(`${rel}: credentials ${extra.join(", ")} are not used by ${config.provider}`);
  const values: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const missing: string[] = [];
  for (const [name, variable] of Object.entries(wanted)) {
    const fromFile = file.credentials?.[name];
    if (fromFile) {
      values[name] = fromFile;
      sources[name] = TIER1_CONFIG_FILE;
    } else if (env[variable]) {
      values[name] = env[variable] as string;
      sources[name] = variable;
    } else missing.push(`credentials.${name} in ${TIER1_CONFIG_FILE} or ${variable}`);
  }
  if (missing.length) {
    return {
      state: "no-credentials",
      paths,
      config,
      missing,
      reason: `${config.provider} needs ${missing.join(" and ")}`,
      warnings,
    };
  }
  return { state: "ready", paths, config, model, credentials: new Tier1Credentials(values, sources), warnings };
}

/** The file's JSON as written (credentials included), for `enable` and `set` to update. Throws if it can't be read or parsed. */
export async function readTier1File(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${path.basename(file)} does not exist: run \`dr analyzer tier1 enable\` first`);
    throw new Error(`${path.basename(file)} could not be read (${(e as NodeJS.ErrnoException).code ?? "error"})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path.basename(file)} is not valid JSON; fix or delete it (\`dr analyzer tier1 disable\`)`);
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(`${path.basename(file)} is not a JSON object`);
  return json as Record<string, unknown>;
}

/**
 * Write `tier1.json` with mode 0600: a temporary file created 0600 in the same folder, chmod-ed
 * (the umask can't loosen it, but an existing temporary could), then renamed over the old one, so
 * the file is never readable by others, not even for a moment.
 */
export async function writeTier1File(file: string, content: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tmp, JSON.stringify(content, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** The non-secret settings `dr analyzer tier1 set` changes (section 4.3). Keys are set only through `enable`. */
export const SETTABLE = ["monthly-cap", "concurrency", "model", "upstreams"] as const;
export type Settable = (typeof SETTABLE)[number];

/**
 * Change one setting in `tier1.json`, keeping everything else (keys included) and mode 0600.
 * Returns a one-line description of the change. Throws a message for the user on a bad value.
 */
export async function setTier1Value(file: string, setting: string, value: string): Promise<string> {
  if (!(SETTABLE as readonly string[]).includes(setting)) {
    throw new Error(`Unknown setting "${setting}"; settable: ${SETTABLE.join(", ")}. Keys are set with \`dr analyzer tier1 enable\`.`);
  }
  const content = await readTier1File(file);
  const provider = typeof content.provider === "string" ? content.provider : "";
  switch (setting as Settable) {
    case "monthly-cap": {
      const usd = parseUsd(value);
      content.monthlyCapUsd = usd;
      await writeTier1File(file, content);
      return usd === 0 ? "monthly cap set to $0.00: Tier 1 sends nothing and uses only cached answers" : `monthly cap set to ${formatUsd(usd)}`;
    }
    case "concurrency": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_CONCURRENCY) throw new Error(`concurrency must be an integer from 1 to ${MAX_CONCURRENCY}, got "${value}"`);
      content.concurrency = n;
      await writeTier1File(file, content);
      return `concurrency set to ${n}`;
    }
    case "model": {
      const m = resolveModel(provider, value);
      if (!m) {
        const known = registeredModels(provider).map((r) => r.name);
        throw new Error(`unknown model "${value}" for ${provider || "this provider"}${known.length ? ` (known: ${known.join(", ")})` : ""}`);
      }
      content.model = m.name;
      await writeTier1File(file, content);
      return `model set to ${m.name} (${m.id})`;
    }
    case "upstreams": {
      if (provider !== "openrouter") throw new Error(`upstreams apply to the openrouter provider only; this file uses ${provider || "no provider"}`);
      const only = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!only.length) throw new Error("upstreams needs at least one name, comma-separated");
      const openrouter = content.openrouter && typeof content.openrouter === "object" ? (content.openrouter as Record<string, unknown>) : {};
      content.openrouter = { ...openrouter, only };
      await writeTier1File(file, content);
      return `upstreams set to ${only.join(", ")}`;
    }
  }
}

/** A dollar amount from the command line: a finite number >= 0, `$` allowed. */
export function parseUsd(value: string): number {
  const n = Number(String(value).trim().replace(/^\$/, ""));
  if (!Number.isFinite(n) || n < 0 || String(value).trim() === "") throw new Error(`a monthly cap must be a dollar amount of 0 or more, got "${value}"`);
  return Math.round(n * 100) / 100;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
