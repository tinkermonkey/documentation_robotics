/**
 * Compatibility Test Harness
 * Dual CLI execution and comparison utilities for Python and Bun CLI
 */

import { execSync } from 'child_process';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { parse } from 'path';

/**
 * Result from executing a CLI command
 */
export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Comparison result between Python and Bun CLI outputs
 */
export interface ComparisonResult {
  pythonResult: CLIResult;
  bunResult: CLIResult;
  exitCodesMatch: boolean;
  outputsMatch: boolean;
  normalizedPythonOutput: string;
  normalizedBunOutput: string;
  differences: string[];
}

/**
 * File comparison result
 */
export interface FileComparison {
  pythonFile: string;
  bunFile: string;
  filesMatch: boolean;
  differences: string[];
}

/**
 * CLI Harness for running and comparing Python and Bun CLIs
 */
export class CLIHarness {
  private pythonCliPath: string;
  private bunCliPath: string;

  constructor(pythonCliPath: string = '', bunCliPath: string = '') {
    this.pythonCliPath = pythonCliPath || this.getPythonCliPath();
    this.bunCliPath = bunCliPath || this.getBunCliPath();
  }

  /**
   * Get path to Python CLI
   */
  private getPythonCliPath(): string {
    // Try common installation paths
    const paths = [
      '/home/orchestrator/.local/bin/dr',
      '/usr/local/bin/dr',
      '/usr/bin/dr',
      'dr', // Fallback to PATH
    ];

    for (const path of paths) {
      try {
        execSync(`${path} --version`, { stdio: 'pipe' });
        return path;
      } catch {
        // Try next path
      }
    }
    return 'dr'; // Last resort
  }

  /**
   * Get path to Bun CLI dist/cli.js
   */
  private getBunCliPath(): string {
    const cwd = process.cwd();
    if (cwd.includes('cli-bun')) {
      // Running from cli-bun directory
      return `${cwd}/dist/cli.js`;
    }
    // Default path relative to repo root
    return `${cwd}/cli-bun/dist/cli.js`;
  }

  /**
   * Run Python CLI
   */
  async runPython(args: string[], cwd: string = '/tmp'): Promise<CLIResult> {
    try {
      // Convert Bun CLI arguments to Python CLI arguments
      const pythonArgs = this.convertArgsToPython(args);
      const cmd = `${this.pythonCliPath} ${pythonArgs.join(' ')}`;
      const stdout = execSync(cmd, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { exitCode: 0, stdout, stderr: '' };
    } catch (error: any) {
      return {
        exitCode: error.status || 1,
        stdout: error.stdout?.toString() || '',
        stderr: error.stderr?.toString() || error.message,
      };
    }
  }

  /**
   * Run Bun CLI
   */
  async runBun(args: string[], cwd: string = '/tmp'): Promise<CLIResult> {
    try {
      const cmd = `node ${this.bunCliPath} ${args.join(' ')}`;
      const stdout = execSync(cmd, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { exitCode: 0, stdout, stderr: '' };
    } catch (error: any) {
      return {
        exitCode: error.status || 1,
        stdout: error.stdout?.toString() || '',
        stderr: error.stderr?.toString() || error.message,
      };
    }
  }

  /**
   * Convert Bun CLI arguments to Python CLI arguments
   * Handles differences in CLI interfaces (positional args vs named args)
   */
  private convertArgsToPython(bunArgs: string[]): string[] {
    const pythonArgs = [...bunArgs];

    // Convert init command arguments
    if (pythonArgs[0] === 'init') {
      let name = '';
      let description = '';
      let author = '';

      // Extract --name, --description, --author
      for (let i = 1; i < pythonArgs.length; i++) {
        if (pythonArgs[i] === '--name' && pythonArgs[i + 1]) {
          name = pythonArgs[i + 1];
          pythonArgs.splice(i, 2);
          i -= 2;
        } else if (pythonArgs[i] === '--description' && pythonArgs[i + 1]) {
          description = pythonArgs[i + 1];
          pythonArgs.splice(i, 2);
          i -= 2;
        } else if (pythonArgs[i] === '--author' && pythonArgs[i + 1]) {
          author = pythonArgs[i + 1];
          pythonArgs.splice(i, 2);
          i -= 2;
        }
      }

      // Reconstruct: python CLI expects positional project name first
      if (name) {
        pythonArgs.splice(1, 0, name);
      }

      // Add optional flags
      if (description) {
        pythonArgs.push('--description', description);
      }
      if (author) {
        pythonArgs.push('--author', author);
      }
    }

    return pythonArgs;
  }

  /**
   * Normalize CLI output for comparison
   */
  private normalizeOutput(output: string): string {
    if (!output) return '';
    // Remove ANSI color codes
    let normalized = output.replace(/\x1b\[[0-9;]*m/g, '');
    // Normalize line endings
    normalized = normalized.replace(/\r\n/g, '\n');
    // Normalize path separators
    normalized = normalized.replace(/\\/g, '/');
    // Collapse multiple spaces
    normalized = normalized.replace(/  +/g, ' ');
    // Trim each line
    normalized = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
    return normalized.trim();
  }

  /**
   * Compare JSON outputs
   */
  private compareJSON(pythonJson: string, bunJson: string): boolean {
    try {
      const pythonObj = JSON.parse(pythonJson);
      const bunObj = JSON.parse(bunJson);
      return JSON.stringify(pythonObj, null, 2) === JSON.stringify(bunObj, null, 2);
    } catch {
      // Fall back to string comparison if parsing fails
      return pythonJson === bunJson;
    }
  }

  /**
   * Compare XML outputs (normalized structure)
   */
  private compareXML(pythonXml: string, bunXml: string): boolean {
    // Simple structure normalization - compare without whitespace
    const normalizeXml = (xml: string) => {
      return xml.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
    };
    return normalizeXml(pythonXml) === normalizeXml(bunXml);
  }

  /**
   * Compare CLI outputs
   */
  async compareOutputs(args: string[], cwd: string = '/tmp'): Promise<ComparisonResult> {
    const [pythonResult, bunResult] = await Promise.all([
      this.runPython(args, cwd),
      this.runBun(args, cwd),
    ]);

    const normalizedPython = this.normalizeOutput(pythonResult.stdout);
    const normalizedBun = this.normalizeOutput(bunResult.stdout);

    const differences: string[] = [];
    const exitCodesMatch = pythonResult.exitCode === bunResult.exitCode;
    const outputsMatch = normalizedPython === normalizedBun;

    if (!exitCodesMatch) {
      differences.push(
        `Exit code mismatch: Python=${pythonResult.exitCode}, Bun=${bunResult.exitCode}`
      );
    }

    if (!outputsMatch) {
      differences.push(
        `Output mismatch:\nPython:\n${normalizedPython}\n\nBun:\n${normalizedBun}`
      );
    }

    return {
      pythonResult,
      bunResult,
      exitCodesMatch,
      outputsMatch,
      normalizedPythonOutput: normalizedPython,
      normalizedBunOutput: normalizedBun,
      differences,
    };
  }

  /**
   * Compare file outputs (JSON, XML, text)
   */
  async compareFileOutputs(
    args: string[],
    outputPath: string,
    cwd: string = '/tmp'
  ): Promise<FileComparison> {
    // Determine file type by extension
    const ext = outputPath.split('.').pop()?.toLowerCase() || 'txt';

    // Create temp directories for each CLI
    const pythonTempDir = `/tmp/dr-compat-python-${Date.now()}`;
    const bunTempDir = `/tmp/dr-compat-bun-${Date.now()}`;

    try {
      await mkdir(pythonTempDir, { recursive: true });
      await mkdir(bunTempDir, { recursive: true });

      // Run both CLIs in their temp directories
      const pythonArgs = [...args, '--output', `${pythonTempDir}/${outputPath}`];
      const bunArgs = [...args, '--output', `${bunTempDir}/${outputPath}`];

      await Promise.all([this.runPython(pythonArgs, cwd), this.runBun(bunArgs, cwd)]);

      // Read generated files
      const pythonFile = `${pythonTempDir}/${outputPath}`;
      const bunFile = `${bunTempDir}/${outputPath}`;

      if (!existsSync(pythonFile) || !existsSync(bunFile)) {
        return {
          pythonFile,
          bunFile,
          filesMatch: false,
          differences: [
            `Missing files: Python exists=${existsSync(pythonFile)}, Bun exists=${existsSync(bunFile)}`,
          ],
        };
      }

      const pythonContent = await readFile(pythonFile, 'utf-8');
      const bunContent = await readFile(bunFile, 'utf-8');

      let filesMatch = false;
      const differences: string[] = [];

      // Compare based on file type
      if (ext === 'json') {
        filesMatch = this.compareJSON(pythonContent, bunContent);
      } else if (ext === 'xml') {
        filesMatch = this.compareXML(pythonContent, bunContent);
      } else {
        const normalizedPython = this.normalizeOutput(pythonContent);
        const normalizedBun = this.normalizeOutput(bunContent);
        filesMatch = normalizedPython === normalizedBun;
      }

      if (!filesMatch) {
        differences.push(
          `Content mismatch:\nPython:\n${pythonContent.substring(0, 500)}\n...\n\nBun:\n${bunContent.substring(0, 500)}\n...`
        );
      }

      return {
        pythonFile,
        bunFile,
        filesMatch,
        differences,
      };
    } finally {
      // Cleanup
      try {
        await rm(pythonTempDir, { recursive: true, force: true });
        await rm(bunTempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Create a test directory with optional file structure
   */
  async createTestDirectory(
    basePath: string,
    structure?: Record<string, string>
  ): Promise<string> {
    await mkdir(basePath, { recursive: true });

    if (structure) {
      for (const [filePath, content] of Object.entries(structure)) {
        const fullPath = `${basePath}/${filePath}`;
        const dir = parse(fullPath).dir;
        await mkdir(dir, { recursive: true });
        await writeFile(fullPath, content, 'utf-8');
      }
    }

    return basePath;
  }

  /**
   * Cleanup a test directory
   */
  async cleanupTestDirectory(testDir: string): Promise<void> {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Parse error count from validation output
   */
  parseErrorCount(output: string): number {
    const match = output.match(/(\d+)\s+errors?/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Parse warning count from validation output
   */
  parseWarningCount(output: string): number {
    const match = output.match(/(\d+)\s+warnings?/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Assert that CLIs produce equivalent outputs
   */
  async assertCLIsEquivalent(args: string[], cwd: string = '/tmp'): Promise<ComparisonResult> {
    const result = await this.compareOutputs(args, cwd);
    if (!result.exitCodesMatch || !result.outputsMatch) {
      throw new Error(`CLI outputs not equivalent:\n${result.differences.join('\n')}`);
    }
    return result;
  }

  /**
   * Assert that CLIs fail equivalently (same exit code)
   */
  async assertCLIsFailEquivalently(
    args: string[],
    cwd: string = '/tmp'
  ): Promise<ComparisonResult> {
    const result = await this.compareOutputs(args, cwd);
    if (!result.exitCodesMatch) {
      throw new Error(
        `CLI exit codes don't match: Python=${result.pythonResult.exitCode}, Bun=${result.bunResult.exitCode}`
      );
    }
    if (result.exitCodesMatch && result.pythonResult.exitCode === 0) {
      throw new Error('Expected both CLIs to fail, but both succeeded');
    }
    return result;
  }
}
