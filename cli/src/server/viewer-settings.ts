/**
 * The viewer's time limits, as named settings.
 *
 * Every period that decides when a viewer ends, when a probe gives up or when a file is removed
 * is here with its default, read from an environment variable, so none of them is a constant
 * buried in the code that behaves differently from what its user expects. `dr visualize --list
 * --json` prints the values in effect, and a value that cannot be used is reported, not silently
 * replaced.
 */

export interface ViewerSettingSpec {
  /** The environment variable that sets it. */
  env: string;
  default: number;
  unit: "hours" | "days" | "ms";
  /** The smallest value that is accepted. */
  min: number;
  description: string;
}

export const VIEWER_SETTINGS = {
  idleHours: {
    env: "DR_VIEWER_IDLE_HOURS",
    default: 24,
    unit: "hours",
    min: 0,
    description:
      "How long a viewer review_open starts may go with no browser tab connected and no request before it exits. 0: never.",
  },
  healthTimeoutMs: {
    env: "DR_VIEWER_HEALTH_TIMEOUT_MS",
    default: 1500,
    unit: "ms",
    min: 1,
    description: "How long a viewer gets to answer its health check before it counts as not answering.",
  },
  healthRetryTimeoutMs: {
    env: "DR_VIEWER_HEALTH_RETRY_TIMEOUT_MS",
    default: 5000,
    unit: "ms",
    min: 1,
    description:
      "How long a project's viewers get on a second health check, made when none answered the first, before review_open calls one unreachable.",
  },
  statusHealthTimeoutMs: {
    env: "DR_VIEWER_STATUS_HEALTH_TIMEOUT_MS",
    default: 500,
    unit: "ms",
    min: 1,
    description:
      "How long project_status gives a viewer to answer its health check (the second try gets twice as long). Shorter than DR_VIEWER_HEALTH_TIMEOUT_MS so the status call stays fast; a viewer slower than that is reported unreachable, with this setting named.",
  },
  stopTimeoutMs: {
    env: "DR_VIEWER_STOP_TIMEOUT_MS",
    default: 8000,
    unit: "ms",
    min: 1,
    description: "How long a viewer gets to exit after SIGTERM before `dr visualize --stop` or a restart kills it.",
  },
  logKeepDays: {
    env: "DR_VIEWER_LOG_KEEP_DAYS",
    default: 7,
    unit: "days",
    min: 0,
    description: "How long the log of a viewer that is gone is kept in the viewers directory.",
  },
  lifetimeCheckMs: {
    env: "DR_VIEWER_LIFETIME_CHECK_MS",
    default: 30_000,
    unit: "ms",
    min: 1,
    description:
      "How often the DR process checks whether it is idle.",
  },
} as const satisfies Record<string, ViewerSettingSpec>;

export type ViewerSettingName = keyof typeof VIEWER_SETTINGS;

/** A plain decimal number: no sign, exponent, hex or "Infinity", which Number() would take. */
const DECIMAL = /^\d+(?:\.\d+)?$/;

function parse(spec: ViewerSettingSpec, raw: string | undefined): { value: number; valid: boolean } {
  if (raw === undefined || raw.trim() === "") return { value: spec.default, valid: true };
  const text = raw.trim();
  const value = Number(text);
  if (!DECIMAL.test(text) || !Number.isFinite(value) || value < spec.min) return { value: spec.default, valid: false };
  return { value, valid: true };
}

/** A setting's value: from its environment variable, else its default (also for a value that cannot be used). */
export function viewerSetting(name: ViewerSettingName, env: NodeJS.ProcessEnv = process.env): number {
  const spec = VIEWER_SETTINGS[name];
  return parse(spec, env[spec.env]).value;
}

/** A setting as it is in effect, for showing to a person. */
export interface ViewerSettingInEffect {
  env: string;
  value: number;
  unit: ViewerSettingSpec["unit"];
  default: number;
  /** Set when the variable holds something that cannot be used; `value` is then the default. */
  ignored?: string;
}

/** Every setting's value in effect, and which variables hold a value that was ignored. */
export function viewerSettingsInEffect(env: NodeJS.ProcessEnv = process.env): Record<ViewerSettingName, ViewerSettingInEffect> {
  const result = {} as Record<ViewerSettingName, ViewerSettingInEffect>;
  for (const name of Object.keys(VIEWER_SETTINGS) as ViewerSettingName[]) {
    const spec: ViewerSettingSpec = VIEWER_SETTINGS[name];
    const raw = env[spec.env];
    const parsed = parse(spec, raw);
    result[name] = {
      env: spec.env,
      value: parsed.value,
      unit: spec.unit,
      default: spec.default,
      ...(parsed.valid ? {} : { ignored: raw }),
    };
  }
  return result;
}

/** One line per variable whose value was ignored, for a warning. */
export function ignoredViewerSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.values(viewerSettingsInEffect(env))
    .filter((setting) => setting.ignored !== undefined)
    .map(
      (setting) =>
        `${setting.env}=${setting.ignored} is not a usable value; using the default, ${setting.default} ${setting.unit}.`
    );
}
