/**
 * CLI Runner Utilities
 * Provides helpers for running dr commands in tests
 */

import { spawnSync } from 'bun';
import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Result of running a CLI command
 */
export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Options for running CLI commands
 */
export interface RunDrOptions {
  cwd?: string;
  env?: Record<string, string>;
  throwOnError?: boolean;
}

/**
 * Create a temporary directory for CLI testing
 *
 * @returns Object with path and cleanup function
 */
export async function createTempWorkdir(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const path = join(tmpdir(), `dr-cli-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`);

  await mkdir(path, { recursive: true });

  return {
    path,
    cleanup: async () => {
      try {
        await rm(path, { recursive: true, force: true });
      } catch (e) {
        // Silently ignore cleanup errors
      }
    },
  };
}

/**
 * Run a dr CLI command
 * Uses the compiled CLI from dist/cli.js
 *
 * @param args Command arguments (e.g., ['init', '--name', 'My Model'])
 * @param options Optional configuration for command execution
 * @returns Promise resolving to the command result
 * @throws Error if throwOnError is true and command fails
 */
export async function runDr(args: string[], options?: RunDrOptions): Promise<CLIResult> {
  try {
    const cliPath = new URL('../../dist/cli.js', import.meta.url).pathname;

    // Ensure PATH includes /usr/local/bin for node executable
    const env = options?.env
      ? { ...process.env, ...options.env }
      : { ...process.env };

    if (!env.PATH?.includes('/usr/local/bin')) {
      env.PATH = `/usr/local/bin:${env.PATH}`;
    }

    const result = spawnSync({
      cmd: ['node', cliPath, ...args],
      cwd: options?.cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    const stdout = result.stdout?.toString() ?? '';
    const stderr = result.stderr?.toString() ?? '';
    const exitCode = result.exitCode ?? 1;

    if (options?.throwOnError && exitCode !== 0) {
      throw new Error(`Command failed with exit code ${exitCode}: ${stderr || stdout}`);
    }

    return { exitCode, stdout, stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (options?.throwOnError) {
      throw error;
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: message,
    };
  }
}

/**
 * Run multiple dr commands sequentially
 *
 * @param commands Array of command argument arrays
 * @param options Optional configuration
 * @returns Array of results for each command
 */
export async function runDrSequential(
  commands: string[][],
  options?: RunDrOptions
): Promise<CLIResult[]> {
  const results: CLIResult[] = [];

  for (const args of commands) {
    const result = await runDr(args, options);
    results.push(result);

    if (options?.throwOnError && result.exitCode !== 0) {
      throw new Error(`Command sequence failed at: dr ${args.join(' ')}\n${result.stderr}`);
    }
  }

  return results;
}

/**
 * Parse JSON output from a CLI command
 *
 * @param result The CLI result to parse
 * @returns Parsed JSON object
 * @throws Error if output is not valid JSON
 */
export function parseJsonOutput(result: CLIResult): unknown {
  if (!result.stdout) {
    throw new Error('No output to parse');
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse JSON output: ${result.stdout}`);
  }
}

/**
 * Assert a CLI command succeeded
 *
 * @param result The CLI result to check
 * @param message Optional error message
 * @throws Error if exit code is not 0
 */
export function assertCliSuccess(result: CLIResult, message?: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      message || `CLI command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`
    );
  }
}

/**
 * Assert a CLI command failed
 *
 * @param result The CLI result to check
 * @param expectedExitCode Expected exit code (default 1)
 * @param message Optional error message
 * @throws Error if command succeeded unexpectedly
 */
export function assertCliFailed(result: CLIResult, expectedExitCode: number = 1, message?: string): void {
  if (result.exitCode === 0) {
    throw new Error(message || `CLI command succeeded when it should have failed: ${result.stdout}`);
  }

  if (result.exitCode !== expectedExitCode) {
    throw new Error(message || `CLI command failed with exit code ${result.exitCode}, expected ${expectedExitCode}`);
  }
}

/**
 * Assert output contains expected text
 *
 * @param result The CLI result to check
 * @param text Expected text
 * @param message Optional error message
 * @throws Error if text not found
 */
export function assertOutputContains(result: CLIResult, text: string, message?: string): void {
  const output = result.stdout + result.stderr;

  if (!output.includes(text)) {
    throw new Error(message || `Output does not contain expected text: "${text}"\n\nActual output:\n${output}`);
  }
}

/**
 * Strip ANSI escape codes from a string
 *
 * @param text Text with ANSI codes
 * @returns Text without ANSI codes
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}
