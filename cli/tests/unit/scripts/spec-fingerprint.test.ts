import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  SPEC_FINGERPRINT_FILE,
  checkSpecFreshness,
  fingerprintSpecDir,
  formatSpecFreshnessError,
  recordGeneratorFingerprint
} from "../../../scripts/spec-fingerprint.js";

function writeSpec(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

const SPEC = {
  "manifest.json": '{"specVersion":"0.11.0"}',
  "api.json": '{"relationshipSchemas":{"r":{"predicate":"supports"}}}',
  "analyzers/cbm.json": "{}"
};

describe("spec-fingerprint", () => {
  let root: string;
  let specDist: string;
  let bundled: string;
  let generated: string;

  const paths = () => ({
    bundledDir: bundled,
    generatedDir: generated,
    specDistDir: specDist
  });
  const buildAll = () => {
    recordGeneratorFingerprint("generate-registry", bundled, generated);
    recordGeneratorFingerprint("generate-validators", bundled, generated);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-fingerprint-"));
    specDist = path.join(root, "spec", "dist");
    bundled = path.join(root, "cli", "src", "schemas", "bundled");
    generated = path.join(root, "cli", "src", "generated");
    writeSpec(specDist, SPEC);
    writeSpec(bundled, SPEC);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("fingerprintSpecDir", () => {
    it("is equal for identical trees and ignores dotfiles and non-JSON files", () => {
      writeSpec(bundled, { ".DS_Store": "x", "README.md": "notes" });
      expect(fingerprintSpecDir(bundled)).toBe(fingerprintSpecDir(specDist));
    });

    it("changes when a file's content changes, including nested files", () => {
      const before = fingerprintSpecDir(bundled);
      writeSpec(bundled, { "analyzers/cbm.json": '{"x":1}' });
      expect(fingerprintSpecDir(bundled)).not.toBe(before);
    });

    it("changes when a file is renamed or added", () => {
      const before = fingerprintSpecDir(bundled);
      fs.renameSync(
        path.join(bundled, "api.json"),
        path.join(bundled, "apm.json")
      );
      const renamed = fingerprintSpecDir(bundled);
      expect(renamed).not.toBe(before);
      writeSpec(bundled, { "ux.json": "{}" });
      expect(fingerprintSpecDir(bundled)).not.toBe(renamed);
    });

    it("throws for a missing or empty directory", () => {
      expect(() => fingerprintSpecDir(path.join(root, "nope"))).toThrow(
        /not found/
      );
      fs.mkdirSync(path.join(root, "empty"));
      expect(() => fingerprintSpecDir(path.join(root, "empty"))).toThrow(
        /no \.json files/
      );
    });
  });

  describe("recordGeneratorFingerprint", () => {
    it("keeps other generators' entries", () => {
      recordGeneratorFingerprint("generate-registry", bundled, generated);
      writeSpec(bundled, { "api.json": "{}" });
      recordGeneratorFingerprint("generate-validators", bundled, generated);
      const recorded = JSON.parse(
        fs.readFileSync(path.join(generated, SPEC_FINGERPRINT_FILE), "utf-8")
      );
      expect(Object.keys(recorded).sort()).toEqual([
        "generate-registry",
        "generate-validators"
      ]);
      expect(recorded["generate-registry"]).not.toBe(
        recorded["generate-validators"]
      );
    });
  });

  describe("checkSpecFreshness", () => {
    it("reports nothing when spec/dist, bundled and generated agree", () => {
      buildAll();
      expect(checkSpecFreshness(paths())).toEqual([]);
    });

    it("reports a stale generated build when bundled changed after generation", () => {
      buildAll();
      writeSpec(bundled, {
        "api.json": '{"relationshipSchemas":{"r":{"predicate":"realizes"}}}'
      });
      writeSpec(specDist, {
        "api.json": '{"relationshipSchemas":{"r":{"predicate":"realizes"}}}'
      });
      const problems = checkSpecFreshness(paths());
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("cli/src/generated/ is stale");
      expect(problems[0]).toContain("generate-registry, generate-validators");
    });

    it("names only the generator that is behind", () => {
      recordGeneratorFingerprint("generate-registry", bundled, generated);
      writeSpec(bundled, { "api.json": "{}" });
      writeSpec(specDist, { "api.json": "{}" });
      recordGeneratorFingerprint("generate-validators", bundled, generated);
      const problems = checkSpecFreshness(paths());
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("is stale: generate-registry last ran");
    });

    it("reports a missed sync when spec/dist changed but bundled did not", () => {
      buildAll();
      writeSpec(specDist, { "api.json": "{}" });
      const problems = checkSpecFreshness(paths());
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("does not match spec/dist/");
    });

    it("skips the spec/dist comparison when spec/dist is absent", () => {
      buildAll();
      fs.rmSync(specDist, { recursive: true });
      expect(checkSpecFreshness(paths())).toEqual([]);
      expect(
        checkSpecFreshness({ bundledDir: bundled, generatedDir: generated })
      ).toEqual([]);
    });

    it("fails when the fingerprint file is missing (never built, or built before the check)", () => {
      const problems = checkSpecFreshness(paths());
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${SPEC_FINGERPRINT_FILE} is missing`);
    });

    it("fails when the fingerprint file is unreadable", () => {
      fs.mkdirSync(generated, { recursive: true });
      fs.writeFileSync(path.join(generated, SPEC_FINGERPRINT_FILE), "not json");
      expect(checkSpecFreshness(paths())[0]).toContain("is unreadable");
    });

    it("fails when the bundled spec is missing", () => {
      buildAll();
      fs.rmSync(bundled, { recursive: true });
      const problems = checkSpecFreshness(paths());
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("cli/src/schemas/bundled/ is unusable");
    });
  });

  it("formats problems with the fix instruction", () => {
    const message = formatSpecFreshnessError([
      "cli/src/generated/ is stale: x"
    ]);
    expect(message).toContain("STALE BUILD");
    expect(message).toContain("  - cli/src/generated/ is stale: x");
    expect(message).toContain("run `npm run build` in cli/");
  });
});
