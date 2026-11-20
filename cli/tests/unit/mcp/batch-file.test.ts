/**
 * The batch write tools' `file` argument (#1217): one JSON object holding the tool's own lists,
 * read from disk so a large batch is not copied into the call.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { locateJsonError, readBatchFile } from "../../../src/mcp/batch-file.js";
import { strictItem } from "../../../src/mcp/strict-schema.js";
import { CLIError } from "../../../src/utils/errors.js";

const lists = {
  elements: z.array(strictItem("An elements[] item", { layer: z.string(), type: z.string(), name: z.string() })),
  relationships: z.array(strictItem("A relationships[] item", { source: z.string(), predicate: z.string(), target: z.string() })),
};

let root: string;

async function refusal(file: string, projectRoot = root): Promise<CLIError> {
  try {
    await readBatchFile("model_add", file, projectRoot, lists);
  } catch (error) {
    expect(error).toBeInstanceOf(CLIError);
    return error as CLIError;
  }
  throw new Error("expected readBatchFile to refuse the file");
}

beforeEach(async () => {
  root = join(tmpdir(), `dr-batch-file-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(root, "batches"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readBatchFile", () => {
  it("reads the tool's lists from one JSON object", async () => {
    const batch = {
      elements: [{ layer: "api", type: "operation", name: "Export Orders" }],
      relationships: [{ source: "a.b.c", predicate: "realizes", target: "d.e.f" }],
    };
    await writeFile(join(root, "batch.json"), JSON.stringify(batch));
    expect(await readBatchFile("model_add", join(root, "batch.json"), root, lists)).toEqual(batch);
  });

  it("reads a relative path from the project root it is given, not the working directory", async () => {
    await writeFile(join(root, "batches", "one.json"), JSON.stringify({ elements: [] }));
    expect(await readBatchFile("model_add", "batches/one.json", root, lists)).toEqual({ elements: [] });

    const other = `${root}-other`;
    await mkdir(other, { recursive: true });
    try {
      const error = await refusal("batches/one.json", other);
      expect(error.message).toBe(`model_add: no file at ${join(other, "batches", "one.json")}`);
      expect(error.suggestions?.join(" ")).toContain(`read from the project root (${other})`);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("says plainly when there is no such file", async () => {
    const error = await refusal(join(root, "missing.json"));
    expect(error.message).toBe(`model_add: no file at ${join(root, "missing.json")}`);
  });

  it("says where a file stops being JSON, without quoting the file", async () => {
    await writeFile(join(root, "bad.json"), '{\n  "elements": [\n    {"layer": "api", "secret": "s3cr3t-value",}\n  ]\n}');
    const error = await refusal(join(root, "bad.json"));
    expect(error.message).toContain("is not valid JSON: at line 3, column 47, found '}' where JSON needs a property name in double quotes");
    expect(error.message).not.toContain("s3cr3t-value");
  });

  it("says what a file holds when it is valid JSON but not an object", async () => {
    await writeFile(join(root, "list.json"), JSON.stringify([{ layer: "api", type: "operation", name: "x" }]));
    const error = await refusal(join(root, "list.json"));
    expect(error.message).toContain("holds a list, not a JSON object");
    expect(error.suggestions).toEqual(['Wrap the list: {"elements": [...]}']);

    await writeFile(join(root, "text.json"), '"elements"');
    expect((await refusal(join(root, "text.json"))).message).toContain("holds a string, not a JSON object");
  });

  it("refuses a key the tool has no list for, naming the likely one", async () => {
    await writeFile(join(root, "keys.json"), JSON.stringify({ element: [], rootPath: "/x" }));
    const error = await refusal(join(root, "keys.json"));
    expect(error.message).toContain("model_add's file doesn't take 'element', 'rootPath'");
    expect(error.message).toContain("did you mean 'elements' for 'element'");
    expect(error.message).toContain("It takes: elements, relationships.");
  });

  it("refuses an object with none of the tool's lists", async () => {
    await writeFile(join(root, "empty.json"), "{}");
    expect((await refusal(join(root, "empty.json"))).message).toContain('has none of "elements", "relationships"');
  });

  it("validates items with the tool's own schemas, and names each one that fails", async () => {
    await writeFile(
      join(root, "items.json"),
      JSON.stringify({
        elements: [
          { layer: "api", type: "operation", name: "ok" },
          { layer: "api", type: "operation" },
          { layer: "api", type: "operation", name: "x", nmae: "y" },
        ],
      })
    );
    const error = await refusal(join(root, "items.json"));
    expect(error.message).toContain("has 2 items the tool can't read; nothing was staged");
    expect(error.suggestions?.[0]).toStartWith("elements[1].name:");
    expect(error.suggestions?.[1]).toContain("elements[2]: An elements[] item doesn't take 'nmae'");
  });

  it("still answers plainly for a file nested too deep to locate the error in", async () => {
    await writeFile(join(root, "deep.json"), "[".repeat(200_000));
    const error = await refusal(join(root, "deep.json"));
    expect(error.message).toContain("is not valid JSON");
    expect(error.message).not.toContain("call stack");
  });

  it("refuses a directory", async () => {
    expect((await refusal(join(root, "batches"))).message).toContain("is not a file");
  });
});

describe("locateJsonError", () => {
  it("returns null for valid JSON", () => {
    for (const text of ['{"a": [1, -2.5e3, true, null, "x\\n\\u00e9"]}', "[]", ' {"a": {}} \n']) {
      expect(locateJsonError(text)).toBeNull();
    }
  });

  it("finds the first error with its line and column", () => {
    expect(locateJsonError('{"a": 1,\n "b" 2}')).toMatchObject({ line: 2, column: 6, found: "'2'", expected: "':' after the property name" });
    expect(locateJsonError('{"a": [1, 2')).toMatchObject({ line: 1, found: "the end of the file", expected: "',' or ']'" });
    expect(locateJsonError("{'a': 1}")).toMatchObject({ line: 1, column: 2, expected: "a property name in double quotes" });
    expect(locateJsonError('{"a": 1} {"b": 2}')).toMatchObject({ column: 10, expected: "the end of the file (one JSON value only)" });
    expect(locateJsonError('{"a": "line\nbreak"}')).toMatchObject({ line: 1, column: 12 });
  });

  it("agrees with JSON.parse on what is valid", () => {
    const samples = ['{"a":}', "[1,]", '{"a": 01}', '{"a": "\\x"}', "nul", '{"a": 1', "", '{"a": tru}', '["\\u12G4"]', "[1 2]"];
    for (const text of samples) {
      expect(() => JSON.parse(text)).toThrow();
      expect(locateJsonError(text)).not.toBeNull();
    }
  });
});
