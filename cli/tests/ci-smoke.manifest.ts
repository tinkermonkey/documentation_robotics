/**
 * CI Smoke Test Manifest
 *
 * Curated list of test files that cover all critical CLI paths.
 * CI runs ONLY these tests. Full suite runs locally via `npm test`.
 *
 * Selection criteria:
 * - CLI entry point and every major command group
 * - Core domain model (Model, Layer, Element, Manifest)
 * - Validation pipeline (schema, naming, references)
 * - Export system (multi-format roundtrip)
 * - Changeset/staging workflow
 * - Schema integrity (spec/dist sync)
 *
 * To add a test: append its path (relative to cli/) to this array.
 * To validate locally: run `npm run test:smoke`
 */
export const SMOKE_TESTS: string[] = [
  // CLI Entry Point & Commands
  "tests/integration/commands.test.ts",
  "tests/integration/version-command.test.ts",
  "tests/integration/element-command.test.ts",
  "tests/integration/info-command.test.ts",
  "tests/integration/stats-command.test.ts",
  "tests/integration/error-scenarios.test.ts",

  // Core Domain Model
  "tests/unit/core/model.test.ts",
  "tests/unit/core/layer.test.ts",
  "tests/unit/core/element.test.ts",
  "tests/unit/core/manifest.test.ts",
  "tests/unit/core/reference-registry.test.ts",

  // Validation Pipeline
  "tests/unit/validators/schema-validator-fallback.test.ts",
  "tests/unit/validators/naming-validator.test.ts",
  "tests/unit/validators/reference-validator.test.ts",

  // Export System
  "tests/integration/export-command.test.ts",
  "tests/integration/export-roundtrip.test.ts",

  // Changesets & Staging
  "tests/unit/core/staged-changeset.test.ts",
  "tests/integration/changeset-export-import.test.ts",
  "tests/integration/staging-workflow.test.ts",

  // Schema & Spec Integrity
  "tests/integration/validate-schemas.test.ts",
  "tests/integration/conformance-command.test.ts",

  // Cross-Layer References
  "tests/integration/source-reference.test.ts",
];
