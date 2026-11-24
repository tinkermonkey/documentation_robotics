import { describe, expect, it } from "bun:test";
import * as prettier from "prettier";
import YAML from "yaml";
import { stringifyDrYaml } from "../../../src/core/dr-yaml.js";

const LONG =
  "A commit refuses a changeset for drift whenever any element in the base changed, which is far more often than the plan and the base actually disagree about anything";

/** prettier at its default settings, as a project that runs it on YAML with no config would. */
const prettierDefault = (text: string) => prettier.format(text, { parser: "yaml" });
/** This repository's .prettierrc. */
const prettierRepo = (text: string) =>
  prettier.format(text, { parser: "yaml", printWidth: 80, singleQuote: false, proseWrap: "preserve" });

const SAMPLE = {
  "motivation.goal.long": {
    id: "00000000-0000-4000-8000-000000000001",
    name: "long",
    description: LONG,
    documentation: `MVP criterion 3: ${LONG}`,
    attributes: { priority: "high", tags: ["a", "b: c", "#hash"] },
  },
  quotes: {
    apostrophe: `The build's input: ${LONG}`,
    double: `Fails with "The change was not saved": ${LONG}`,
    both: `The tool's lists ({"relationships": [...]}) and 'manual': ${LONG}`,
    moreDoubles: 'a: "b" \'c\' "d"',
    backslash: 'path: C:\\dr "x"',
    plainWithQuote: 'say "hi"',
    escapedKey: { "it's: \"x\"": 1 },
  },
  multiline: "first line\nsecond line with \"quotes\" and 'apostrophes'\n",
  tab: "a\tb: \"c\"",
  booleans: ["on", "off", "yes"],
  numbers: [1, 2.5, null, true],
};

describe("dr's YAML layout (#1246)", () => {
  it("round-trips the data", () => {
    expect(YAML.parse(stringifyDrYaml(SAMPLE))).toEqual(SAMPLE);
    expect(YAML.parse(stringifyDrYaml(SAMPLE, { quoteYaml11Booleans: true }))).toEqual(SAMPLE);
  });

  it("keeps a long string on its key's line", () => {
    const text = stringifyDrYaml({ description: LONG });
    expect(text).toBe(`description: ${LONG}\n`);
  });

  it("is a layout prettier leaves alone, at its defaults and with this repository's config", async () => {
    for (const options of [{}, { quoteYaml11Booleans: true }]) {
      const text = stringifyDrYaml(SAMPLE, options);
      expect(await prettierDefault(text)).toBe(text);
      expect(await prettierRepo(text)).toBe(text);
    }
  });

  it("quotes as prettier does: single when the string holds a double quote, else double", () => {
    expect(stringifyDrYaml({ a: "x: it's" })).toBe(`a: "x: it's"\n`);
    expect(stringifyDrYaml({ a: 'x: "y"' })).toBe(`a: 'x: "y"'\n`);
    expect(stringifyDrYaml({ a: 'x: "y" it\'s' })).toBe(`a: 'x: "y" it''s'\n`);
    // A string yaml leaves plain stays plain
    expect(stringifyDrYaml({ a: 'say "hi"' })).toBe(`a: say "hi"\n`);
  });

  it("quotes YAML 1.1 booleans in values, not keys, only when asked", () => {
    expect(stringifyDrYaml({ on: "off" })).toBe("on: off\n");
    expect(stringifyDrYaml({ on: "off" }, { quoteYaml11Booleans: true })).toBe('on: "off"\n');
  });
});
