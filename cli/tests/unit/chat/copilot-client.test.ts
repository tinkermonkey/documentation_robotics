/**
 * Unit tests for CopilotClient
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { CopilotClient } from "../../../src/coding-agents/copilot-client";

describe("CopilotClient", () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = new CopilotClient();
  });

  describe("isAvailable", () => {
    it("should check for gh copilot or standalone copilot", async () => {
      const available = await client.isAvailable();

      // In CI, this will likely be false unless gh/copilot is installed
      // We're just verifying it returns a boolean and doesn't crash
      expect(typeof available).toBe("boolean");
    });

    it("should handle check gracefully", async () => {
      // Multiple calls should not crash
      await client.isAvailable();
      const available = await client.isAvailable();

      expect(typeof available).toBe("boolean");
    });
  });

  describe("getClientName", () => {
    it("should return correct client name", () => {
      expect(client.getClientName()).toBe("GitHub Copilot");
    });
  });

  describe("session management", () => {
    it("should start with no session", () => {
      expect(client.getCurrentSession()).toBeUndefined();
    });

    it("should clear session", () => {
      client.clearSession();
      expect(client.getCurrentSession()).toBeUndefined();
    });
  });
});
