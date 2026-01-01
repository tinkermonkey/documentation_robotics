#!/usr/bin/env node

/**
 * Validate coverage threshold for CI
 * Ensures minimum 80% coverage across lines, functions, branches, and statements
 *
 * This script reads the coverage summary and enforces thresholds.
 * Exit code 0 if coverage meets threshold, 1 otherwise.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const COVERAGE_THRESHOLD = 80;
const COVERAGE_SUMMARY_PATH = join(process.cwd(), 'coverage', 'coverage-summary.json');

try {
  const summaryData = readFileSync(COVERAGE_SUMMARY_PATH, 'utf-8');
  const coverage = JSON.parse(summaryData);

  // Get the total coverage stats (last entry in coverage-summary.json)
  const total = coverage.total;

  if (!total) {
    console.error('❌ Error: Could not find coverage summary. Run tests with --coverage first.');
    process.exit(1);
  }

  const metrics = {
    lines: Math.round(total.lines.pct),
    functions: Math.round(total.functions.pct),
    branches: Math.round(total.branches.pct),
    statements: Math.round(total.statements.pct),
  };

  console.log('\n📊 Coverage Summary:');
  console.log(`  Lines:       ${metrics.lines}% (threshold: ${COVERAGE_THRESHOLD}%)`);
  console.log(`  Functions:   ${metrics.functions}% (threshold: ${COVERAGE_THRESHOLD}%)`);
  console.log(`  Branches:    ${metrics.branches}% (threshold: ${COVERAGE_THRESHOLD}%)`);
  console.log(`  Statements:  ${metrics.statements}% (threshold: ${COVERAGE_THRESHOLD}%)`);
  console.log('');

  const failed = Object.entries(metrics).filter(([_, pct]) => pct < COVERAGE_THRESHOLD);

  if (failed.length > 0) {
    console.error(`❌ Coverage threshold not met (${COVERAGE_THRESHOLD}% minimum):`);
    for (const [metric, pct] of failed) {
      console.error(`   ✗ ${metric}: ${pct}%`);
    }
    console.error('');
    process.exit(1);
  } else {
    console.log(`✅ All coverage metrics meet ${COVERAGE_THRESHOLD}% threshold\n`);
    process.exit(0);
  }
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('❌ Error: coverage-summary.json not found.');
    console.error('   Run: bun test --coverage before running this script');
    process.exit(1);
  }
  console.error('❌ Error reading coverage summary:', error.message);
  process.exit(1);
}
