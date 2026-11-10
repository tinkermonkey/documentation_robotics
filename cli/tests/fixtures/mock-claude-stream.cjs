#!/usr/bin/env node
/**
 * Mock claude subprocess for testing streaming JSON output
 *
 * Emits newline-delimited JSON events mimicking `claude --output-format stream-json`:
 * text, a tool call that succeeds, a Bash call denied at the permission prompt (an error
 * tool_result), more text, and the end-of-turn `result` event.
 *
 * Command-line arguments:
 * - --exit-code N: Exit code to use (default: 0)
 * - --split-chunks: Split one JSON line across two write() calls to test chunk-boundary buffering
 * - --no-final-newline: Omit the trailing newline on the last emitted line
 * - --emit-non-json: Inject a plain-text line after the first JSON event for fallback testing
 * - --emit-init: Start with the `system` init event that carries the session id
 * - --unanswered-tool: Add a tool call that never gets a tool_result
 *
 * Each option also accepts an equivalent environment variable as a fallback.
 */

const args = process.argv.slice(2);
const hasArg = (name) => args.includes(name);
const getArgValue = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

const EXIT_CODE = parseInt(getArgValue("--exit-code") || process.env.EXIT_CODE || "0", 10);
const SPLIT_CHUNKS = hasArg("--split-chunks") || process.env.SPLIT_CHUNKS === "true";
const NO_FINAL_NEWLINE = hasArg("--no-final-newline") || process.env.NO_FINAL_NEWLINE === "true";
const EMIT_NON_JSON = hasArg("--emit-non-json") || process.env.EMIT_NON_JSON === "true";
const EMIT_INIT = hasArg("--emit-init") || process.env.EMIT_INIT === "true";
const UNANSWERED_TOOL = hasArg("--unanswered-tool") || process.env.UNANSWERED_TOOL === "true";

const DENIAL =
  "Claude requested permissions to use Bash, but you haven't granted it yet.";

// Define the event sequence
const events = [
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "Hello, I'm Claude. How can I help you today?",
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "analyze_code",
          input: {
            code: "function test() { return 42; }",
          },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_123",
          content: "Analysis complete: function returns a number literal.",
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "Bash",
          input: { command: "dr list api | head" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_456",
          content: DENIAL,
          is_error: true,
        },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "The function is straightforward and returns the constant 42.",
        },
      ],
    },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "The function is straightforward and returns the constant 42.",
    permission_denials: [
      { tool_name: "Bash", tool_use_id: "tool_456", tool_input: { command: "dr list api | head" } },
    ],
  },
];

if (EMIT_INIT) {
  events.unshift({ type: "system", subtype: "init", session_id: "mock-session" });
}

if (UNANSWERED_TOOL) {
  events.splice(events.length - 1, 0, {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "tool_789", name: "Read", input: { file_path: "x" } }],
    },
  });
}

// Emit events
function emitEvents() {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const line = JSON.stringify(event);

    // On the last event, check if we should omit the final newline
    const isLast = i === events.length - 1;
    const shouldOmitNewline = isLast && NO_FINAL_NEWLINE;

    if (SPLIT_CHUNKS && !isLast) {
      // Split the JSON line across two writes on the second event
      if (i === 1) {
        const mid = Math.floor(line.length / 2);
        process.stdout.write(line.substring(0, mid));
        process.stdout.write(line.substring(mid) + "\n");
      } else {
        process.stdout.write(line + "\n");
      }
    } else {
      process.stdout.write(line + (shouldOmitNewline ? "" : "\n"));
    }

    // Inject a non-JSON line after the first event if flag is set
    if (EMIT_NON_JSON && i === 0) {
      process.stdout.write("This is not JSON\n");
    }
  }
}

// Emit all events and exit
emitEvents();
process.exitCode = EXIT_CODE;
