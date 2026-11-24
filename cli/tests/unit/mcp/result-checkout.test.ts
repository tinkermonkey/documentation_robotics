/**
 * Every tool result names its checkout (#1279, slice 3A): withResultCheckout, applied in the
 * shared dispatch, adds `project` and `checkout` to a JSON object result in its own layout, as a
 * text item of their own otherwise, and under `_meta["dr/checkout"]` always.
 */

import { describe, expect, it } from "bun:test";
import { RESULT_CHECKOUT_META, withResultCheckout } from "../../../src/mcp/tool-registry.js";
import { compactJson, jsonResult } from "../../../src/mcp/tools/shared.js";

const REF = { project: "alpha", checkout: "feature" };

describe("withResultCheckout", () => {
  it("puts project and checkout first in an indented JSON result", () => {
    const result = withResultCheckout(jsonResult({ count: 2, items: ["a"] }), REF);
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ project: "alpha", checkout: "feature", count: 2, items: ["a"] });
    expect(text.startsWith('{\n  "project": "alpha",\n  "checkout": "feature",\n  "count": 2')).toBe(true);
    expect(result._meta?.[RESULT_CHECKOUT_META]).toEqual(REF);
  });

  it("keeps a compact or one-line result valid", () => {
    const compact = withResultCheckout(jsonResult({ a: 1 }, { compact: true }), REF);
    expect(JSON.parse((compact.content[0] as { text: string }).text)).toEqual({ project: "alpha", checkout: "feature", a: 1 });
    const empty = withResultCheckout({ content: [{ type: "text", text: compactJson({}) }] }, REF);
    expect(JSON.parse((empty.content[0] as { text: string }).text)).toEqual({ project: "alpha", checkout: "feature" });
  });

  it("names them on an error result too", () => {
    const result = withResultCheckout(jsonResult({ error: "nope" }, { isError: true }), REF);
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content[0] as { text: string }).text).checkout).toBe("feature");
  });

  it("adds a text item of their own beside a result that is not a JSON object", () => {
    const result = withResultCheckout({ content: [{ type: "text", text: "plain words" }] }, REF);
    expect(result.content).toHaveLength(2);
    expect(JSON.parse((result.content[1] as { text: string }).text)).toEqual(REF);
  });

  it("leaves a result that names them itself as it is, and names an unknown checkout as null", () => {
    const own = jsonResult({ project: "beta", checkout: "main" });
    expect(withResultCheckout(own, REF).content).toEqual(own.content);
    const unknown = withResultCheckout(jsonResult({ ok: true }), null);
    expect(JSON.parse((unknown.content[0] as { text: string }).text)).toMatchObject({ project: null, checkout: null });
  });
});
