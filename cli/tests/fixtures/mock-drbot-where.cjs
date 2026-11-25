#!/usr/bin/env node
/**
 * Fake DrBot agent for the launcher tests (tests/unit/server/dr-bot-launcher.test.ts): reports
 * where it runs, as Claude Code stream-json. Its one assistant text block is the JSON
 * {cwd, mcpRoot, chatRoot}: its working directory and its DR_MCP_ROOT_PATH and
 * DR_CHAT_PROJECT_ROOT. Then the end-of-turn `result` event.
 *
 * - --hold FILE: before answering, wait until FILE exists (keeps the turn running).
 */

const fs = require("fs");

const args = process.argv.slice(2);
const holdIndex = args.indexOf("--hold");
const holdFile = holdIndex >= 0 ? args[holdIndex + 1] : null;

function answer() {
  const where = JSON.stringify({
    cwd: process.cwd(),
    mcpRoot: process.env.DR_MCP_ROOT_PATH ?? null,
    chatRoot: process.env.DR_CHAT_PROJECT_ROOT ?? null,
  });
  process.stdout.write(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: where }] } }) + "\n"
  );
  process.stdout.write(JSON.stringify({ type: "result", result: where, is_error: false }) + "\n");
  process.exit(0);
}

// The launcher writes the message to stdin and closes it; read it so the pipe drains.
process.stdin.resume();
process.stdin.on("data", () => {});

if (!holdFile) {
  answer();
} else {
  const timer = setInterval(() => {
    if (fs.existsSync(holdFile)) {
      clearInterval(timer);
      answer();
    }
  }, 20);
}
