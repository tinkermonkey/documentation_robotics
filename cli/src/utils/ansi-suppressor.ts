/**
 * Global ANSI code suppression for non-TTY output
 * Intercepts console output and strips ANSI escape sequences when the target stream is not a TTY
 * Handles stdout (log/info) and stderr (error/warn) independently based on their respective TTY status
 */

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Suppress the EPIPE 'error' event raised when a downstream reader closes the
 * pipe while output is being written (e.g. `dr upgrade --dry-run | head`).
 * Without a listener this is an unhandled error that crashes with a stack
 * trace; a CLI should exit quietly instead. Non-EPIPE errors are re-thrown so
 * genuine failures are not silently swallowed.
 */
function ignoreBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error && error.code === "EPIPE") {
      process.exit(0);
    }
    throw error;
  });
}

export function installAnsiSuppressor(): void {
  // A closed pipe must not crash the CLI regardless of TTY status.
  ignoreBrokenPipe(process.stdout);
  ignoreBrokenPipe(process.stderr);

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  // Suppress ANSI codes from stdout (log/info) if stdout is not a TTY
  const shouldSuppressStdout = process.stdout.isTTY !== true;
  if (shouldSuppressStdout) {
    console.log = function (...args: any[]) {
      const stripped = args.map((arg) => {
        if (typeof arg === "string") {
          return stripAnsi(arg);
        }
        return arg;
      });
      return originalLog.apply(console, stripped);
    };

    console.info = function (...args: any[]) {
      const stripped = args.map((arg) => {
        if (typeof arg === "string") {
          return stripAnsi(arg);
        }
        return arg;
      });
      return originalInfo.apply(console, stripped);
    };
  }

  // Suppress ANSI codes from stderr (error/warn) if stderr is not a TTY
  const shouldSuppressStderr = process.stderr.isTTY !== true;
  if (shouldSuppressStderr) {
    console.error = function (...args: any[]) {
      const stripped = args.map((arg) => {
        if (typeof arg === "string") {
          return stripAnsi(arg);
        }
        return arg;
      });
      return originalError.apply(console, stripped);
    };

    console.warn = function (...args: any[]) {
      const stripped = args.map((arg) => {
        if (typeof arg === "string") {
          return stripAnsi(arg);
        }
        return arg;
      });
      return originalWarn.apply(console, stripped);
    };
  }
}
