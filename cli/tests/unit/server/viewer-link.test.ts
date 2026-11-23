/**
 * Deep links into the shared viewer (issue 1279, design section 9): the route and the token in
 * the fragment, never the query string, with every name URL-encoded.
 */
import { describe, expect, it } from "bun:test";
import { viewerUrl } from "../../../src/server/viewer-link.js";

const record = { port: 8080 };
const ref = { project: "documentation-robotics", checkout: "main" };

describe("viewerUrl", () => {
  it("links to a checkout", () => {
    expect(viewerUrl(record, ref)).toEqual({
      url: "http://127.0.0.1:8080/#/p/documentation-robotics/c/main/",
      project: "documentation-robotics",
      checkout: "main",
    });
  });

  it("links to a changeset with the token in the fragment", () => {
    const link = viewerUrl(record, { ...ref, checkout: "t11-test-reliability-4a7e32" }, { changeset: "changeset-1" }, "tok");
    expect(link.url).toBe(
      "http://127.0.0.1:8080/#/p/documentation-robotics/c/t11-test-reliability-4a7e32/changesets/changeset-1?token=tok"
    );
    expect(link.changeset).toBe("changeset-1");
    expect(link.element).toBeUndefined();
  });

  it("links to an element, alone or in a changeset", () => {
    expect(viewerUrl(record, ref, { element: "api.endpoint.x" }, "tok").url).toBe(
      "http://127.0.0.1:8080/#/p/documentation-robotics/c/main/elements/api.endpoint.x?token=tok"
    );
    const both = viewerUrl(record, ref, { changeset: "cs", element: "api.endpoint.x" }, "tok");
    expect(both.url).toBe("http://127.0.0.1:8080/#/p/documentation-robotics/c/main/changesets/cs?element=api.endpoint.x&token=tok");
    expect(both).toMatchObject({ changeset: "cs", element: "api.endpoint.x" });
  });

  it("never puts the route or the token in the query string", () => {
    const url = new URL(viewerUrl(record, ref, { changeset: "cs" }, "s3cret/+=").url);
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/");
    expect(url.hash).toContain("token=");
    // The token round-trips through the fragment's parameters.
    expect(new URLSearchParams(url.hash.split("?")[1]).get("token")).toBe("s3cret/+=");
  });

  it("URL-encodes names, so a name can't change the route", () => {
    const link = viewerUrl(record, { project: "my proj", checkout: "feat/x?y#z" }, { changeset: "a/b" });
    expect(link.url).toBe("http://127.0.0.1:8080/#/p/my%20proj/c/feat%2Fx%3Fy%23z/changesets/a%2Fb");
    expect(link).toMatchObject({ project: "my proj", checkout: "feat/x?y#z", changeset: "a/b" });
  });

  it("refuses a record without a usable port, or a ref without names", () => {
    expect(() => viewerUrl({ port: 0 }, ref)).toThrow(/port/);
    expect(() => viewerUrl({ port: 70000 }, ref)).toThrow(/port/);
    expect(() => viewerUrl(record, { project: "", checkout: "main" })).toThrow(/project/);
  });
});
