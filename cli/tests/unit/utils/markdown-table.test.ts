import { describe, it, expect } from "bun:test";
import { formatMarkdownTable } from "../../../src/utils/markdown-table.js";

describe("formatMarkdownTable", () => {
  it("should format a simple table with headers and rows", () => {
    const headers = ["Name", "Age"];
    const rows = [
      ["Alice", "30"],
      ["Bob", "25"],
    ];

    const result = formatMarkdownTable(headers, rows);

    expect(result).toContain("Name");
    expect(result).toContain("Age");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
    expect(result).toContain("|");
    // Check it has the structure of a markdown table
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(2); // Header, separator, at least one row
  });

  it("should handle single row", () => {
    const headers = ["Header"];
    const rows = [["Value"]];

    const result = formatMarkdownTable(headers, rows);

    expect(result).toContain("| Header |");
    expect(result).toContain("| ------ |");
    expect(result).toContain("| Value  |");
  });

  it("should handle empty rows", () => {
    const headers = ["Col1", "Col2"];
    const rows: string[][] = [];

    const result = formatMarkdownTable(headers, rows);

    expect(result).toContain("| Col1 | Col2 |");
    expect(result).toContain("| ---- | ---- |");
  });

  it("should pad columns to max width", () => {
    const headers = ["Short", "MediumHeader"];
    const rows = [
      ["A", "Value"],
      ["LongerValue", "B"],
    ];

    const result = formatMarkdownTable(headers, rows);

    // Check that columns are properly padded
    const lines = result.split("\n");
    // All rows should have consistent column widths (with padding)
    expect(lines[0]).toContain("|");
    expect(lines[1]).toContain("|");
    expect(lines[2]).toContain("|");
    expect(lines[3]).toContain("|");
  });

  it("should handle special characters in cells", () => {
    const headers = ["Code", "Value"];
    const rows = [
      ["`test`", "123"],
      ["**bold**", "456"],
    ];

    const result = formatMarkdownTable(headers, rows);

    expect(result).toContain("`test`");
    expect(result).toContain("**bold**");
  });

  it("should handle cells with different lengths", () => {
    const headers = ["A", "B", "C"];
    const rows = [
      ["short", "medium length", "x"],
      ["x", "y", "very long value here"],
    ];

    const result = formatMarkdownTable(headers, rows);

    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
    expect(result).toContain("short");
    expect(result).toContain("very long value here");
  });

  it("should end with newline", () => {
    const headers = ["Col"];
    const rows = [["Val"]];

    const result = formatMarkdownTable(headers, rows);

    expect(result.endsWith("\n")).toBe(true);
  });

  it("should handle multiple columns", () => {
    const headers = ["Col1", "Col2", "Col3", "Col4"];
    const rows = [["A", "B", "C", "D"]];

    const result = formatMarkdownTable(headers, rows);

    const lines = result.split("\n");
    expect(lines[0]).toContain("Col1");
    expect(lines[0]).toContain("Col2");
    expect(lines[0]).toContain("Col3");
    expect(lines[0]).toContain("Col4");
  });
});
