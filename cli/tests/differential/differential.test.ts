import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  type TestCase,
  executeTestCase,
  formatCommand,
  formatCommandResult
} from './runner';
import {
  compareOutputs,
  formatComparisonResult
} from './comparator';

/**
 * Load test cases from YAML file
 */
function loadTestCases(): TestCase[] {
  const yamlPath = join(__dirname, 'test-cases.yaml');
  const yamlContent = readFileSync(yamlPath, 'utf-8');
  const config = parseYaml(yamlContent) as { test_cases: TestCase[] };
  return config.test_cases || [];
}

/**
 * Run all differential tests
 */
describe('Differential Testing: Python CLI vs TypeScript CLI', () => {
  const testCases = loadTestCases();

  test('Test cases loaded successfully', () => {
    expect(testCases.length).toBeGreaterThan(0);
  });

  for (const testCase of testCases) {
    const testFn = testCase.skip ? test.skip : test;

    testFn(testCase.name, async () => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Test: ${testCase.name}`);
      if (testCase.description) {
        console.log(`Description: ${testCase.description}`);
      }
      console.log(`${'='.repeat(80)}\n`);

      // Execute both commands
      console.log('Executing commands...');
      console.log(`  Python:     ${formatCommand(testCase.python)}`);
      console.log(`  TypeScript: ${formatCommand(testCase.typescript)}`);

      const results = await executeTestCase(testCase);

      // Display execution results
      console.log('\n' + formatCommandResult(results.python, 'Python CLI'));
      console.log('\n' + formatCommandResult(results.typescript, 'TypeScript CLI'));

      // Compare outputs
      console.log('\nComparing outputs...');

      // Use stdout for comparison (most commands write results to stdout)
      const comparisonResult = compareOutputs(
        {
          stdout: results.python.stdout,
          stderr: results.python.stderr,
          exitCode: results.python.exitCode,
        },
        {
          stdout: results.typescript.stdout,
          stderr: results.typescript.stderr,
          exitCode: results.typescript.exitCode,
        },
        testCase.comparison
      );

      console.log('\n' + formatComparisonResult(comparisonResult));

      // Assert based on whether test is expected to fail
      if (testCase.expectedToFail) {
        // If we expect failure, just log the result
        console.log('\n⚠️  This test is expected to fail (known incompatibility)');
        // Don't fail the test suite
      } else {
        // For tests that should pass, assert they match
        if (!comparisonResult.matches) {
          console.error('\n❌ OUTPUTS DO NOT MATCH');
          if (comparisonResult.differences) {
            console.error('\nDifferences:');
            for (const diff of comparisonResult.differences) {
              console.error(`  ${diff}`);
            }
          }
        } else {
          console.log('\n✅ OUTPUTS MATCH');
        }

        expect(comparisonResult.matches).toBe(true);
      }
    }, 120000); // 2 minute timeout for each test
  }
});

/**
 * Generate summary report
 */
describe('Differential Testing Summary', () => {
  test('Generate compatibility report', async () => {
    const testCases = loadTestCases();

    console.log('\n' + '='.repeat(80));
    console.log('DIFFERENTIAL TESTING SUMMARY');
    console.log('='.repeat(80) + '\n');

    const total = testCases.length;
    const skipped = testCases.filter(tc => tc.skip).length;
    const expectedToFail = testCases.filter(tc => tc.expectedToFail && !tc.skip).length;
    const runnable = total - skipped;

    console.log(`Total test cases: ${total}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Expected to fail: ${expectedToFail}`);
    console.log(`Will run: ${runnable}`);

    console.log('\nTest cases by category:');

    const categories = new Map<string, TestCase[]>();
    for (const tc of testCases) {
      const category = tc.name.split(' - ')[0].split(':')[0];
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(tc);
    }

    for (const [category, cases] of categories) {
      console.log(`\n  ${category}:`);
      for (const tc of cases) {
        const status = tc.skip
          ? '⊘ SKIP'
          : tc.expectedToFail
            ? '⚠ EXPECT FAIL'
            : '○ RUN';
        console.log(`    ${status} ${tc.name}`);
      }
    }

    console.log('\n' + '='.repeat(80) + '\n');
  });
});
