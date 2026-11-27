import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyUnseenElements, declaresSymbol, unindexedLanguage } from "../../../src/core/unverifiable-classification.js";

describe("unverifiable classification", () => {
  let root: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "unseen-")));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.py"), "def spec_changes_for(x):\n    return other(x)\n");
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const ref = (file: string, symbol?: string) => ({ locations: [{ file, ...(symbol ? { symbol } : {}) }] }) as any;
  const run = (plan: any[], builtIds: string[] = [], since?: string) =>
    classifyUnseenElements(plan, { codebaseRoot: root, builtIds: new Set(builtIds), ...(since ? { since } : {}) });
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root, stdio: "pipe" });
  const commit = (msg: string) => {
    git("add", "-A");
    git("commit", "-qm", msg);
  };

  it("tells a declaration from a call", () => {
    expect(declaresSymbol("def foo(x):\n  pass", "foo")).toBe(true);
    expect(declaresSymbol("class A {\n  async run() {}\n}", "A.run")).toBe(true);
    expect(declaresSymbol("foo() {\n  echo\n}", "foo")).toBe(true);
    expect(declaresSymbol("x = foo(1)", "foo")).toBe(false);
    expect(declaresSymbol('track("foo")', "foo")).toBe(false);
    // A call on its own line, an assignment, a comment and a method of another class are not declarations.
    expect(declaresSymbol("  foo(x);\n  foo()\n", "foo")).toBe(false);
    expect(declaresSymbol("foo = compute()\n", "foo")).toBe(false);
    expect(declaresSymbol("// class foo\n# def foo(x):\n * type foo\n", "foo")).toBe(false);
    expect(declaresSymbol("class Other {\n  run() {\n  }\n}", "Foo.run")).toBe(false);
    expect(declaresSymbol("class Foo {\n  run(a: number): void {\n  }\n}", "Foo.run")).toBe(true);
  });

  it("reads the language of a file the index skips", () => {
    expect(unindexedLanguage("scripts/up.sh")).toBe("shell");
    expect(unindexedLanguage("src/a.ts")).toBeUndefined();
  });

  it("classifies a planned add whose code existed before the range (#1371)", async () => {
    git("init", "-q", "-b", "main");
    commit("base");
    await writeFile(join(root, "src", "b.py"), "def new_one(x):\n    return x\n");
    await writeFile(join(root, "src", "a.py"), "def spec_changes_for(x):\n    return other(x)\n\ndef helper():\n    pass\n");
    const plan = (id: string, file: string, symbol: string) => ({ id, layer: "application", type: "applicationfunction", op: "add", sourceReference: ref(file, symbol) });
    const r = await run(
      [
        plan("application.applicationfunction.a", "src/a.py", "spec_changes_for"), // file changed, symbol was there at the base
        plan("application.applicationfunction.b", "src/a.py", "nope"),
        plan("application.applicationfunction.c", "src/gone.py", "x"),
        plan("application.applicationfunction.d", "src/b.py", "new_one"), // written in the range: extraction missed it
        plan("application.applicationfunction.e", "src/a.py", "helper"), // written in the range, in a file that already existed
      ],
      [],
      "HEAD"
    );
    expect(r.byId.get("application.applicationfunction.a")?.kind).toBe("exists-unchanged");
    for (const id of ["b", "c", "d", "e"]) expect([id, r.byId.has(`application.applicationfunction.${id}`)]).toEqual([id, false]);
  });

  it("says nothing of code existing unchanged without a range (#1371)", async () => {
    const r = await run([{ id: "x.y.a", layer: "application", type: "applicationfunction", op: "add", sourceReference: ref("src/a.py", "spec_changes_for") }]);
    expect(r.byId.size).toBe(0);
  });

  it("leaves an add the build already has alone", async () => {
    const r = await run([{ id: "x.y.a", layer: "application", type: "applicationfunction", op: "add", sourceReference: ref("src/a.py", "spec_changes_for") }], ["x.y.a"]);
    expect(r.byId.size).toBe(0);
  });

  it("puts a delete with no source reference on the list, and one with a reference off it (#1374)", async () => {
    const r = await run(
      [
        { id: "technology.node.base-image", layer: "technology", type: "node", op: "delete" },
        { id: "technology.node.other", layer: "technology", type: "node", op: "delete", sourceReference: ref("src/a.py", "x") },
      ],
      ["technology.node.base-image", "technology.node.other"]
    );
    expect(r.byId.get("technology.node.base-image")?.kind).toBe("no-source-reference");
    expect(r.byId.has("technology.node.other")).toBe(false);
  });

  it("puts a collection that is not a table on the list (#1351)", async () => {
    const r = await run([
      { id: "data-store.collection.untyped", layer: "data-store", type: "collection", op: "add", attributes: {} },
      { id: "data-store.collection.sql", layer: "data-store", type: "collection", op: "add", attributes: { collectionType: "COLLECTION" }, sourceReference: ref("db/schema.sql") },
      { id: "data-store.collection.file", layer: "data-store", type: "collection", op: "add", attributes: { collectionType: "COLLECTION" } },
      { id: "data-store.collection.table", layer: "data-store", type: "collection", op: "add", attributes: { collectionType: "TABLE" } },
    ]);
    expect(r.byId.get("data-store.collection.file")?.kind).toBe("file-collection");
    expect(r.byId.has("data-store.collection.table")).toBe(false);
    expect(r.byId.has("data-store.collection.untyped")).toBe(false);
    expect(r.byId.has("data-store.collection.sql")).toBe(false);
  });

  it("lists the files the index skipped that exist (#1319)", async () => {
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "scripts", "up.sh"), "up() {\n  echo\n}\n");
    const el = (id: string, file: string) => ({ id, layer: "technology", type: "script", op: "add", sourceReference: ref(file, "up") });
    const r = await run([el("technology.script.up", "scripts/up.sh"), el("technology.script.absent", "scripts/never.sh"), el("technology.script.escape", "../x.sh")]);
    expect(r.byId.get("technology.script.up")?.kind).toBe("unindexed-language");
    expect(r.byId.has("technology.script.absent")).toBe(false);
    expect(r.byId.has("technology.script.escape")).toBe(false);
    expect(r.unindexedFiles).toEqual(["scripts/up.sh"]);
  });
});
