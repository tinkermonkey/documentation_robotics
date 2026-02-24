import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Minimal types for the stream-json event format emitted by `claude --output-format stream-json`.
 */
type StreamContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: string };

interface AssistantStreamEvent {
  type: "assistant";
  message: { content: StreamContentBlock[] };
}

interface ResultStreamEvent {
  type: "result";
  subtype: "success" | string;
  result?: string;
  is_error?: boolean;
}

type StreamEvent = AssistantStreamEvent | ResultStreamEvent | { type: string };

/**
 * Invoke Claude Code CLI in non-interactive print mode, streaming assistant
 * text events to stderr in real-time and returning the complete final result.
 *
 * Uses `--output-format stream-json` so the caller sees Claude's output
 * progressively (text, tool usage) instead of a silent wait followed by a
 * JSON dump on stdout.
 *
 * @param prompt - The prompt to send to Claude
 * @param target - Human-readable label used in error messages (e.g. layer ID)
 * @param timeoutMs - Per-invocation timeout in milliseconds
 * @returns The final response text (from the `result` event), ready for parsing
 */
export async function invokeClaudeStreaming(
  prompt: string,
  target: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "claude",
      ["--print", "--verbose", "--output-format", "stream-json", "--dangerously-skip-permissions", prompt],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );

    let lineBuffer = "";
    let finalResult = "";
    let lastCharWasNewline = true;

    function handleStreamEvent(event: StreamEvent): void {
      if (event.type === "assistant") {
        const blocks = (event as AssistantStreamEvent).message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "text" && "text" in block && block.text) {
            process.stderr.write(block.text);
            lastCharWasNewline = block.text.endsWith("\n");
          } else if (block.type === "tool_use" && "name" in block && block.name) {
            if (!lastCharWasNewline) process.stderr.write("\n");
            process.stderr.write(`  [tool: ${block.name}]\n`);
            lastCharWasNewline = true;
          }
          // thinking blocks are internal monologue — skip
        }
      } else if (event.type === "result") {
        const resultEvent = event as ResultStreamEvent;
        if (resultEvent.subtype === "success") {
          finalResult = resultEvent.result ?? "";
          // Ensure the streaming section ends on its own line
          if (!lastCharWasNewline) {
            process.stderr.write("\n");
            lastCharWasNewline = true;
          }
        }
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          handleStreamEvent(JSON.parse(trimmed) as StreamEvent);
        } catch {
          // Non-JSON line from Claude — ignore
        }
      }
    });

    // Forward Claude's own stderr (auth errors, warnings, etc.)
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Claude invocation timed out after ${timeoutMs / 1000}s (${target})`
        )
      );
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(`Claude invocation failed (${target}): exited with code ${code}`)
        );
      } else {
        resolve(finalResult);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(`Claude invocation failed (${target}): ${err.message}`)
      );
    });
  });
}
