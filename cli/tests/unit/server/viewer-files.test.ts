/**
 * How the server caches viewer files (#1308): only a content-hashed asset is cached for good;
 * index.html and every other file is revalidated by its ETag, which a rebuild in place changes.
 */

import { describe, expect, it } from "bun:test";
import { isHashedViewerAsset, viewerFileEtag } from "../../../src/server/server.js";

describe("isHashedViewerAsset", () => {
  it("knows Vite's hashed asset names", () => {
    expect(isHashedViewerAsset("assets/index-B3x9kQ2a.js")).toBe(true);
    expect(isHashedViewerAsset("assets/Inter-ExtraBold-BYj_oED-.woff2")).toBe(true);
    expect(isHashedViewerAsset("nested/assets/style-Cerq10X2.css")).toBe(true);
  });

  it("revalidates everything else", () => {
    expect(isHashedViewerAsset("index.html")).toBe(false);
    expect(isHashedViewerAsset("favicon.svg")).toBe(false);
    expect(isHashedViewerAsset("manifest.json")).toBe(false);
    expect(isHashedViewerAsset("assets/app-settings.js")).toBe(false);
    expect(isHashedViewerAsset("assets/index.js")).toBe(false);
    expect(isHashedViewerAsset("index-B3x9kQ2a.js")).toBe(false);
  });
});

describe("viewerFileEtag", () => {
  it("changes with the file's size or modification time", () => {
    const etag = viewerFileEtag({ size: 100, mtimeMs: 1_000.4 });
    expect(etag).toBe('W/"100-1000"');
    expect(viewerFileEtag({ size: 101, mtimeMs: 1_000.4 })).not.toBe(etag);
    expect(viewerFileEtag({ size: 100, mtimeMs: 2_000 })).not.toBe(etag);
  });
});
