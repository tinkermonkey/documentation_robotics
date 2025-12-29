/**
 * Command Executor
 *
 * Executes CLI commands with timeout handling, output capture (stdout/stderr),
 * and exit code tracking. Supports both Python and TypeScript CLIs.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Output from a single command execution
 */
export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number; // Milliseconds
}

/**
 * Execute a command in a specified working directory with timeout
 *
 * @param command Full command to execute (e.g., "dr add motivation goal new-goal")
 * @param cwd Working directory where command executes
 * @param timeout Execution timeout in milliseconds (default: 30000)
 * @returns CommandOutput with stdout, stderr, exitCode, and duration
 *
 * @remarks
 * - Exit code 0 indicates success
 * - Non-zero exit codes indicate command failure
 * - Timeout throws an error that is caught and returns exit code 124
 * - stderr is captured even on success (not all output goes to exit code)
 */
export async function executeCommand(
  command: string,
  cwd: string,
  timeout: number = 30000
): Promise<CommandOutput> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    // Handle different error types
    let exitCode = 1;
    let stdout = '';
    let stderr = '';

    // Timeout error
    if (error.code === 'ETIMEDOUT') {
      exitCode = 124; // Standard timeout exit code
      stderr = `Command timed out after ${timeout}ms`;
    } else if (error.killed) {
      // Process was killed
      exitCode = 137; // Signal 9 (SIGKILL) + 128
      stderr = 'Process was killed';
    } else {
      // Normal command failure
      exitCode = error.code || 1;
      stdout = error.stdout || '';
      stderr = error.stderr || '';
    }

    return {
      stdout,
      stderr,
      exitCode,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Format command output for display
 *
 * @param output CommandOutput to format
 * @returns Formatted string representation
 */
export function formatCommandOutput(output: CommandOutput): string {
  let result = `Exit Code: ${output.exitCode}\n`;
  result += `Duration: ${output.duration}ms\n`;

  if (output.stdout) {
    result += `\nStdout:\n${output.stdout}`;
  }

  if (output.stderr) {
    result += `\nStderr:\n${output.stderr}`;
  }

  return result;
}
