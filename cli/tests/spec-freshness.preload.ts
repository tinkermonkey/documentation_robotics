/**
 * Stale-build guard, preloaded by Bun before tests/setup.ts (see bunfig.toml).
 *
 * cli/src/generated/ is git-ignored and only rebuilt by `npm run build`, so
 * after a spec change lands it can keep an old relationship catalog. Tests
 * then fail as if they had drifted. This preload compares spec/dist/, the
 * bundled copy in cli/src/schemas/bundled/ and the fingerprints the
 * generators recorded, and stops the run with one clear message on mismatch.
 *
 * It runs first, before setup.ts imports anything from dist/, so a missing
 * build is reported here rather than as a module-not-found error.
 */

import * as path from "path";
import {
  checkSpecFreshness,
  formatSpecFreshnessError
} from "../scripts/spec-fingerprint.js";

if (process.env.DR_SKIP_SPEC_FRESHNESS_CHECK !== "1") {
  const cliDir = path.resolve(import.meta.dir, "..");
  const problems = checkSpecFreshness({
    bundledDir: path.join(cliDir, "src", "schemas", "bundled"),
    generatedDir: path.join(cliDir, "src", "generated"),
    specDistDir: path.join(cliDir, "..", "spec", "dist")
  });
  if (problems.length > 0) {
    console.error(formatSpecFreshnessError(problems));
    process.exit(1);
  }
}

export {};
