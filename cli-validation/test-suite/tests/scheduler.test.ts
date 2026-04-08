/**
 * Scheduler Tests
 *
 * Tests for test suite scheduling and distribution across workers
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { scheduleSuites } from '../scheduler.js';
import { TestSuite } from '../pipeline.js';

/**
 * Create a test suite with specified number of pipelines and steps per pipeline
 */
function createTestSuite(
  name: string,
  priority: 'high' | 'medium' | 'low',
  pipelineCount: number,
  stepsPerPipeline: number
): TestSuite {
  const pipelines = Array.from({ length: pipelineCount }, (_, i) => ({
    name: `pipeline-${i + 1}`,
    steps: Array.from({ length: stepsPerPipeline }, (_, j) => ({
      command: `command-${j + 1}`,
      files_to_compare: [],
    })),
  }));

  return {
    name,
    description: `Test suite ${name}`,
    priority,
    pipelines,
  };
}

describe('Scheduler', () => {
  it('should distribute suites round-robin across workers', () => {
    const suites = [
      createTestSuite('suite-1', 'high', 1, 1), // 1 step
      createTestSuite('suite-2', 'medium', 1, 2), // 2 steps
      createTestSuite('suite-3', 'low', 1, 3), // 3 steps
      createTestSuite('suite-4', 'high', 1, 4), // 4 steps
    ];

    const schedule = scheduleSuites(suites, 2);

    // Check that we have 2 workers
    assert.equal(schedule.size, 2);

    // Check that all suites are assigned
    let totalAssigned = 0;
    for (const [, assignedSuites] of schedule) {
      totalAssigned += assignedSuites.length;
    }
    assert.equal(totalAssigned, 4);
  });

  it('should sort suites by step count descending before round-robin', () => {
    const suites = [
      createTestSuite('suite-1', 'high', 1, 1), // 1 step
      createTestSuite('suite-2', 'medium', 1, 2), // 2 steps
      createTestSuite('suite-3', 'low', 1, 3), // 3 steps
    ];

    const schedule = scheduleSuites(suites, 2);

    // Worker 0 should get suite-3 (3 steps) first, then suite-1 (1 step)
    const worker0 = schedule.get(0) || [];
    const worker1 = schedule.get(1) || [];

    // After sorting by step count (desc): suite-3 (3), suite-2 (2), suite-1 (1)
    // Round-robin: worker-0 gets suite-3, worker-1 gets suite-2, worker-0 gets suite-1
    assert.equal(worker0.length, 2);
    assert.equal(worker1.length, 1);

    // Verify first suite in worker0 is suite-3 (highest step count)
    assert.equal(worker0[0].name, 'suite-3');
    assert.equal(worker0[1].name, 'suite-1');

    // Verify suite in worker1 is suite-2
    assert.equal(worker1[0].name, 'suite-2');
  });

  it('should balance load when distributing suites', () => {
    const suites = [
      createTestSuite('suite-1', 'high', 1, 10), // 10 steps
      createTestSuite('suite-2', 'medium', 1, 9), // 9 steps
      createTestSuite('suite-3', 'low', 1, 8), // 8 steps
      createTestSuite('suite-4', 'high', 1, 7), // 7 steps
    ];

    const schedule = scheduleSuites(suites, 2);

    const worker0 = schedule.get(0) || [];
    const worker1 = schedule.get(1) || [];

    // Calculate total steps per worker
    const worker0Steps = worker0.reduce((sum, suite) => {
      return sum + suite.pipelines.reduce((s, p) => s + p.steps.length, 0);
    }, 0);

    const worker1Steps = worker1.reduce((sum, suite) => {
      return sum + suite.pipelines.reduce((s, p) => s + p.steps.length, 0);
    }, 0);

    // After sorting: [10, 9, 8, 7] -> round-robin gives:
    // worker0: 10 + 8 = 18
    // worker1: 9 + 7 = 16
    assert.equal(worker0Steps, 18);
    assert.equal(worker1Steps, 16);
  });

  it('should handle single worker', () => {
    const suites = [
      createTestSuite('suite-1', 'high', 1, 1),
      createTestSuite('suite-2', 'medium', 1, 2),
    ];

    const schedule = scheduleSuites(suites, 1);

    // All suites should be assigned to worker 0
    assert.equal(schedule.get(0)?.length, 2);
  });

  it('should handle empty suite list', () => {
    const suites: TestSuite[] = [];

    const schedule = scheduleSuites(suites, 2);

    // Both workers should exist but be empty
    assert.equal(schedule.get(0)?.length, 0);
    assert.equal(schedule.get(1)?.length, 0);
  });

  it('should throw on invalid worker count', () => {
    const suites = [createTestSuite('suite-1', 'high', 1, 1)];

    assert.throws(
      () => scheduleSuites(suites, 0),
      /Worker count must be at least 1/
    );
  });

  it('should handle more workers than suites', () => {
    const suites = [
      createTestSuite('suite-1', 'high', 1, 1),
      createTestSuite('suite-2', 'medium', 1, 2),
    ];

    const schedule = scheduleSuites(suites, 5);

    // Only 2 workers should have suites
    let workersWithSuites = 0;
    for (let i = 0; i < 5; i++) {
      if ((schedule.get(i) || []).length > 0) {
        workersWithSuites++;
      }
    }
    assert.equal(workersWithSuites, 2);
  });
});
