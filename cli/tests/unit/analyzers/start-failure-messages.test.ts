/**
 * Messages for an analyzer binary that was found but could not be started
 * (DetectionResult.error set): they give start-up advice (raise DR_CBM_INIT_TIMEOUT_MS,
 * check `codebase-memory-mcp --version`), never advice to install what is installed.
 */

import { describe, it, expect } from "bun:test";
import { cbmNotInstalledError } from "../../../src/analyzers/cbm-analyzer.js";
import { analyzerUnavailableError } from "../../../src/analyzers/active-analyzer.js";
import { noUsableAnalyzersReport, type DiscoverAnalyzerOption } from "../../../src/commands/discover-logic.js";
import { ErrorCategory } from "../../../src/utils/errors.js";

const TIMEOUT_ERROR =
  "initialize timed out after 30000ms (set DR_CBM_INIT_TIMEOUT_MS to allow longer)";

const startFailed = { installed: false as const, binary_path: "/usr/local/bin/codebase-memory-mcp", error: TIMEOUT_ERROR };
const missing = { installed: false as const };

function mentionsInstall(suggestions: readonly string[] | undefined): boolean {
  return (suggestions ?? []).some((s) => /install/i.test(s));
}

describe("cbmNotInstalledError (extract, verify, index and graph reads)", () => {
  it("gives start-up advice when a found binary could not be started", () => {
    const error = cbmNotInstalledError(startFailed);
    expect(error.message).toBe(`CBM analyzer could not be started: ${TIMEOUT_ERROR}`);
    expect(error.exitCode).toBe(ErrorCategory.USER);
    expect((error.suggestions ?? []).some((s) => s.includes("DR_CBM_INIT_TIMEOUT_MS"))).toBe(true);
    expect((error.suggestions ?? []).some((s) => s.includes("codebase-memory-mcp --version"))).toBe(true);
    expect(mentionsInstall(error.suggestions)).toBe(false);
  });

  it("still says to install it when no binary was found", () => {
    const error = cbmNotInstalledError(missing);
    expect(error.message).toBe("CBM analyzer not installed");
    expect(error.exitCode).toBe(ErrorCategory.NOT_FOUND);
    expect(error.suggestions![0]).toContain("Install codebase-memory-mcp");
  });
});

describe("analyzerUnavailableError (dr analyzer index)", () => {
  it("gives start-up advice, not discover's installation instructions, when the binary could not be started", async () => {
    const error = await analyzerUnavailableError("cbm", startFailed);
    expect(error.message).toBe(`Analyzer could not be started: ${TIMEOUT_ERROR}`);
    expect((error.suggestions ?? []).some((s) => s.includes("DR_CBM_INIT_TIMEOUT_MS"))).toBe(true);
    expect((error.suggestions ?? []).some((s) => s.includes("codebase-memory-mcp --version"))).toBe(true);
    expect((error.suggestions ?? []).some((s) => s.includes("dr analyzer discover"))).toBe(false);
    expect(mentionsInstall(error.suggestions)).toBe(false);
  });

  it("points at discover and the homepage when the analyzer is not installed", async () => {
    const error = await analyzerUnavailableError("cbm", missing);
    expect(error.message).toBe("Analyzer not installed: cbm");
    expect(error.suggestions![0]).toContain("dr analyzer discover");
    expect(error.suggestions![1]).toStartWith("Visit: ");
  });
});

describe("noUsableAnalyzersReport (dr analyzer discover, text mode)", () => {
  const option = (name: string, detection: object): DiscoverAnalyzerOption => ({
    backend: { name: name.toLowerCase(), displayName: name },
    detection,
    metadata: { homepage: `https://example.com/${name}` },
  });

  it("lists analyzers to install when none was found", () => {
    const report = noUsableAnalyzersReport([option("CBM", missing)]);
    expect(report.heading).toBe("No analyzers installed. Install one of the following:");
    expect(report.entries).toEqual([{ name: "CBM", homepage: "https://example.com/CBM" }]);
    expect(report.hints).toEqual(["To install: follow the links above or use your package manager"]);
  });

  it("names why a found binary could not be started and drops the install advice", () => {
    const report = noUsableAnalyzersReport([option("CBM", startFailed)]);
    expect(report.heading).toBe("No analyzer could be started:");
    expect(report.heading).not.toContain("installed");
    expect(report.entries[0].error).toBe(TIMEOUT_ERROR);
    expect(report.hints.some((h) => h.includes("DR_CBM_INIT_TIMEOUT_MS"))).toBe(true);
    expect(report.hints.some((h) => h.includes("codebase-memory-mcp --version"))).toBe(true);
    expect(mentionsInstall(report.hints)).toBe(false);
  });

  it("keeps the install hint for the analyzers that are missing when another failed to start", () => {
    const report = noUsableAnalyzersReport([option("CBM", startFailed), option("Other", missing)]);
    expect(report.heading).toContain("could not be started, or not installed");
    expect(report.entries[0].error).toBe(TIMEOUT_ERROR);
    expect(report.entries[1].error).toBeUndefined();
    expect(report.hints).toContain("To install: follow the links above or use your package manager");
  });
});
