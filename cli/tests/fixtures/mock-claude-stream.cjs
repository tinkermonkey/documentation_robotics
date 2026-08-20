#!/usr/bin/env node
/**
 * Mock claude subprocess for testing streaming JSON output
 *
 * Emits newline-delimited JSON events mimicking `claude --output-format stream-json`.
 * Produces a controllable sequence of events for testing chunk boundaries and event accumulation.
 *
 * Command-line arguments:
 * - --exit-code N: Exit code to use (default: 0)
 * - --split-chunks: Split one JSON line across two write() calls to test chunk-boundary buffering
 * - --no-final-newline: Omit the trailing newline on the last emitted line
 *
 * Backward compatibility: Also accepts environment variables as fallback
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
    type: "result",
    result: [
      {
        type: "tool_result",
        tool_use_id: "tool_123",
        content: "Analysis complete: function returns a number literal.",
      },
    ],
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
];

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
  }
}

// Emit all events and exit
emitEvents();
process.exitCode = EXIT_CODE;
