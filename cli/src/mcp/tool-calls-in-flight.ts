/**
 * How many MCP tool calls are running in this process. The central process counts them as use: it
 * never stops for a restart while one runs (server/central-lifetime.ts, `centralStaleReason`).
 */

let running = 0;

/** MCP tool calls running now in this process. */
export function toolCallsInFlight(): number {
  return running;
}

/** Runs a tool call, counted while it runs. */
export async function countToolCall<T>(call: () => Promise<T>): Promise<T> {
  running++;
  try {
    return await call();
  } finally {
    running--;
  }
}
