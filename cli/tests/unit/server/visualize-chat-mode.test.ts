/**
 * dr visualize's chat mode (#1240): the chat agent stages changes in a changeset unless the viewer
 * is started with --read-only; danger mode wins over both.
 */

import { describe, expect, it } from "bun:test";
import { resolveChatMode } from "../../../src/commands/visualize.js";

describe("resolveChatMode", () => {
  it("stages into changesets by default", () => {
    expect(resolveChatMode({})).toEqual({
      withDanger: false,
      withChangesets: true,
    });
  });

  it("turns staging off with --read-only", () => {
    expect(resolveChatMode({ readOnly: true })).toEqual({
      withDanger: false,
      withChangesets: false,
    });
  });

  it("lets danger mode win, since it already allows every write", () => {
    expect(resolveChatMode({ withDanger: true })).toEqual({
      withDanger: true,
      withChangesets: false,
    });
    expect(resolveChatMode({ withDanger: true, readOnly: true })).toEqual({
      withDanger: true,
      withChangesets: false,
    });
  });
});
