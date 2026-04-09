/**
 * Test Suite Scheduler
 *
 * Distributes test suites across workers based on estimated cost.
 * Sorts suites by total step count (descending) and assigns round-robin to workers.
 */

import { TestSuite } from './pipeline.js';

/**
 * Calculate total step count for a test suite
 * Used to estimate execution cost
 */
function calculateStepCount(suite: TestSuite): number {
  return suite.pipelines.reduce((total, pipeline) => total + pipeline.steps.length, 0);
}

/**
 * Schedule test suites across workers
 * Sorts suites by step count (descending) and distributes round-robin
 *
 * @param suites - Array of filtered test suites
 * @param workerCount - Number of workers to distribute across
 * @returns Map where key is workerId (0-based) and value is array of assigned suites
 */
export function scheduleSuites(
  suites: TestSuite[],
  workerCount: number
): Map<number, TestSuite[]> {
  if (workerCount < 1) {
    throw new Error('Worker count must be at least 1');
  }

  // Initialize result map for each worker
  const scheduledSuites = new Map<number, TestSuite[]>();
  for (let i = 0; i < workerCount; i++) {
    scheduledSuites.set(i, []);
  }

  // If no suites, return empty schedule
  if (suites.length === 0) {
    return scheduledSuites;
  }

  // Sort suites by step count (descending) for better load balancing
  const sortedSuites = [...suites].sort(
    (a, b) => calculateStepCount(b) - calculateStepCount(a)
  );

  // Assign round-robin to workers
  for (let i = 0; i < sortedSuites.length; i++) {
    const workerId = i % workerCount;
    const workerSuites = scheduledSuites.get(workerId);
    if (workerSuites) {
      workerSuites.push(sortedSuites[i]);
    }
  }

  return scheduledSuites;
}
