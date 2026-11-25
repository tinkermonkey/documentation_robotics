/**
 * How the CLI prints a changeset's description, which is markdown (#1210): whole and as written in
 * dr changeset show, its first line in dr changeset list.
 */

import { describe, it, expect } from "bun:test";
import { descriptionExcerpt, descriptionLines } from "../../../src/core/changeset-description.js";

const INTENT = [
  "Export orders as CSV.",
  "",
  "**In scope**",
  "- `api.operation.export-orders`",
  "  - nested item",
  "",
  "**Done when** an admin can download them.",
  "",
  "",
].join("\n");

describe("descriptionLines", () => {
  it("keeps every line as written, indented, with blank lines kept and trailing ones dropped", () => {
    expect(descriptionLines(INTENT)).toEqual([
      "  Export orders as CSV.",
      "",
      "  **In scope**",
      "  - `api.operation.export-orders`",
      "    - nested item",
      "",
      "  **Done when** an admin can download them.",
    ]);
  });

  it("reads Windows line breaks, takes another indent, and is empty for none", () => {
    expect(descriptionLines("one\r\ntwo", "> ")).toEqual(["> one", "> two"]);
    expect(descriptionLines(undefined)).toEqual([]);
    expect(descriptionLines("  \n ")).toEqual([]);
  });
});

describe("descriptionExcerpt", () => {
  it("is the first line with text, marked when more lines follow", () => {
    expect(descriptionExcerpt(INTENT)).toBe("Export orders as CSV. …");
    expect(descriptionExcerpt("\n\n  Only line  \n")).toBe("Only line");
  });

  it("cuts a long first line to the width, and is empty for none", () => {
    expect(descriptionExcerpt("a".repeat(30), 10)).toBe(`${"a".repeat(10)} …`);
    expect(descriptionExcerpt(undefined)).toBe("");
    expect(descriptionExcerpt("   ")).toBe("");
  });
});
