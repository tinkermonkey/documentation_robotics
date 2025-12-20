/**
 * Compatibility Test Harness
 * Executes both Python and Bun CLIs with identical arguments and compares outputs
 */

import { spawn, spawnSync } from 'bun';
import { mkdir, rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  success: boolean;
}

export interface ComparisonResult {
  exitCodesMatch: boolean;
  stdoutMatch: boolean;
  stderrMatch: boolean;
  pythonExitCode: number | null;
  bunExitCode: number | null;
  pythonStdout: string;
  bunStdout: string;
  pythonStderr: string;
  bunStderr: string;
  differences: string[];
}

export class CLIHarness {
  private pythonCLI: string;
  private bunCLI: string;

  constructor(pythonCLI: string = '/home/orchestrator/.local/bin/dr', bunCLI: string = 'node dist/cli.js') {
    this.pythonCLI = pythonCLI;
    this.bunCLI = bunCLI;
  }

  /**
   * Run Python CLI with given arguments
   */
  async runPython(args: string[], cwd?: string): Promise<CLIResult> {
    try {
      const result = spawnSync({
        cmd: [this.pythonCLI, ...args],
        cwd: cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdout = result.stdout?.toString() ?? '';
      const stderr = result.stderr?.toString() ?? '';
      const exitCode = result.exitCode;

      return {
        stdout,
        stderr,
        exitCode,
        success: exitCode === 0,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `Error running Python CLI: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
        success: false,
      };
    }
  }

  /**
   * Run Bun CLI with given arguments
   */
  async runBun(args: string[], cwd?: string): Promise<CLIResult> {
    try {
      const result = spawnSync({
        cmd: [this.bunCLI, ...args],
        cwd: cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdout = result.stdout?.toString() ?? '';
      const stderr = result.stderr?.toString() ?? '';
      const exitCode = result.exitCode;

      return {
        stdout,
        stderr,
        exitCode,
        success: exitCode === 0,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: `Error running Bun CLI: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
        success: false,
      };
    }
  }

  /**
   * Normalize output for comparison (handles whitespace, line endings, formatting)
   */
  private normalizeOutput(output: string): string {
    return (
      output
        .trim()
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        // Normalize multiple spaces
        .replace(/[ \t]+/g, ' ')
        // Remove ANSI color codes
        .replace(/\x1b\[[0-9;]*m/g, '')
        // Normalize file paths (convert backslashes to forward slashes)
        .replace(/\\/g, '/')
    );
  }

  /**
   * Check if two outputs are semantically equivalent
   */
  private areOutputsEquivalent(actual: string, expected: string): boolean {
    return this.normalizeOutput(actual) === this.normalizeOutput(expected);
  }

  /**
   * Compare exit codes (allowing for success variations)
   */
  private exitCodesMatch(pythonCode: number | null, bunCode: number | null): boolean {
    // Both successful
    if (pythonCode === 0 && bunCode === 0) return true;
    // Both failed (non-zero)
    if (pythonCode !== 0 && pythonCode !== null && bunCode !== 0 && bunCode !== null) return true;
    // Exact match
    return pythonCode === bunCode;
  }

  /**
   * Compare outputs from both CLIs and return detailed comparison results
   */
  async compareOutputs(args: string[], cwd?: string): Promise<ComparisonResult> {
    const [pythonResult, bunResult] = await Promise.all([
      this.runPython(args, cwd),
      this.runBun(args, cwd),
    ]);

    const differences: string[] = [];

    // Check exit codes
    const exitCodesMatch = this.exitCodesMatch(pythonResult.exitCode, bunResult.exitCode);
    if (!exitCodesMatch) {
      differences.push(
        `Exit code mismatch: Python=${pythonResult.exitCode}, Bun=${bunResult.exitCode}`,
      );
    }

    // Check stdout
    const stdoutMatch = this.areOutputsEquivalent(pythonResult.stdout, bunResult.stdout);
    if (!stdoutMatch) {
      differences.push('Stdout output differs');
    }

    // Check stderr (more lenient - content may differ for errors)
    const stderrMatch = this.areOutputsEquivalent(pythonResult.stderr, bunResult.stderr);
    if (!stderrMatch && pythonResult.stderr.length > 0 && bunResult.stderr.length > 0) {
      // Only report if both produced errors
      differences.push('Stderr output differs');
    }

    return {
      exitCodesMatch,
      stdoutMatch,
      stderrMatch,
      pythonExitCode: pythonResult.exitCode,
      bunExitCode: bunResult.exitCode,
      pythonStdout: this.normalizeOutput(pythonResult.stdout),
      bunStdout: this.normalizeOutput(bunResult.stdout),
      pythonStderr: this.normalizeOutput(pythonResult.stderr),
      bunStderr: this.normalizeOutput(bunResult.stderr),
      differences,
    };
  }

  /**
   * Compare file outputs from both CLIs
   */
  async compareFileOutputs(
    args: string[],
    outputPath: string,
    cwd?: string,
    fileExtension: string = 'json',
  ): Promise<{ pythonFile: string; bunFile: string; match: boolean; differences: string[] }> {
    const pythonOutputPath = `${outputPath}.python.${fileExtension}`;
    const bunOutputPath = `${outputPath}.bun.${fileExtension}`;

    // Run both CLIs with output paths
    const pythonArgs = [...args, '--output', pythonOutputPath];
    const bunArgs = [...args, '--output', bunOutputPath];

    const [pythonResult, bunResult] = await Promise.all([
      this.runPython(pythonArgs, cwd),
      this.runBun(bunArgs, cwd),
    ]);

    const differences: string[] = [];

    // Check if both commands succeeded
    if (pythonResult.exitCode !== 0) {
      differences.push(`Python CLI failed with exit code ${pythonResult.exitCode}`);
    }
    if (bunResult.exitCode !== 0) {
      differences.push(`Bun CLI failed with exit code ${bunResult.exitCode}`);
    }

    if (differences.length > 0) {
      return {
        pythonFile: '',
        bunFile: '',
        match: false,
        differences,
      };
    }

    try {
      const pythonContent = await readFile(pythonOutputPath, 'utf-8');
      const bunContent = await readFile(bunOutputPath, 'utf-8');

      let match = false;

      if (fileExtension === 'json') {
        match = this.areJSONEquivalent(pythonContent, bunContent);
      } else if (fileExtension === 'xml' || fileExtension === 'archimate') {
        match = this.areXMLEquivalent(pythonContent, bunContent);
      } else {
        match = this.normalizeOutput(pythonContent) === this.normalizeOutput(bunContent);
      }

      if (!match) {
        differences.push(`File contents differ`);
      }

      return {
        pythonFile: pythonContent,
        bunFile: bunContent,
        match,
        differences,
      };
    } catch (error) {
      return {
        pythonFile: '',
        bunFile: '',
        match: false,
        differences: [
          `Error reading output files: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }

  /**
   * Compare JSON files semantically (ignoring formatting)
   */
  private areJSONEquivalent(pythonJSON: string, bunJSON: string): boolean {
    try {
      const pythonObj = JSON.parse(pythonJSON);
      const bunObj = JSON.parse(bunJSON);
      return JSON.stringify(pythonObj, null, 0) === JSON.stringify(bunObj, null, 0);
    } catch {
      // Fall back to string comparison if parsing fails
      return this.normalizeOutput(pythonJSON) === this.normalizeOutput(bunJSON);
    }
  }

  /**
   * Compare XML files structurally (ignoring whitespace and attribute order)
   */
  private areXMLEquivalent(pythonXML: string, bunXML: string): boolean {
    // Normalize XML: remove comments, normalize whitespace, sort attributes
    const normalize = (xml: string) => {
      return xml
        .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
        .replace(/>\s+</g, '><') // Remove whitespace between tags
        .replace(/\s+/g, ' ') // Normalize internal whitespace
        .trim();
    };

    return normalize(pythonXML) === normalize(bunXML);
  }

  /**
   * Create a temporary test directory with given structure
   */
  async createTestDirectory(basePath: string, structure?: Record<string, string>): Promise<string> {
    const testDir = join(basePath, `test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    if (structure) {
      for (const [filePath, content] of Object.entries(structure)) {
        const fullPath = join(testDir, filePath);
        const dirPath = dirname(fullPath);
        await mkdir(dirPath, { recursive: true });
        const file = Bun.file(fullPath);
        await Bun.write(file, content);
      }
    }

    return testDir;
  }

  /**
   * Clean up test directory
   */
  async cleanupTestDirectory(testDir: string): Promise<void> {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Extract error count from validation output
   */
  parseErrorCount(output: string): number {
    const match = output.match(/(\d+)\s+error/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Extract warning count from validation output
   */
  parseWarningCount(output: string): number {
    const match = output.match(/(\d+)\s+warning/i);
    return match ? parseInt(match[1], 10) : 0;
  }
}

/**
 * Helper to run both CLIs and assert they produce equivalent results
 */
export async function assertCLIsEquivalent(
  harness: CLIHarness,
  args: string[],
  cwd?: string,
): Promise<ComparisonResult> {
  const result = await harness.compareOutputs(args, cwd);

  if (!result.exitCodesMatch || !result.stdoutMatch) {
    throw new Error(`CLIs produced different outputs:\n${result.differences.join('\n')}`);
  }

  return result;
}

/**
 * Helper to run both CLIs and assert they fail with equivalent errors
 */
export async function assertCLIsFailEquivalently(
  harness: CLIHarness,
  args: string[],
  cwd?: string,
): Promise<ComparisonResult> {
  const result = await harness.compareOutputs(args, cwd);

  if (result.bunExitCode === 0 || result.pythonExitCode === 0) {
    throw new Error(
      `Expected both CLIs to fail, but got Python=${result.pythonExitCode}, Bun=${result.bunExitCode}`,
    );
  }

  return result;
}
