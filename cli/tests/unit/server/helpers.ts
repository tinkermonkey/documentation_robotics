import { spyOn } from "bun:test";
import type { Model } from "../../../src/core/model.js";
import {
  VisualizationServer,
  type VisualizationServerOptions,
} from "../../../src/server/server.js";

/**
 * Constructs a VisualizationServer without detecting the installed chat CLIs.
 *
 * The constructor starts `initializeChatClients()`, which probes the real binaries with
 * `spawnSync` (`which claude`, then `copilot --version`, about 3 s where Copilot is installed).
 * A `spawnSync` freezes the whole test process, so under `bun test --concurrent` one probe per
 * test adds up, and tests that wait on a fixture subprocess time out. The stub only covers the
 * synchronous constructor call, so tests running at the same time are unaffected.
 */
export function createServerWithoutChatDetection(
  model: Model,
  options?: VisualizationServerOptions
): VisualizationServer {
  const detect = spyOn(VisualizationServer.prototype as any, "initializeChatClients").mockResolvedValue(
    undefined
  );
  try {
    return new VisualizationServer(model, options);
  } finally {
    detect.mockRestore();
  }
}

/** Minimal stand-in for HonoWSContext that just records what would've been sent. */
export function createFakeWs() {
  const sent: any[] = [];
  return {
    sent,
    send: (data: string) => {
      sent.push(JSON.parse(data));
    },
    close: () => {},
  };
}

/** Poll until `check()` returns a truthy value, or fail after `timeoutMs`. */
export async function waitFor<T>(
  check: () => T | undefined | null | false,
  timeoutMs = 5000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}
