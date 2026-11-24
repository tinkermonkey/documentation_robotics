/**
 * The commit progress reporter (core/commit-progress.ts, issue 1361): what it throttles, what it
 * always sends, and the process-wide channel the central server listens on.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCommitProgressReporter,
  publishCommitProgress,
  sameRootPath,
  subscribeCommitProgress,
  type PublishedCommitProgress,
} from "../../../src/core/commit-progress.js";

/** A reporter over a clock the test moves, recording what it publishes. */
function recording(intervalMs = 200) {
  let clock = 1_000;
  const sent: PublishedCommitProgress[] = [];
  const reporter = createCommitProgressReporter("/repo", "cs-1", {
    intervalMs,
    now: () => clock,
    publish: (progress) => sent.push(progress),
  });
  return {
    reporter,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createCommitProgressReporter", () => {
  it("sends a 1,200-change commit as a handful of reports, not one per change", () => {
    const { reporter, sent, advance } = recording();
    reporter.onProgress({ changesetId: "cs-1", applied: 0, total: 1200, phase: "validating" });
    for (let applied = 0; applied < 1200; applied++) {
      reporter.onProgress({ changesetId: "cs-1", applied, total: 1200, phase: "applying", layer: "api" });
      advance(1); // 1,200 changes in 1.2 s
    }
    reporter.onProgress({ changesetId: "cs-1", applied: 1200, total: 1200, phase: "applying" });
    reporter.onProgress({ changesetId: "cs-1", applied: 1200, total: 1200, phase: "saving" });
    reporter.finish();

    // validating, the first applying, one per 200 ms of applying (6), saving, done.
    expect(sent.length).toBeLessThanOrEqual(12);
    expect(sent.length).toBeGreaterThanOrEqual(5);
    expect(sent[0]).toMatchObject({ phase: "validating", applied: 0, total: 1200 });
    expect(sent[1]).toMatchObject({ phase: "applying", applied: 0, layer: "api" });
    const applying = sent.filter((p) => p.phase === "applying");
    for (let i = 1; i < applying.length; i++) {
      expect(applying[i].applied).toBeGreaterThan(applying[i - 1].applied);
    }
  });

  it("sends the first report and every change of phase at once", () => {
    const { reporter, sent } = recording();
    reporter.onProgress({ changesetId: "cs-1", applied: 0, total: 3, phase: "validating" });
    reporter.onProgress({ changesetId: "cs-1", applied: 0, total: 3, phase: "applying", layer: "api" });
    reporter.onProgress({ changesetId: "cs-1", applied: 1, total: 3, phase: "applying", layer: "api" });
    reporter.onProgress({ changesetId: "cs-1", applied: 3, total: 3, phase: "saving" });
    reporter.phase("reloading");

    expect(sent.map((p) => p.phase)).toEqual(["validating", "applying", "saving", "reloading"]);
    expect(sent[3]).toMatchObject({ applied: 3, total: 3 });
    expect(sent[3].layer).toBeUndefined();
  });

  it("always ends a success with applied == total and phase done, even when throttled", () => {
    const { reporter, sent } = recording(10_000);
    reporter.onProgress({ changesetId: "cs-1", applied: 0, total: 5, phase: "applying" });
    reporter.onProgress({ changesetId: "cs-1", applied: 4, total: 5, phase: "applying" }); // throttled
    reporter.finish();

    expect(sent.at(-1)).toEqual({ rootPath: "/repo", changesetId: "cs-1", applied: 5, total: 5, phase: "done" });
  });

  it("ends a failure with failed: true in the phase it stopped in, and sends nothing after", () => {
    const { reporter, sent } = recording(10_000);
    reporter.onProgress({ changesetId: "cs-1", applied: 0, total: 5, phase: "applying" });
    reporter.onProgress({ changesetId: "cs-1", applied: 2, total: 5, phase: "applying", layer: "data-model" });
    reporter.fail();
    reporter.finish();
    reporter.onProgress({ changesetId: "cs-1", applied: 5, total: 5, phase: "saving" });

    expect(sent.at(-1)).toEqual({
      rootPath: "/repo",
      changesetId: "cs-1",
      applied: 2,
      total: 5,
      phase: "applying",
      layer: "data-model",
      failed: true,
    });
    expect(sent.filter((p) => p.phase === "done")).toHaveLength(0);
  });

  it("sends the final report once", () => {
    const { reporter, sent } = recording();
    reporter.onProgress({ changesetId: "cs-1", applied: 0, total: 1, phase: "validating" });
    reporter.finish();
    reporter.finish();
    reporter.fail();
    expect(sent.filter((p) => p.phase === "done")).toHaveLength(1);
    expect(sent.some((p) => p.failed)).toBe(false);
  });
});

describe("the commit progress channel", () => {
  it("delivers each report to every listener until it unsubscribes", () => {
    const heard: PublishedCommitProgress[] = [];
    const stop = subscribeCommitProgress((p) => heard.push(p));
    const report: PublishedCommitProgress = { rootPath: "/a", changesetId: "x", applied: 0, total: 1, phase: "validating" };
    publishCommitProgress(report);
    stop();
    publishCommitProgress(report);
    expect(heard).toEqual([report]);
  });

  it("keeps going when a listener throws", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const heard: string[] = [];
    const stopBad = subscribeCommitProgress(() => {
      throw new Error("boom");
    });
    const stopGood = subscribeCommitProgress((p) => heard.push(p.changesetId));
    try {
      publishCommitProgress({ rootPath: "/a", changesetId: "x", applied: 0, total: 0, phase: "done" });
    } finally {
      stopBad();
      stopGood();
      warn.mockRestore();
    }
    expect(heard).toEqual(["x"]);
  });

  it("matches root paths by their resolved form", () => {
    expect(sameRootPath("/a/b/../c", "/a/c")).toBe(true);
    expect(sameRootPath("/a/c", "/a/d")).toBe(false);
  });

  it("matches a checkout reached through a symlink with its real path (macOS /tmp is /private/tmp)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dr-progress-root-"));
    try {
      const real = path.join(dir, "checkout");
      await mkdir(real);
      const linked = path.join(dir, "linked");
      await symlink(real, linked);
      expect(sameRootPath(linked, real)).toBe(true);
      expect(sameRootPath(linked, await realpath(real))).toBe(true);
      expect(sameRootPath(linked, path.join(dir, "other"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
