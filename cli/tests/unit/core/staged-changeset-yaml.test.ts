/**
 * Changeset files keep enum values such as `off` and `on` as strings for every YAML reader. This
 * CLI reads YAML 1.2, where they are strings unquoted; a YAML 1.1 reader (PyYAML, Ruby, older
 * tooling) takes them for booleans, so they are written quoted.
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";
import { StagedChangesetStorage, stringifyStaged } from "../../../src/core/staged-changeset-storage.js";

const AMBIGUOUS = { mode: "off", sync: "on", answer: "Yes", short: "n", real: true, text: "offline", count: 3 };

describe("stringifyStaged", () => {
  it("quotes the string values a YAML 1.1 reader would take for booleans, and nothing else", () => {
    const text = stringifyStaged([{ attributes: AMBIGUOUS, y: "kept as a key" }]);
    expect(text).toContain('mode: "off"');
    expect(text).toContain('sync: "on"');
    expect(text).toContain('answer: "Yes"');
    expect(text).toContain('short: "n"');
    expect(text).toContain("real: true");
    expect(text).toContain("text: offline");
    expect(text).toContain("count: 3");
    // Keys are left as they are.
    expect(text).toContain("y: kept as a key");

    expect(yaml.parse(text)).toEqual([{ attributes: AMBIGUOUS, y: "kept as a key" }]);
    expect(yaml.parse(text, { version: "1.1" })[0].attributes).toEqual(AMBIGUOUS);
    // Without the quotes a 1.1 reader loses the strings.
    expect(yaml.parse(yaml.stringify({ mode: "off" }), { version: "1.1" })).toEqual({ mode: false });
  });
});

describe("a staged changeset on disk", () => {
  it("writes such values quoted in changes.yaml and reads them back as strings", async () => {
    // Its own directory, removed at the end: the unit suite runs this folder's tests concurrently.
    const rootPath = await mkdtemp(join(tmpdir(), "dr-staged-yaml-"));
    try {
      await check(new StagedChangesetStorage(rootPath));
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  async function check(storage: StagedChangesetStorage): Promise<void> {
    const changeset = await storage.create("yaml-values", "YAML values", undefined, "v2:sha256:abc");
    changeset.changes = [
      {
        type: "add",
        elementId: "ux.view.settings",
        layerName: "ux",
        after: { path: "ux.view.settings", type: "view", name: "Settings", attributes: AMBIGUOUS },
        sequenceNumber: 0,
      },
    ];
    await storage.save(changeset);

    const text = await readFile(join(storage.getChangesetPath("yaml-values"), "changes.yaml"), "utf-8");
    expect(text).toContain('mode: "off"');
    expect(text).toContain('sync: "on"');
    expect(yaml.parse(text, { version: "1.1" })[0].after.attributes).toEqual(AMBIGUOUS);
    expect((await storage.load("yaml-values"))!.changes[0].after).toMatchObject({ attributes: AMBIGUOUS });
  }
});
