/**
 * Unit tests for the MCP annotation tool handlers — success and error paths
 * for each of the annotation_* tools registered by McpToolRegistry.
 */

import { describe, it, expect } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model } from "../../../src/core/model.js";
import { modelAddHandler } from "../../../src/mcp/tools/model-add.js";
import { annotationListHandler } from "../../../src/mcp/tools/annotation-list.js";
import { annotationGetHandler } from "../../../src/mcp/tools/annotation-get.js";
import { annotationCreateHandler } from "../../../src/mcp/tools/annotation-create.js";
import { annotationUpdateHandler } from "../../../src/mcp/tools/annotation-update.js";
import { annotationDeleteHandler } from "../../../src/mcp/tools/annotation-delete.js";
import { annotationReplyHandler } from "../../../src/mcp/tools/annotation-reply.js";

function parse(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function withProject(fn: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = join(
    tmpdir(),
    `dr-mcp-annotations-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(rootPath, { recursive: true });
  await Model.init(rootPath, { name: "MCP Annotation Tools Unit Test Model", version: "0.1.0" });

  await modelAddHandler({
    layer: "business",
    type: "businessservice",
    name: "payments",
    description: "Payments service",
    rootPath,
  });

  try {
    await fn(rootPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
}

describe("MCP annotation tools", () => {
  describe("annotation_create", () => {
    it("creates an annotation on an existing element", async () => {
      await withProject(async (rootPath) => {
        const result = await annotationCreateHandler({
          elementId: "business.businessservice.payments",
          content: "Needs review",
          author: "alice",
          tags: ["needs-review"],
          rootPath,
        });
        const data = parse(result);
        expect(data.elementId).toBe("business.businessservice.payments");
        expect(data.author).toBe("alice");
        expect(data.tags).toEqual(["needs-review"]);
        expect(data.resolved).toBe(false);
      });
    });

    it("returns a structured not-found error for a missing element", async () => {
      await withProject(async (rootPath) => {
        const result = await annotationCreateHandler({
          elementId: "business.businessservice.missing",
          content: "orphaned",
          rootPath,
        });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });
  });

  describe("annotation_list / annotation_get", () => {
    it("lists and retrieves annotations filtered by elementId", async () => {
      await withProject(async (rootPath) => {
        const created = parse(
          await annotationCreateHandler({
            elementId: "business.businessservice.payments",
            content: "Needs review",
            rootPath,
          })
        );

        const listed = parse(await annotationListHandler({ elementId: "business.businessservice.payments", rootPath }));
        expect(listed.annotations.map((a: any) => a.id)).toEqual([created.id]);

        const fetched = parse(await annotationGetHandler({ annotationId: created.id, rootPath }));
        expect(fetched.content).toBe("Needs review");
      });
    });

    it("returns a structured not-found error for a missing annotation", async () => {
      await withProject(async (rootPath) => {
        const result = await annotationGetHandler({ annotationId: "ann-does-not-exist", rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("not_found");
      });
    });
  });

  describe("annotation_update", () => {
    it("partially updates content, tags, and resolved state", async () => {
      await withProject(async (rootPath) => {
        const created = parse(
          await annotationCreateHandler({
            elementId: "business.businessservice.payments",
            content: "original",
            rootPath,
          })
        );

        const updated = parse(
          await annotationUpdateHandler({ annotationId: created.id, resolved: true, rootPath })
        );
        expect(updated.resolved).toBe(true);
        expect(updated.content).toBe("original");
      });
    });

    it("rejects a call with no fields to update", async () => {
      await withProject(async (rootPath) => {
        const created = parse(
          await annotationCreateHandler({
            elementId: "business.businessservice.payments",
            content: "original",
            rootPath,
          })
        );

        const result = await annotationUpdateHandler({ annotationId: created.id, rootPath });
        expect(result.isError).toBe(true);
        const data = parse(result);
        expect(data.category).toBe("user");
      });
    });
  });

  describe("annotation_reply", () => {
    it("adds a reply that shows up on annotation_get", async () => {
      await withProject(async (rootPath) => {
        const created = parse(
          await annotationCreateHandler({
            elementId: "business.businessservice.payments",
            content: "original",
            rootPath,
          })
        );

        await annotationReplyHandler({ annotationId: created.id, author: "bob", content: "Fixed", rootPath });

        const fetched = parse(await annotationGetHandler({ annotationId: created.id, rootPath }));
        expect(fetched.replies).toHaveLength(1);
        expect(fetched.replies[0]).toMatchObject({ author: "bob", content: "Fixed" });
      });
    });
  });

  describe("annotation_delete", () => {
    it("deletes an annotation so it is no longer retrievable", async () => {
      await withProject(async (rootPath) => {
        const created = parse(
          await annotationCreateHandler({
            elementId: "business.businessservice.payments",
            content: "original",
            rootPath,
          })
        );

        const deleteResult = parse(await annotationDeleteHandler({ annotationId: created.id, rootPath }));
        expect(deleteResult.status).toBe("deleted");

        const getResult = await annotationGetHandler({ annotationId: created.id, rootPath });
        expect(getResult.isError).toBe(true);
      });
    });
  });
});
