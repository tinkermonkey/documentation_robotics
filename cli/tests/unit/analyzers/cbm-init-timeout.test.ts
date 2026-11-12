/**
 * The CBM initialize timeout as the user meets it: through CbmAnalyzer.detect() and the
 * codebase_index MCP tool, not only the stdio client.
 *
 * The analyzer's binary_names point at a fake `codebase-memory-mcp` (a shell script that
 * never answers) by absolute path, so the real binary is never spawned. (Changing PATH
 * in-process does not reach the `which` lookup under bun.)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CbmAnalyzer, cbmNotInstalledMessage } from "../../../src/analyzers/cbm-analyzer.js";
import { MappingLoader } from "../../../src/analyzers/mapping-loader.js";
import { INIT_TIMEOUT_ENV, InitTimeoutConfigError } from "../../../src/analyzers/stdio-client.js";
import { writeSession } from "../../../src/analyzers/session-state.js";
import { Model } from "../../../src/core/model.js";
import { createCodebaseIndexHandler } from "../../../src/mcp/tools/codebase-index.js";
import { defaultCodebaseToolDeps } from "../../../src/mcp/tools/codebase-shared.js";
import { clearModelCache } from "../../../src/mcp/tools/shared.js";

let dir: string;
let binDir: string;
let fakeBinary: string;
let savedTimeout: string | undefined;

beforeEach(async () => {
  dir = await realpath(
    await (async () => {
      const d = join(tmpdir(), `dr-cbm-init-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(d, { recursive: true });
      return d;
    })()
  );
  binDir = join(dir, "bin");
  await mkdir(binDir);
  fakeBinary = join(binDir, "codebase-memory-mcp");
  // Starts, reads nothing, never answers initialize.
  await writeFile(fakeBinary, "#!/bin/sh\nexec sleep 30\n");
  await chmod(fakeBinary, 0o755);

  savedTimeout = process.env[INIT_TIMEOUT_ENV];
  delete process.env[INIT_TIMEOUT_ENV];
  clearModelCache();
});

afterEach(async () => {
  if (savedTimeout === undefined) delete process.env[INIT_TIMEOUT_ENV];
  else process.env[INIT_TIMEOUT_ENV] = savedTimeout;
  clearModelCache();
  await rm(dir, { recursive: true, force: true });
});

/** A CbmAnalyzer whose only binary is the fake one. */
async function analyzer(): Promise<CbmAnalyzer> {
  const mapper = await MappingLoader.load("cbm");
  const metadata = mapper.getAnalyzerMetadata();
  mapper.getAnalyzerMetadata = () => ({ ...metadata, binary_names: [fakeBinary] });
  return new CbmAnalyzer(mapper);
}

function parse(result: any): any {
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0].text);
}

describe("CbmAnalyzer.detect and the initialize timeout", () => {
  it("raises a bad DR_CBM_INIT_TIMEOUT_MS as a named error, not 'not installed'", async () => {
    process.env[INIT_TIMEOUT_ENV] = "30s";
    const cbm = await analyzer();
    const error = await cbm.detect(dir).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(InitTimeoutConfigError);
    expect((error as Error).message).toContain(INIT_TIMEOUT_ENV);
    expect((error as Error).message).toContain("'30s'");
  });

  it("reports a found binary whose initialize timed out, naming the setting", async () => {
    process.env[INIT_TIMEOUT_ENV] = "300";
    const detection = await (await analyzer()).detect(dir);
    expect(detection.installed).toBe(false);
    if (detection.installed) return;
    expect(detection.error).toContain(`found at ${fakeBinary}`);
    expect(detection.error).toContain("timed out after 300ms");
    expect(detection.error).toContain(INIT_TIMEOUT_ENV);

    const message = cbmNotInstalledMessage(detection);
    expect(message).toContain("could not be started");
    expect(message).toContain(INIT_TIMEOUT_ENV);
  }, 15_000);

  it("still says 'not installed' when no binary is found", () => {
    expect(cbmNotInstalledMessage({ installed: false })).toBe("CBM analyzer not installed");
  });
});

describe("codebase_index and the initialize timeout", () => {
  async function initModel(): Promise<void> {
    await Model.init(dir, { name: "Init Timeout Test Model", version: "0.1.0" });
  }

  it("tells the agent the analyzer timed out, naming the setting, instead of to reinstall", async () => {
    await initModel();
    await writeSession({ active_analyzer: "cbm", selected_at: new Date().toISOString() }, dir);
    process.env[INIT_TIMEOUT_ENV] = "300";
    const cbm = await analyzer();
    const handler = createCodebaseIndexHandler({ ...defaultCodebaseToolDeps, getAnalyzer: async () => cbm });

    const error = parse(await handler({ rootPath: dir }));
    expect(error.error).toContain("could not be started");
    expect(error.error).toContain(`found at ${fakeBinary}`);
    expect(error.error).toContain("timed out after 300ms");
    expect(error.error).not.toContain("is not installed");
    expect(error.suggestions.join("\n")).toContain(INIT_TIMEOUT_ENV);
  }, 15_000);

  it("reports a timeout found during discovery the same way", async () => {
    await initModel();
    process.env[INIT_TIMEOUT_ENV] = "300";
    const cbm = await analyzer();
    const handler = createCodebaseIndexHandler({
      ...defaultCodebaseToolDeps,
      getAnalyzer: async () => cbm,
      discover: async () => {
        const detection = await cbm.detect(dir);
        return {
          found: [
            {
              name: "cbm",
              display_name: "codebase-memory-mcp",
              description: "",
              homepage: "",
              installed: detection.installed,
              ...(!detection.installed && detection.error ? { error: detection.error } : {}),
            },
          ],
        };
      },
    });

    const error = parse(await handler({ rootPath: dir }));
    expect(error.error).toContain("could not be started");
    expect(error.error).toContain("timed out after 300ms");
    expect(error.error).not.toContain("No code analyzer is installed");
  }, 15_000);

  it("surfaces a bad DR_CBM_INIT_TIMEOUT_MS from real discovery", async () => {
    await initModel();
    process.env[INIT_TIMEOUT_ENV] = "1e3";
    const handler = createCodebaseIndexHandler(defaultCodebaseToolDeps);

    const error = parse(await handler({ rootPath: dir }));
    expect(error.error).toContain(INIT_TIMEOUT_ENV);
    expect(error.error).toContain("'1e3'");
  });
});
