/**
 * The batch write tools' `file` argument (#1217): one JSON object holding the tool's own lists,
 * read from disk so a large batch is not copied into the call.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MAX_BATCH_FILE_BYTES, locateJsonError, readBatchFile } from "../../../src/mcp/batch-file.js";
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

  it("names every malformed item, grouped by what is wrong, however many there are", async () => {
    const elements = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? { layer: "api", type: "operation" } : { layer: "api", type: "operation", name: `op ${i}` }));
    await writeFile(join(root, "many.json"), JSON.stringify({ elements }));
    const error = await refusal(join(root, "many.json"));
    expect(error.message).toContain("has 100 items the tool can't read; nothing was staged");
    // One line for the one mistake, with all 100 positions.
    expect(error.suggestions).toHaveLength(1);
    const positions = error.suggestions![0].match(/elements\[\d+\]\.name/g)!;
    expect(positions).toHaveLength(100);
    expect(positions[0]).toBe("elements[0].name");
    expect(positions[99]).toBe("elements[297].name");
  });

  it("still answers plainly for a file nested too deep to locate the error in", async () => {
    await writeFile(join(root, "deep.json"), "[".repeat(200_000));
    const error = await refusal(join(root, "deep.json"));
    expect(error.message).toContain("is not valid JSON");
    expect(error.message).not.toContain("call stack");
  });

  it("reads only inside the project root, and says nothing about a file outside it", async () => {
    // A file that exists outside the root, with keys worth hiding.
    const outside = `${root}-outside`;
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secrets.json"), JSON.stringify({ client_secret: "s3cr3t", refresh_token: "t0k3n" }));
    try {
      for (const file of [join(outside, "secrets.json"), `../${outside.split("/").pop()}/secrets.json`, join(outside, "not-there.json")]) {
        const error = await refusal(file);
        // The same answer whether or not the file exists, and none of its keys.
        expect(error.message).toContain(`is outside the project root (${root}); a batch file must be inside it`);
        expect(error.message).not.toContain("client_secret");
        expect(error.message).not.toContain("no file at");
        expect(error.suggestions?.[0]).toContain(join(root, ".dr", "batch.json"));
      }

      // A link inside the root that points out of it gets the same answer, whatever is at the
      // other end: a file, a directory, nothing, or a linked directory on the way.
      await symlink(join(outside, "secrets.json"), join(root, "link.json"));
      await symlink(outside, join(root, "linked-dir"));
      await symlink(join(outside, "not-there.json"), join(root, "dangling.json"));
      for (const file of ["link.json", "linked-dir", "dangling.json", "linked-dir/secrets.json", "linked-dir/not-there.json"]) {
        const linked = await refusal(file);
        expect(linked.message).toBe(`model_add: ${file} is outside the project root (${root}); a batch file must be inside it`);
      }

      // An absolute path inside the root is fine, and so is a link that stays inside it.
      await writeFile(join(root, "batches", "one.json"), JSON.stringify({ elements: [] }));
      await symlink(join(root, "batches", "one.json"), join(root, "inner-link.json"));
      expect(await readBatchFile("model_add", join(root, "batches", "one.json"), root, lists)).toEqual({ elements: [] });
      expect(await readBatchFile("model_add", "inner-link.json", root, lists)).toEqual({ elements: [] });
      // A name that starts with two dots is inside.
      await writeFile(join(root, "..notes.json"), JSON.stringify({ elements: [] }));
      expect(await readBatchFile("model_add", "..notes.json", root, lists)).toEqual({ elements: [] });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a file over the size bound with both sizes, and reads one at the bound's edge", async () => {
    // Sparse files: the size is what is checked, before anything is read.
    await writeFile(join(root, "big.json"), "");
    await truncate(join(root, "big.json"), MAX_BATCH_FILE_BYTES + 1);
    const error = await refusal("big.json");
    expect(error.message).toContain("is 67,108,865 bytes; a batch file can be at most 67,108,864 bytes (64 MB)");
    expect(error.suggestions).toEqual(["Split the batch into several files and call the tool once for each"]);
  });

  it("counts malformed items, not problems", async () => {
    await writeFile(
      join(root, "two.json"),
      JSON.stringify({ elements: [{ layer: "api" }, { type: "operation", nmae: "x" }, { layer: "api", type: "operation", name: "ok" }] })
    );
    const error = await refusal("two.json");
    expect(error.message).toMatch(/has 2 items the tool can't read \(\d+ problems\); nothing was staged/);
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
