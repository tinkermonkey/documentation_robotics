/**
 * The viewer's time limits are named settings with stated defaults, read from the environment;
 * a value that cannot be used is reported, not silently replaced.
 */

import { describe, expect, it } from "bun:test";
import {
  VIEWER_SETTINGS,
  ignoredViewerSettings,
  viewerSetting,
  viewerSettingsInEffect,
} from "../../../src/server/viewer-settings.js";

describe("viewer settings", () => {
  it("have these defaults", () => {
    expect(viewerSetting("idleHours", {})).toBe(24);
    expect(viewerSetting("healthTimeoutMs", {})).toBe(1500);
    expect(viewerSetting("healthRetryTimeoutMs", {})).toBe(5000);
    expect(viewerSetting("stopTimeoutMs", {})).toBe(8000);
    expect(viewerSetting("logKeepDays", {})).toBe(7);
    expect(viewerSetting("lifetimeCheckMs", {})).toBe(30000);
  });

  it("are each set by their own environment variable", () => {
    for (const [name, spec] of Object.entries(VIEWER_SETTINGS)) {
      expect(spec.env).toMatch(/^DR_VIEWER_[A-Z_]+$/);
      expect(viewerSetting(name as keyof typeof VIEWER_SETTINGS, { [spec.env]: "42" })).toBe(42);
    }
  });

  it("take 0 where 0 means something, and refuse it where it does not", () => {
    expect(viewerSetting("idleHours", { DR_VIEWER_IDLE_HOURS: "0" })).toBe(0);
    expect(viewerSetting("logKeepDays", { DR_VIEWER_LOG_KEEP_DAYS: "0" })).toBe(0);
    expect(viewerSetting("stopTimeoutMs", { DR_VIEWER_STOP_TIMEOUT_MS: "0" })).toBe(8000);
  });

  it("say which variables hold a value that was ignored", () => {
    const env = { DR_VIEWER_IDLE_HOURS: "a day", DR_VIEWER_STOP_TIMEOUT_MS: "-5", DR_VIEWER_LOG_KEEP_DAYS: "3" };
    const settings = viewerSettingsInEffect(env);
    expect(settings.idleHours).toEqual({ env: "DR_VIEWER_IDLE_HOURS", value: 24, unit: "hours", default: 24, ignored: "a day" });
    expect(settings.logKeepDays).toEqual({ env: "DR_VIEWER_LOG_KEEP_DAYS", value: 3, unit: "days", default: 7 });
    expect(ignoredViewerSettings(env)).toEqual([
      "DR_VIEWER_IDLE_HOURS=a day is not a usable value; using the default, 24 hours.",
      "DR_VIEWER_STOP_TIMEOUT_MS=-5 is not a usable value; using the default, 8000 ms.",
    ]);
    expect(ignoredViewerSettings({})).toEqual([]);
  });
});
