/**
 * The environment a call runs under: the process's, with a session's own values for the variables
 * that describe who is calling (issue 1279, slice 3A).
 *
 * Before the central process, every MCP client had its own `dr mcp` process, and a launcher set
 * these variables on it: DrBot ran its server with DR_CHAT_MODE, DR_CHAT_PROJECT_ROOT,
 * DR_CHANGESET_ONLY and DR_CHANGESET_ORIGIN. Now `dr mcp` is a bridge to one shared process, so the
 * bridge sends its own values of them with the session, and the central process runs each of that
 * session's tool calls under them ({@link runWithSessionEnv}). Code that reads them takes
 * {@link sessionEnv} as its default environment.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** The variables a session carries to the central process. Others are the process's own. */
export const SESSION_ENV_KEYS = [
  "DR_CHAT_MODE",
  "DR_CHAT_PROJECT_ROOT",
  "DR_CHANGESET_ONLY",
  "DR_CHANGESET_ORIGIN",
] as const;

export type SessionEnvKey = (typeof SESSION_ENV_KEYS)[number];
export type SessionEnvValues = Partial<Record<SessionEnvKey, string>>;

const storage = new AsyncLocalStorage<NodeJS.ProcessEnv>();

/** The session's values of SESSION_ENV_KEYS that `env` sets (non-empty). */
export function pickSessionEnv(env: NodeJS.ProcessEnv): SessionEnvValues {
  const values: SessionEnvValues = {};
  for (const key of SESSION_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value !== "") values[key] = value;
  }
  return values;
}

/**
 * Runs `fn` under a session's values: inside it, {@link sessionEnv} is the process environment
 * with every SESSION_ENV_KEYS variable replaced by the session's (unset when the session has none).
 */
export function runWithSessionEnv<T>(values: SessionEnvValues, fn: () => T): T {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SESSION_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return storage.run(env, fn);
}

/** The environment of the current call: a session's (see runWithSessionEnv), else the process's. */
export function sessionEnv(): NodeJS.ProcessEnv {
  return storage.getStore() ?? process.env;
}
