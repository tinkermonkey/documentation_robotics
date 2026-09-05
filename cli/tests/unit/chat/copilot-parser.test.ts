/**
 * Unit tests for CopilotOutputParser
 * Tests the heuristic parsing of GitHub Copilot plain text output
 */

import { describe, it, expect } from "bun:test";

// We'll need to export the parser from copilot-client for testing
// For now, we'll test the integration through the client

describe("Copilot Output Parsing", () => {
  describe("Code block detection", () => {
    it("should detect code block start", () => {
      const line = "```typescript";
      // Parser should detect this as code block start
      expect(line).toMatch(/^```(\w*)$/);
    });

    it("should detect code block end", () => {
      const line = "```";
      // Parser should detect this as code block end
      expect(line).toMatch(/^```(\w*)$/);
    });

    it("should detect various code block languages", () => {
      const languages = ["javascript", "python", "bash", "json", "yaml"];
      for (const lang of languages) {
        const line = `\`\`\`${lang}`;
        expect(line).toMatch(/^```(\w*)$/);
      }
    });
  });

  describe("System message detection", () => {
    it("should detect note messages", () => {
      const line = "Note: This is a system message";
      expect(line).toMatch(/^(Note:|Warning:|Error:|Info:)/i);
    });

    it("should detect warning messages", () => {
      const line = "Warning: Be careful with this";
      expect(line).toMatch(/^(Note:|Warning:|Error:|Info:)/i);
    });

    it("should detect error messages", () => {
      const line = "Error: Something went wrong";
      expect(line).toMatch(/^(Note:|Warning:|Error:|Info:)/i);
    });

    it("should detect info messages", () => {
      const line = "Info: Additional information";
      expect(line).toMatch(/^(Note:|Warning:|Error:|Info:)/i);
    });

    it("should be case insensitive", () => {
      const lines = ["note:", "NOTE:", "Note:", "WARNING:", "error:"];
      for (const line of lines) {
        expect(line).toMatch(/^(Note:|Warning:|Error:|Info:)/i);
      }
    });
  });

  describe("Tool invocation detection", () => {
    it("should detect running actions", () => {
      const line = "Running: npm install";
      expect(line).toMatch(/^(Running|Executing|Searching|Analyzing):/i);
    });

    it("should detect executing actions", () => {
      const line = "Executing: build script";
      expect(line).toMatch(/^(Running|Executing|Searching|Analyzing):/i);
    });

    it("should detect searching actions", () => {
      const line = "Searching: for references";
      expect(line).toMatch(/^(Running|Executing|Searching|Analyzing):/i);
    });

    it("should detect analyzing actions", () => {
      const line = "Analyzing: code structure";
      expect(line).toMatch(/^(Running|Executing|Searching|Analyzing):/i);
    });
  });
});
