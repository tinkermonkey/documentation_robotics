/**
 * Global ANSI code suppression for non-TTY output
 * Intercepts console output and strips ANSI escape sequences when stdout is not a TTY
 */

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function installAnsiSuppressor(): void {
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
