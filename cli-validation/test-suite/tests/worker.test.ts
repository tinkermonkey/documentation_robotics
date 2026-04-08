/**
 * Unit Tests for Worker Process Functions
 *
 * Tests for validateStep and getSnapshotMode functions that determine
 * test pass/fail status and control filesystem snapshot I/O overhead.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Test assertion helpers for compatibility with standard Node.js assertions
 */
class TestAssertions {
  value: any;

  constructor(value: any) {
    this.value = value;
  }

  toBe(expected: any): void {
    assert.strictEqual(this.value, expected, `Expected ${expected} but got ${this.value}`);
  }

  toEqual(expected: any): void {
    assert.deepStrictEqual(
      this.value,
      expected,
      `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(this.value)}`
    );
  }

  toBeTruthy(): void {
    assert(this.value, `Expected value to be truthy but got: ${this.value}`);
  }

  toBeFalsy(): void {
    assert(!this.value, `Expected value to be falsy but got: ${this.value}`);
  }

  toInclude(item: any): void {
    assert(
      Array.isArray(this.value) && this.value.includes(item),
      `Expected array to include ${item} but got: ${JSON.stringify(this.value)}`
    );
  }

  toHaveLength(length: number): void {
    assert.strictEqual(
      Array.isArray(this.value) ? this.value.length : this.value?.length,
      length,
      `Expected length ${length} but got: ${this.value?.length ?? 'undefined'}`
    );
  }

  toContain(substring: string): void {
    assert(
      String(this.value).includes(substring),
      `Expected value to contain "${substring}"\nActual: ${String(this.value).slice(0, 200)}...`
    );
  }
}

function expect(value: any): TestAssertions {
  return new TestAssertions(value);
}

/**
 * Mock implementations of worker functions for testing
 * These are extracted from worker.ts for unit testing
 */

// Type definitions matching worker.ts
interface PipelineStep {
  command: string;
  files_to_compare: string[];
  expect_exit_code?: number;
  expect_stdout_contains?: string[];
  expect_stderr_contains?: string[];
  timeout?: number;
}

interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

interface StepResult {
  command: string;
  pythonOutput: {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
  };
  tsOutput: CommandOutput;
  filesystemDiff: {
    python: {
      path: string;
      type: 'added' | 'deleted' | 'modified';
    }[];
    ts: {
      path: string;
      type: 'added' | 'deleted' | 'modified';
    }[];
  };
  passed: boolean;
  failures: string[];
}

/**
 * Validate a single step's expectations
 * Validates exit codes, output content, and filesystem changes
 */
function validateStep(
  step: PipelineStep,
  tsOutput: CommandOutput,
  tsChanges: Array<{ path: string; type: string }>
): StepResult {
  const failures: string[] = [];

  // Validate exit codes
  const expectedExitCode = step.expect_exit_code ?? 0;
  if (tsOutput.exitCode !== expectedExitCode) {
    failures.push(`CLI exit code: expected ${expectedExitCode}, got ${tsOutput.exitCode}`);
  }

  // Validate stdout contains
  if (step.expect_stdout_contains) {
    for (const expected of step.expect_stdout_contains) {
      if (!tsOutput.stdout.includes(expected)) {
        failures.push(`stdout missing: "${expected}"`);
      }
    }
  }

  // Validate stderr contains
  if (step.expect_stderr_contains) {
    for (const expected of step.expect_stderr_contains) {
      if (!tsOutput.stderr.includes(expected)) {
        failures.push(`stderr missing: "${expected}"`);
      }
    }
  }

  // Validate filesystem changes match expected files
  for (const expectedFile of step.files_to_compare) {
    const tsModified = tsChanges.some(
      (c) => c.path === expectedFile && c.type !== 'unchanged'
    );

    if (!tsModified) {
      failures.push(`Did not modify expected file: ${expectedFile}`);
    }
  }

  // Map filesystem changes to proper types
  const typedChanges = tsChanges.map((c) => ({
    path: c.path,
    type: c.type === 'added' || c.type === 'deleted' || c.type === 'modified'
      ? c.type as 'added' | 'deleted' | 'modified'
      : 'modified' as const,
  }));

  return {
    command: step.command,
    pythonOutput: {
      stdout: '',
      stderr: '',
      exitCode: 0,
      duration: 0,
    },
    tsOutput,
    filesystemDiff: {
      python: [],
      ts: typedChanges,
    },
    passed: failures.length === 0,
    failures,
  };
}

/**
 * Determine which snapshot mode to use based on step configuration
 *
 * Mode 1 (Targeted): Non-empty files_to_compare → read only specified files
 * Mode 2 (Skip): Empty files_to_compare with only stdout/stderr assertions → no snapshots
 * Mode 3 (Full): All other cases → full directory walk (safety net)
 */
function getSnapshotMode(step: PipelineStep): 'targeted' | 'skip' | 'full' {
  // Mode 1: Non-empty files_to_compare
  if (step.files_to_compare && step.files_to_compare.length > 0) {
    return 'targeted';
  }

  // Mode 2: Empty files_to_compare with stdout/stderr assertions
  if (
    (!step.files_to_compare || step.files_to_compare.length === 0) &&
    (step.expect_stdout_contains || step.expect_stderr_contains)
  ) {
    return 'skip';
  }

  // Mode 3: Full walk (default for everything else)
  return 'full';
}

// ============================================================================
// validateStep Tests
// ============================================================================

describe('validateStep', () => {
  describe('Exit Code Validation', () => {
    it('should pass when exit code matches expected success (0)', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_exit_code: 0,
      };

      const output: CommandOutput = {
        stdout: '',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('should pass when exit code matches expected non-zero value', () => {
      const step: PipelineStep = {
        command: 'failing command',
        files_to_compare: [],
        expect_exit_code: 1,
      };

      const output: CommandOutput = {
        stdout: '',
        stderr: 'Error message',
        exitCode: 1,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('should fail when exit code does not match expected', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_exit_code: 0,
      };

      const output: CommandOutput = {
        stdout: '',
        stderr: 'Unexpected error',
        exitCode: 1,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toContain('CLI exit code: expected 0, got 1');
    });

    it('should default to expecting exit code 0 when not specified', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        // expect_exit_code not specified
      };

      const output: CommandOutput = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(true);
    });

    it('should fail when expecting 0 but got non-zero without explicit expectation', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        // expect_exit_code not specified (defaults to 0)
      };

      const output: CommandOutput = {
        stdout: '',
        stderr: 'Unexpected error',
        exitCode: 127,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(false);
      expect(result.failures[0]).toContain('CLI exit code: expected 0, got 127');
    });
  });

  describe('Stdout Validation', () => {
    it('should pass when all expected stdout strings are present', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_stdout_contains: ['Success', 'Operation completed'],
      };

      const output: CommandOutput = {
        stdout: 'Success! Operation completed successfully',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(true);
    });

    it('should fail when expected stdout is missing', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_stdout_contains: ['Success', 'Missing text'],
      };

      const output: CommandOutput = {
        stdout: 'Success!',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toContain('stdout missing: "Missing text"');
    });

    it('should fail when multiple stdout assertions are missing', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_stdout_contains: ['First', 'Second', 'Third'],
      };

      const output: CommandOutput = {
        stdout: 'Only has First',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(2);
    });

    it('should be case-sensitive in stdout matching', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_stdout_contains: ['SUCCESS'],
      };

      const output: CommandOutput = {
        stdout: 'Success!',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(false);
    });
  });

  describe('Stderr Validation', () => {
    it('should pass when all expected stderr strings are present', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_exit_code: 1,
        expect_stderr_contains: ['Error', 'validation failed'],
      };

      const output: CommandOutput = {
        stdout: '',
        stderr: 'Error: validation failed on line 5',
        exitCode: 1,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(true);
    });

    it('should fail when expected stderr is missing', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
        expect_exit_code: 1,
        expect_stderr_contains: ['Error', 'Missing message'],
      };

      const output: CommandOutput = {
        stdout: '',
        stderr: 'Error occurred',
        exitCode: 1,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.passed).toBe(false);
      expect(result.failures[0]).toContain('stderr missing: "Missing message"');
    });
  });

  describe('Filesystem Change Validation', () => {
    it('should pass when expected files are modified', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: ['file1.yaml', 'file2.json'],
      };

      const output: CommandOutput = {
        stdout: 'Files modified',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const changes = [
        { path: 'file1.yaml', type: 'modified' },
        { path: 'file2.json', type: 'added' },
      ];

      const result = validateStep(step, output, changes);
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('should fail when expected file is not in changes', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: ['file1.yaml', 'file2.json'],
      };

      const output: CommandOutput = {
        stdout: 'Files modified',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const changes = [{ path: 'file1.yaml', type: 'modified' }];

      const result = validateStep(step, output, changes);
      expect(result.passed).toBe(false);
      expect(result.failures[0]).toContain('Did not modify expected file: file2.json');
    });

    it('should fail when expected file is marked unchanged', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: ['file1.yaml'],
      };

      const output: CommandOutput = {
        stdout: 'Command executed',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const changes = [{ path: 'file1.yaml', type: 'unchanged' }];

      const result = validateStep(step, output, changes);
      expect(result.passed).toBe(false);
      expect(result.failures[0]).toContain('Did not modify expected file: file1.yaml');
    });

    it('should handle empty files_to_compare list', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: [],
      };

      const output: CommandOutput = {
        stdout: 'Done',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const changes = [{ path: 'file.yaml', type: 'modified' }];

      const result = validateStep(step, output, changes);
      expect(result.passed).toBe(true);
    });

    it('should correctly map change types in result', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: ['new.yaml', 'removed.yaml', 'changed.yaml'],
      };

      const output: CommandOutput = {
        stdout: 'OK',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const changes = [
        { path: 'new.yaml', type: 'added' },
        { path: 'removed.yaml', type: 'deleted' },
        { path: 'changed.yaml', type: 'modified' },
      ];

      const result = validateStep(step, output, changes);
      expect(result.filesystemDiff.ts).toHaveLength(3);
      expect(result.filesystemDiff.ts[0].type).toBe('added');
      expect(result.filesystemDiff.ts[1].type).toBe('deleted');
      expect(result.filesystemDiff.ts[2].type).toBe('modified');
    });
  });

  describe('Combined Validation', () => {
    it('should fail when multiple validations fail', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: ['file.yaml'],
        expect_exit_code: 0,
        expect_stdout_contains: ['Expected text'],
        expect_stderr_contains: ['No error'],
      };

      const output: CommandOutput = {
        stdout: 'Wrong output',
        stderr: 'An error occurred',
        exitCode: 1,
        duration: 100,
      };

      const changes: { path: string; type: string }[] = [];

      const result = validateStep(step, output, changes);
      expect(result.passed).toBe(false);
      expect(result.failures.length).toBe(4); // exit code, stdout, stderr, file
    });

    it('should pass when all validations succeed', () => {
      const step: PipelineStep = {
        command: 'test command',
        files_to_compare: ['file.yaml'],
        expect_exit_code: 0,
        expect_stdout_contains: ['Success'],
        expect_stderr_contains: [],
      };

      const output: CommandOutput = {
        stdout: 'Success! Operation complete',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const changes = [{ path: 'file.yaml', type: 'modified' }];

      const result = validateStep(step, output, changes);
      expect(result.passed).toBe(true);
    });

    it('should preserve command in result', () => {
      const step: PipelineStep = {
        command: 'my test command',
        files_to_compare: [],
      };

      const output: CommandOutput = {
        stdout: '',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };

      const result = validateStep(step, output, []);
      expect(result.command).toBe('my test command');
    });
  });
});

// ============================================================================
// getSnapshotMode Tests
// ============================================================================

describe('getSnapshotMode', () => {
  describe('Mode 1: Targeted Snapshot Mode', () => {
    it('should return "targeted" when files_to_compare is non-empty', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: ['file1.yaml', 'file2.json'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('targeted');
    });

    it('should return "targeted" with single file in files_to_compare', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: ['only-file.yaml'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('targeted');
    });

    it('should return "targeted" with multiple files in files_to_compare', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: ['a.yaml', 'b.yaml', 'c.yaml', 'd.yaml', 'e.yaml'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('targeted');
    });

    it('should prioritize files_to_compare over stdout/stderr assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: ['file.yaml'],
        expect_stdout_contains: ['Success'],
        expect_stderr_contains: ['No error'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('targeted');
    });
  });

  describe('Mode 2: Skip Snapshot Mode', () => {
    it('should return "skip" with empty files_to_compare and stdout assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
        expect_stdout_contains: ['Success'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('skip');
    });

    it('should return "skip" with empty files_to_compare and stderr assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
        expect_stderr_contains: ['Error'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('skip');
    });

    it('should return "skip" with empty files_to_compare and both stdout and stderr assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
        expect_stdout_contains: ['Success'],
        expect_stderr_contains: ['Error'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('skip');
    });

    it('should return "skip" with undefined files_to_compare and stdout assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: undefined as any,
        expect_stdout_contains: ['Success'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('skip');
    });

    it('should return "skip" with undefined files_to_compare and stderr assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: undefined as any,
        expect_stderr_contains: ['Error'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('skip');
    });
  });

  describe('Mode 3: Full Snapshot Mode', () => {
    it('should return "full" when files_to_compare is empty and no output assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('full');
    });

    it('should return "full" when files_to_compare is undefined and no output assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: undefined as any,
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('full');
    });

    it('should return "full" as default safety net for comprehensive validation', () => {
      const step: PipelineStep = {
        command: 'dangerous-command',
        files_to_compare: [],
        // No assertions specified - catch everything
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('full');
    });

    it('should return "full" when only expect_exit_code is specified', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
        expect_exit_code: 0,
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('full');
    });

    it('should return "full" when files_to_compare is empty with timeout specified', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
        timeout: 5000,
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('full');
    });
  });

  describe('Edge Cases and Priority Resolution', () => {
    it('should handle files_to_compare with empty array explicitly', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('full');
    });

    it('should handle stdout_contains with empty array', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: [],
        expect_stdout_contains: [],
      };

      // Empty stdout_contains array means no stdout assertions - treated like skip mode
      // because step has an assertion array (even though empty), triggering skip mode
      const mode = getSnapshotMode(step);
      expect(mode).toBe('skip');
    });

    it('should respect priority: files_to_compare wins over stdout/stderr assertions', () => {
      const step: PipelineStep = {
        command: 'test',
        files_to_compare: ['file.yaml'],
        expect_stdout_contains: ['text'],
        expect_stderr_contains: ['error'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('targeted');
    });

    it('should distinguish between skip and full modes correctly', () => {
      const skipStep: PipelineStep = {
        command: 'test1',
        files_to_compare: [],
        expect_stdout_contains: ['text'],
      };

      const fullStep: PipelineStep = {
        command: 'test2',
        files_to_compare: [],
      };

      expect(getSnapshotMode(skipStep)).toBe('skip');
      expect(getSnapshotMode(fullStep)).toBe('full');
    });
  });

  describe('I/O Impact Scenarios', () => {
    it('should use skip mode to reduce I/O for simple output validation', () => {
      // Scenario: only checking that command succeeds silently
      const step: PipelineStep = {
        command: 'simple-command',
        files_to_compare: [],
        expect_stdout_contains: ['OK'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('skip');
      // This avoids unnecessary directory walks
    });

    it('should use targeted mode to focus I/O on relevant files', () => {
      // Scenario: only interested in specific model files changing
      const step: PipelineStep = {
        command: 'add-element',
        files_to_compare: ['manifest.yaml', '01_motivation/goal.yaml'],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('targeted');
      // This avoids reading unrelated files
    });

    it('should use full mode as safety net for unknown changes', () => {
      // Scenario: command with unknown side effects
      const step: PipelineStep = {
        command: 'complex-operation',
        files_to_compare: [],
      };

      const mode = getSnapshotMode(step);
      expect(mode).toBe('full');
      // This ensures no silent filesystem changes are missed
    });
  });
});
