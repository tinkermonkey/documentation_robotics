/**
 * Phase 4: Test Execution Metrics and Reporting
 *
 * This module collects and reports test execution metrics to identify
 * performance bottlenecks and optimize test execution in parallel environments.
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface TestMetrics {
  testId: string;
  workerId: string;
  testFile: string;
  testName: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number; // milliseconds
  startTime: number;
  endTime: number;
  category?: string;
  error?: string;
}

export interface AggregatedMetrics {
  workerId: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDuration: number;
  averageDuration: number;
  slowestTests: TestMetrics[];
  fastestTests: TestMetrics[];
  timestamp: string;
}

class MetricsCollector {
  private metrics: TestMetrics[] = [];
  private workerId: string;
  private metricsDir: string;

  constructor(workerId?: string) {
    this.workerId = workerId || process.env.TEST_WORKER_ID || 'unknown';
    this.metricsDir = process.env.TEST_METRICS_DIR || './coverage/metrics';
  }

  /**
   * Record a test execution
   */
  recordTest(metric: Omit<TestMetrics, 'workerId'>): void {
    this.metrics.push({
      ...metric,
      workerId: this.workerId,
    });
  }

  /**
   * Get aggregated metrics
   */
  getAggregated(): AggregatedMetrics {
    const totalTests = this.metrics.length;
    const passedTests = this.metrics.filter((m) => m.status === 'pass').length;
    const failedTests = this.metrics.filter((m) => m.status === 'fail').length;
    const skippedTests = this.metrics.filter((m) => m.status === 'skip').length;
    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const averageDuration = totalTests > 0 ? totalDuration / totalTests : 0;

    const sorted = [...this.metrics].sort((a, b) => b.duration - a.duration);
    const slowestTests = sorted.slice(0, 10);
    const fastestTests = sorted.slice(-10).reverse();

    return {
      workerId: this.workerId,
      totalTests,
      passedTests,
      failedTests,
      skippedTests,
      totalDuration,
      averageDuration,
      slowestTests,
      fastestTests,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Save metrics to file
   */
  async saveMetrics(): Promise<void> {
    try {
      await fs.mkdir(this.metricsDir, { recursive: true });
      const metricsFile = path.join(
        this.metricsDir,
        `metrics-${this.workerId}-${Date.now()}.json`
      );
      await fs.writeFile(metricsFile, JSON.stringify(this.getAggregated(), null, 2));
      console.log(`Metrics saved to ${metricsFile}`);
    } catch (error) {
      console.error('Failed to save metrics:', error);
    }
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const agg = this.getAggregated();
    const lines: string[] = [
      '='.repeat(70),
      `Test Execution Report - Worker: ${this.workerId}`,
      `Timestamp: ${agg.timestamp}`,
      '='.repeat(70),
      '',
      'Summary:',
      `  Total Tests: ${agg.totalTests}`,
      `  Passed: ${agg.passedTests}`,
      `  Failed: ${agg.failedTests}`,
      `  Skipped: ${agg.skippedTests}`,
      '',
      'Performance:',
      `  Total Duration: ${(agg.totalDuration / 1000).toFixed(2)}s`,
      `  Average Duration: ${agg.averageDuration.toFixed(0)}ms`,
      '',
    ];

    if (agg.slowestTests.length > 0) {
      lines.push('Top 10 Slowest Tests:');
      agg.slowestTests.forEach((test, i) => {
        lines.push(
          `  ${i + 1}. ${test.testName} (${test.duration}ms) [${test.testFile}]`
        );
      });
      lines.push('');
    }

    if (agg.failedTests > 0) {
      lines.push('Failed Tests:');
      this.metrics
        .filter((m) => m.status === 'fail')
        .forEach((test) => {
          lines.push(`  ✗ ${test.testName} [${test.testFile}]`);
          if (test.error) {
            lines.push(`    Error: ${test.error}`);
          }
        });
      lines.push('');
    }

    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Print report to console
   */
  printReport(): void {
    console.log(this.generateReport());
  }

  /**
   * Get metrics for a specific test file
   */
  getFileMetrics(testFile: string): TestMetrics[] {
    return this.metrics.filter((m) => m.testFile === testFile);
  }

  /**
   * Get metrics by status
   */
  getMetricsByStatus(status: 'pass' | 'fail' | 'skip'): TestMetrics[] {
    return this.metrics.filter((m) => m.status === status);
  }

  /**
   * Identify slow tests for optimization
   */
  getSlowTests(threshold: number = 1000): TestMetrics[] {
    return this.metrics.filter((m) => m.duration > threshold);
  }
}

// Singleton instance
let instance: MetricsCollector | null = null;

/**
 * Get or create metrics collector singleton
 */
export function getMetricsCollector(): MetricsCollector {
  if (!instance) {
    instance = new MetricsCollector();
  }
  return instance;
}

/**
 * Record test metric
 */
export function recordTest(metric: Omit<TestMetrics, 'workerId'>): void {
  getMetricsCollector().recordTest(metric);
}

/**
 * Save metrics on process exit
 */
export function setupMetricsPersistence(): void {
  process.on('exit', async () => {
    try {
      await getMetricsCollector().saveMetrics();
      getMetricsCollector().printReport();
    } catch (error) {
      console.error('Failed to persist metrics:', error);
    }
  });
}

export default MetricsCollector;
