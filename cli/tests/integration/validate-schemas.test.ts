/**
 * Integration tests for `dr validate --schemas`
 *
 * Verifies that spec/dist/ compiled schemas match cli/src/schemas/bundled/,
 * catching schema sync regressions that would otherwise only surface in CI.
 */
import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { join } from "path";

describe("dr validate --schemas", () => {
  const cliPath = join(import.meta.dir, "../../dist/cli.js");

  it("should report all 14 bundled schemas as synchronized with spec/dist/", () => {
    const output = execSync(`node ${cliPath} validate --schemas`, {
      encoding: "utf-8",
    });

    expect(output).toContain("All schemas synchronized");
    // 14 file checks + 1 summary line = at least 15 ✓ marks
    const checks = (output.match(/✓/g) || []).length;
    expect(checks).toBeGreaterThanOrEqual(15);
  });

  it("should pass without errors (exit code 0)", () => {
    // execSync throws on non-zero exit code; if this passes the exit code is 0
    expect(() =>
      execSync(`node ${cliPath} validate --schemas`, { encoding: "utf-8" })
    ).not.toThrow();
  });
});
