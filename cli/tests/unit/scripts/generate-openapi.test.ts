/**
 * The generate:openapi script.
 *
 * `npm run test:unit` runs this file under `bun test --concurrent`, so every run writes its own
 * temporary file (--out, or DR_OPENAPI_OUT) and none writes the tracked docs/api-spec.yaml (#1092:
 * concurrent runs used to truncate it). afterAll checks that the tracked file is unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const CLI_ROOT = resolve(import.meta.dir, "../../../");
const TRACKED_SPEC = resolve(CLI_ROOT, "../docs/api-spec.yaml");
/** Each test starts tsx and builds the server; under --concurrent on a busy machine that takes a while. */
const SCRIPT_TIMEOUT_MS = 180_000;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `npm run generate:openapi` from `cwd` (default cli/); npm runs the script itself in cli/. */
function runScript(args: string[], env: NodeJS.ProcessEnv = process.env, cwd = CLI_ROOT): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const npmArgs = [...(cwd === CLI_ROOT ? [] : ["--prefix", CLI_ROOT]), "run", "generate:openapi"];
    const proc = spawn("npm", [...npmArgs, ...(args.length ? ["--", ...args] : [])], {
      cwd,
      env,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (data) => (stdout += data.toString()));
    proc.stderr?.on("data", (data) => (stderr += data.toString()));
    proc.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    proc.on("error", reject);
  });
}

describe("generate-openapi Script", () => {
  const dirs: string[] = [];
  let trackedBefore: string | null = null;

  /** A fresh directory for one test's output. */
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "dr-openapi-test-"));
    dirs.push(dir);
    return dir;
  };

  /** Runs the script with --out in a test's own directory and returns the result and the file. */
  const generate = async () => {
    const out = join(tempDir(), "api-spec.yaml");
    const result = await runScript(["--out", out]);
    if (result.code !== 0) {
      throw new Error(`Script exited with code ${result.code}. Stderr: ${result.stderr}`);
    }
    expect(existsSync(out)).toBe(true);
    return { ...result, out, content: readFileSync(out, "utf-8") };
  };

  beforeAll(() => {
    trackedBefore = existsSync(TRACKED_SPEC) ? readFileSync(TRACKED_SPEC, "utf-8") : null;
  });

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    // No test may write the tracked spec (#1092).
    const trackedAfter = existsSync(TRACKED_SPEC) ? readFileSync(TRACKED_SPEC, "utf-8") : null;
    expect(trackedAfter).toBe(trackedBefore);
  });

  it("should run without errors", async () => {
    const { stdout, out } = await generate();
    expect(stdout).toContain("✅ OpenAPI specification generated successfully!");
    expect(stdout).toContain(out);
  }, SCRIPT_TIMEOUT_MS);

  it("should generate yaml output file with correct header", async () => {
    const { content } = await generate();

    // Check for auto-generated marker (not hand-maintained)
    expect(content).toContain("# AUTO-GENERATED:");

    // Check for OpenAPI version 3.0.3 (project standard per CLAUDE.md)
    expect(content).toMatch(/openapi:\s*['"]?3\.0\.3/);

    // Check for proper YAML structure
    expect(content).toContain("info:");
    expect(content).toContain("title:");
    expect(content).toContain("paths:");
  }, SCRIPT_TIMEOUT_MS);

  it("should include server information in spec", async () => {
    const { content } = await generate();
    expect(content).toContain("servers:");
    expect(content).toContain("localhost:8080");
  }, SCRIPT_TIMEOUT_MS);

  it("should generate valid YAML without syntax errors", async () => {
    const { content } = await generate();

    // Basic validation: no unrendered template braces outside comments
    const yamlValid = content
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .every((line) => !line.includes("{{") && !line.includes("}}"));

    expect(yamlValid).toBe(true);
    expect(content.length).toBeGreaterThan(100); // Should have substantial content
  }, SCRIPT_TIMEOUT_MS);

  it("should exit with error when the spec cannot be written", async () => {
    // A path under a regular file cannot be created. (This test used to set HOME=/nonexistent to
    // break model loading, but the model is loaded from cli/ whatever HOME is.)
    const file = join(tempDir(), "not-a-directory");
    writeFileSync(file, "");
    const { code, stderr } = await runScript(["--out", join(file, "api-spec.yaml")]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("❌ Failed to write spec file");
  }, SCRIPT_TIMEOUT_MS);

  it("should use correct OpenAPI version in generated spec", async () => {
    const { content } = await generate();
    // Check that version matches what's specified in generator (3.0.3)
    expect(content).toMatch(/openapi:\s*3\.0\.3/);
    // Should not have old 3.1.0 version
    expect(content).not.toMatch(/openapi:\s*3\.1\.0/);
  }, SCRIPT_TIMEOUT_MS);

  it("should report clear error message on script failure", async () => {
    const { code, stdout, stderr } = await runScript(["--out"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("❌ Failed to generate OpenAPI specification: --out needs a path");
    expect(stdout + stderr).not.toContain("undefined");
  }, SCRIPT_TIMEOUT_MS);

  it("should create auto-generated marker in output", async () => {
    const { content } = await generate();
    // Verify the file has auto-generated marker and DO NOT EDIT instructions
    expect(content).toContain("# AUTO-GENERATED:");
    expect(content).toContain("npm run generate:openapi");
    expect(content).toContain("DO NOT EDIT MANUALLY");
  }, SCRIPT_TIMEOUT_MS);

  it("writes to DR_OPENAPI_OUT when no --out is given", async () => {
    const out = join(tempDir(), "nested", "api-spec.yaml");
    const { code, stdout } = await runScript([], { ...process.env, DR_OPENAPI_OUT: out });
    expect(code).toBe(0);
    expect(stdout).toContain(out);
    expect(readFileSync(out, "utf-8")).toContain("# AUTO-GENERATED:");
  }, SCRIPT_TIMEOUT_MS);

  it("reads a relative --out against the directory npm was run in, not cli/", async () => {
    // The real path: on macOS the temp directory is behind a symlink, and npm reports the real one.
    const dir = realpathSync(tempDir());
    const { code, stdout } = await runScript(["--out", "api-spec.yaml"], process.env, dir);
    expect(code).toBe(0);
    expect(stdout).toContain(join(dir, "api-spec.yaml"));
    expect(readFileSync(join(dir, "api-spec.yaml"), "utf-8")).toContain("# AUTO-GENERATED:");
    expect(existsSync(join(CLI_ROOT, "api-spec.yaml"))).toBe(false);
  }, SCRIPT_TIMEOUT_MS);
});
