#!/usr/bin/env node
/**
 * Mock claude that fails the way `claude --session-id <id>` does when the session already
 * exists, then behaves like mock-claude-stream on the next run.
 *
 * Usage: node mock-claude-session-in-use.cjs <state-file>
 * The state file counts runs: the first run writes "Session ID ... is already in use" to stderr
 * and exits 1 with no stdout; later runs emit the normal mock stream.
 */

const fs = require("fs");
const path = require("path");

const stateFile = process.argv[2];
const runs = fs.existsSync(stateFile) ? parseInt(fs.readFileSync(stateFile, "utf-8"), 10) : 0;
fs.writeFileSync(stateFile, String(runs + 1));

if (runs === 0) {
  process.stderr.write("Error: Session ID 00000000-0000-0000-0000-000000000000 is already in use.\n");
  process.exitCode = 1;
} else {
  require(path.join(__dirname, "mock-claude-stream.cjs"));
}
