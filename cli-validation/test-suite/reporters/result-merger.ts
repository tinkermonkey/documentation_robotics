import { SuiteResult } from '../pipeline.js';

/**
 * @param workerResults - Array of SuiteResult arrays from each worker
 * @returns Merged array of all SuiteResults from all workers
 */
export function mergeResults(workerResults: SuiteResult[][]): SuiteResult[] {
  return workerResults.flat();
}
