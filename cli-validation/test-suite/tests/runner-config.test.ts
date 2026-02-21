/**
 * Runner Configuration Tests
 *
 * Tests for command-line argument parsing and filtering
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { matchesFilters, RunnerOptions } from '../runner-config.js';

/**
 * Test assertion helpers for compatibility with Bun's expect-like syntax
 */
class TestAssertions {
  value: any;

  constructor(value: any) {
    this.value = value;
  }

  toContain(substring: string): void {
    assert(
      String(this.value).includes(substring),
      `Expected value to contain "${substring}"\nActual: ${String(this.value).slice(0, 200)}...`
    );
  }

  toMatch(regex: RegExp): void {
    assert(
      regex.test(String(this.value)),
      `Expected value to match regex ${regex}\nActual: ${String(this.value).slice(0, 200)}...`
    );
  }

  toBe(expected: any): void {
    assert.equal(this.value, expected, `Expected ${expected} but got ${this.value}`);
  }

  toBeTruthy(): void {
    assert(this.value, `Expected value to be truthy but got: ${this.value}`);
  }

  toBeLessThan(expected: number): void {
    assert(
      this.value < expected,
      `Expected value ${this.value} to be less than ${expected}`
    );
  }

  toBeUndefined(): void {
    assert.equal(this.value, undefined, `Expected value to be undefined but got: ${this.value}`);
  }
}

function expect(value: any): TestAssertions {
  return new TestAssertions(value);
}

describe('matchesFilters', () => {
  it('should include tests without filters', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
    };

    expect(matchesFilters('Element CRUD', 'high', options)).toBe(true);
    expect(matchesFilters('Business Services', 'medium', options)).toBe(true);
    expect(matchesFilters('Edge Cases', 'low', options)).toBe(true);
  });

  it('should filter by priority', () => {
    const highPriority: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      priority: 'high',
    };

    expect(matchesFilters('Critical Tests', 'high', highPriority)).toBe(true);
    expect(matchesFilters('Medium Priority', 'medium', highPriority)).toBe(false);
    expect(matchesFilters('Low Priority', 'low', highPriority)).toBe(false);
  });

  it('should filter by test case name (substring match)', () => {
    const testCaseFilter: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      testCase: 'element',
    };

    expect(matchesFilters('Element CRUD Operations', 'high', testCaseFilter)).toBe(true);
    expect(matchesFilters('ELEMENT MANAGEMENT', 'high', testCaseFilter)).toBe(true);
    expect(matchesFilters('element-crud', 'high', testCaseFilter)).toBe(true);
    expect(matchesFilters('Business Services', 'high', testCaseFilter)).toBe(false);
  });

  it('should apply both priority and test case filters', () => {
    const combinedFilter: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      priority: 'high',
      testCase: 'element',
    };

    expect(matchesFilters('Element CRUD', 'high', combinedFilter)).toBe(true);
    expect(matchesFilters('Element CRUD', 'medium', combinedFilter)).toBe(false);
    expect(matchesFilters('Business CRUD', 'high', combinedFilter)).toBe(false);
  });

  it('should be case-insensitive for test case filter', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      testCase: 'ELEMENT',
    };

    expect(matchesFilters('element-crud', 'high', options)).toBe(true);
    expect(matchesFilters('Element CRUD', 'high', options)).toBe(true);
    expect(matchesFilters('ELEMENT OPERATIONS', 'high', options)).toBe(true);
  });

  it('should handle undefined filters gracefully', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      priority: undefined,
      testCase: undefined,
    };

    expect(matchesFilters('Element CRUD', 'high', options)).toBe(true);
  });

  it('should match partial strings for test case', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      testCase: 'crud',
    };

    expect(matchesFilters('Element CRUD Operations', 'high', options)).toBe(true);
    expect(matchesFilters('element-crud-business', 'high', options)).toBe(true);
    expect(matchesFilters('Business Operations', 'high', options)).toBe(false);
  });

  it('should handle all priority levels', () => {
    const highOpts: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      priority: 'high',
    };
    const mediumOpts: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      priority: 'medium',
    };
    const lowOpts: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      priority: 'low',
    };

    expect(matchesFilters('Test A', 'high', highOpts)).toBe(true);
    expect(matchesFilters('Test B', 'medium', mediumOpts)).toBe(true);
    expect(matchesFilters('Test C', 'low', lowOpts)).toBe(true);

    expect(matchesFilters('Test A', 'medium', highOpts)).toBe(false);
    expect(matchesFilters('Test B', 'low', mediumOpts)).toBe(false);
    expect(matchesFilters('Test C', 'high', lowOpts)).toBe(false);
  });

  it('should handle empty test case names', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      testCase: '',
    };

    // Empty filter should match all
    expect(matchesFilters('Element CRUD', 'high', options)).toBe(true);
  });

  it('should support numeric test case names', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      testCase: '01',
    };

    expect(matchesFilters('01-motivation-layer', 'high', options)).toBe(true);
    expect(matchesFilters('02-business-layer', 'high', options)).toBe(false);
  });

  it('should handle special characters in test names', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      testCase: 'crud-operations',
    };

    expect(matchesFilters('element-crud-operations', 'high', options)).toBe(true);
    expect(matchesFilters('business-crud-operations', 'high', options)).toBe(true);
  });
});

describe('RunnerOptions Configuration', () => {
  it('should have default values', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
    };

    expect(options.reporter).toBe('console');
    expect(options.fastFail).toBe(false);
    expect(options.verbose).toBe(false);
    expect(options.priority).toBeUndefined();
    expect(options.testCase).toBeUndefined();
  });

  it('should support all reporter types', () => {
    const consoleOpts: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
    };
    const junitOpts: RunnerOptions = {
      reporter: 'junit',
      fastFail: false,
      verbose: false,
    };
    const jsonOpts: RunnerOptions = {
      reporter: 'json',
      fastFail: false,
      verbose: false,
    };

    expect(consoleOpts.reporter).toBe('console');
    expect(junitOpts.reporter).toBe('junit');
    expect(jsonOpts.reporter).toBe('json');
  });

  it('should support output file path', () => {
    const options: RunnerOptions = {
      reporter: 'junit',
      fastFail: false,
      verbose: false,
      outputFile: '/path/to/results.xml',
    };

    expect(options.outputFile).toBe('/path/to/results.xml');
  });

  it('should support concurrency setting', () => {
    const options: RunnerOptions = {
      reporter: 'console',
      fastFail: false,
      verbose: false,
      concurrency: 4,
    };

    expect(options.concurrency).toBe(4);
  });

  it('should support combining multiple options', () => {
    const options: RunnerOptions = {
      reporter: 'junit',
      fastFail: true,
      verbose: true,
      priority: 'high',
      testCase: 'element',
      outputFile: 'results/junit.xml',
      concurrency: 2,
    };

    expect(options.reporter).toBe('junit');
    expect(options.fastFail).toBe(true);
    expect(options.verbose).toBe(true);
    expect(options.priority).toBe('high');
    expect(options.testCase).toBe('element');
    expect(options.outputFile).toBe('results/junit.xml');
    expect(options.concurrency).toBe(2);
  });
});
