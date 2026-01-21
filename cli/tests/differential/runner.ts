import { spawn } from 'node:child_process';
import { ComparisonConfig } from './comparator';

/**
 * Command to execute in a CLI
 */
export interface CliCommand {
  /** Command to run (e.g., 'python', 'bun') */
  command: string;
  /** Arguments to pass */
  args: string[];
  /** Working directory */
  cwd: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Setup commands to run before the main command */
  setup?: string[][];
}

/**
 * Result of executing a command
 */
export interface CommandResult {
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Whether command succeeded */
  success: boolean;
}

/**
 * A test case comparing Python and TypeScript CLI outputs
 * For TypeScript-only tests, python can be omitted
 */
export interface TestCase {
  /** Name of the test case */
  name: string;
  /** Description of what's being tested */
  description?: string;
  /** Python command to run (optional for TypeScript-only tests) */
  python?: CliCommand;
  /** TypeScript command to run */
  typescript: CliCommand;
  /** How to compare the outputs */
  comparison: ComparisonConfig;
  /** Whether to skip this test */
  skip?: boolean;
  /** Expected to fail (for known incompatibilities) */
  expectedToFail?: boolean;
}

/**
 * Execute a command and capture output
 */
export async function executeCommand(cmd: CliCommand): Promise<CommandResult> {
  // Execute setup commands first if they exist
  if (cmd.setup && cmd.setup.length > 0) {
    for (const setupCmd of cmd.setup) {
      const [command, ...args] = setupCmd;
      const setupResult = await executeCommandInternal({
        command,
        args,
        cwd: '/tmp',  // Use /tmp for setup commands since cmd.cwd may not exist yet
        env: cmd.env,
        timeout: cmd.timeout
      });
      // If setup fails, return early with setup error
      if (!setupResult.success) {
        return {
          ...setupResult,
          stderr: `Setup command failed: ${command} ${args.join(' ')}\n${setupResult.stderr}`
        };
      }
    }
  }

  return executeCommandInternal(cmd);
}

/**
 * Internal function to execute a single command
 */
async function executeCommandInternal(cmd: CliCommand): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const timeout = cmd.timeout || 30000;
    const timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    const proc = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      env: { ...process.env, ...cmd.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      const executionTime = Date.now() - startTime;

      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        executionTime,
        success: code === 0
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      const executionTime = Date.now() - startTime;

      // Handle command not found (e.g., Python CLI not installed)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({
          exitCode: 127, // Standard "command not found" exit code
          stdout: '',
          stderr: `Command not found: ${cmd.command}`,
          executionTime,
          success: false
        });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Execute both Python and TypeScript commands for a test case
 * For TypeScript-only tests, python result will have exit code 0
 */
export async function executeTestCase(testCase: TestCase): Promise<{
  python: CommandResult;
  typescript: CommandResult;
}> {
  // For TypeScript-only tests, create a dummy python result
  if (!testCase.python) {
    const typescriptResult = await executeCommand(testCase.typescript);
    return {
      python: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        executionTime: 0,
        success: true
      },
      typescript: typescriptResult
    };
  }

  // Execute in parallel for speed
  const [pythonResult, typescriptResult] = await Promise.all([
    executeCommand(testCase.python),
    executeCommand(testCase.typescript)
  ]);

  return {
    python: pythonResult,
    typescript: typescriptResult
  };
}

/**
 * Format command for display
 */
export function formatCommand(cmd: CliCommand): string {
  const args = cmd.args.map(arg =>
    arg.includes(' ') ? `"${arg}"` : arg
  ).join(' ');
  return `${cmd.command} ${args}`;
}

/**
 * Format command result for display
 */
export function formatCommandResult(result: CommandResult, label: string): string {
  let output = `${label}:\n`;
  output += `  Exit code: ${result.exitCode}\n`;
  output += `  Execution time: ${result.executionTime}ms\n`;
  output += `  Success: ${result.success}\n`;

  if (result.stdout) {
    output += `\n  STDOUT:\n`;
    output += result.stdout.split('\n').map(line => `    ${line}`).join('\n');
  }

  if (result.stderr) {
    output += `\n  STDERR:\n`;
    output += result.stderr.split('\n').map(line => `    ${line}`).join('\n');
  }

  return output;
}
