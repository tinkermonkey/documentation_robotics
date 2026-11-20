/**
 * The smallest possible test file. tests/integration/golden-copy-cache-repair.test.ts runs it in
 * a `bun test` of its own to see what the preload (tests/setup.ts) prints and leaves on disk.
 */
import { expect, test } from "bun:test";

test("preload probe", () => {
  expect(true).toBe(true);
});
