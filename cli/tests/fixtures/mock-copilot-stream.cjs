#!/usr/bin/env node
/**
 * Mock copilot subprocess for testing plain text streaming
 *
 * Emits plain text/markdown content across multiple discrete write() calls
 * to simulate realistic streaming output from `gh copilot` or `copilot` commands.
 *
 * Command-line arguments:
 * - --exit-code N: Exit code to use (default: 0)
 *
 * Backward compatibility: Also accepts environment variables as fallback
 */

const args = process.argv.slice(2);
const getArgValue = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

const EXIT_CODE = parseInt(getArgValue("--exit-code") || process.env.EXIT_CODE || "0", 10);

// Text chunks to emit across multiple writes
const chunks = [
  "Here's a solution for your problem:\n\n",
  "```typescript\n",
  "function calculateSum(numbers: number[]): number {\n",
  "  return numbers.reduce((acc, num) => acc + num, 0);\n",
  "}\n",
  "```\n\n",
  "This function uses the `reduce` method to sum all numbers in the array.",
];

/**
 * Emit chunks with delays to simulate streaming
 */
async function emitChunks() {
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(chunks[i]);
    // Add small delay between chunks to simulate streaming (except for the last chunk)
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

// Emit all chunks and exit
emitChunks().then(() => {
  process.exitCode = EXIT_CODE;
});
