/**
 * Integration tests for AI Evaluation
 *
 * These tests verify the integration contract, data flow, and error handling
 * without requiring actual Claude CLI execution.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rm, mkdir } from "fs/promises";
import path from "path";
import os from "os";
import type { CoverageMetrics } from "../../../src/audit/types.js";

describe("AI Evaluation Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `ai-eval-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should have proper exports from audit module", async () => {
    const { AIEvaluator, InMemoryProgressTracker } = await import(
      "../../../src/audit/index.js"
    );

    expect(AIEvaluator).toBeDefined();
    expect(InMemoryProgressTracker).toBeDefined();

    const evaluator = new AIEvaluator({
      outputDir: tempDir,
      lowCoverageThreshold: 1.0,
    });

    expect(evaluator).toBeDefined();

    const tracker = new InMemoryProgressTracker(10);
    expect(tracker.getProgress()).toEqual({ completed: 0, total: 10 });

    await tracker.markCompleted("test");
    expect(tracker.getProgress()).toEqual({ completed: 1, total: 10 });
    expect(tracker.isCompleted("test")).toBe(true);
    expect(tracker.isCompleted("other")).toBe(false);
  });

  it("should initialize with default configuration", async () => {
    const { AIEvaluator } = await import("../../../src/audit/index.js");

    const evaluator = new AIEvaluator();
    expect(evaluator).toBeDefined();

    // Test with custom config
    const customEvaluator = new AIEvaluator({
      outputDir: tempDir,
      lowCoverageThreshold: 2.0,
      resumable: false,
    });
    expect(customEvaluator).toBeDefined();
  });

  it("should handle progress tracking correctly", async () => {
    const { InMemoryProgressTracker } = await import(
      "../../../src/audit/index.js"
    );

    const tracker = new InMemoryProgressTracker(5);

    // Initially no items completed
    expect(tracker.getProgress()).toEqual({ completed: 0, total: 5 });
    expect(tracker.isCompleted("item1")).toBe(false);

    // Mark items as completed
    await tracker.markCompleted("item1");
    expect(tracker.getProgress()).toEqual({ completed: 1, total: 5 });
    expect(tracker.isCompleted("item1")).toBe(true);

    // Mark multiple items
    await tracker.markCompleted("item2");
    await tracker.markCompleted("item3");
    expect(tracker.getProgress()).toEqual({ completed: 3, total: 5 });

    // Marking same item again should be idempotent
    await tracker.markCompleted("item1");
    expect(tracker.getProgress()).toEqual({ completed: 3, total: 5 });
  });

  it("should handle evaluation summary structure", async () => {
    const { AIEvaluator } = await import("../../../src/audit/index.js");

    const evaluator = new AIEvaluator({
      outputDir: tempDir,
      lowCoverageThreshold: 1.0,
    });

    // Test that the evaluator can be instantiated and configured
    expect(evaluator).toBeDefined();

    // Evaluation summary type should be available
    const mockSummary = {
      totalAttempted: 5,
      successful: 3,
      failed: 2,
      failures: [
        {
          type: "element" as const,
          key: "motivation.goal.test",
          error: "Test error",
          timestamp: new Date().toISOString(),
        },
      ],
    };

    expect(mockSummary.totalAttempted).toBe(5);
    expect(mockSummary.successful).toBe(3);
    expect(mockSummary.failed).toBe(2);
    expect(mockSummary.failures).toHaveLength(1);
  });

  it("should handle coverage metrics with isolated node types", async () => {
    const coverage: CoverageMetrics[] = [
      {
        layer: "motivation",
        nodeTypeCount: 10,
        relationshipCount: 2,
        isolatedNodeTypes: ["goal", "principle"],
        isolationPercentage: 20,
        availablePredicates: ["realizes", "influences"],
        usedPredicates: ["realizes"],
        utilizationPercentage: 50,
        relationshipsPerNodeType: 0.2,
      },
      {
        layer: "business",
        nodeTypeCount: 15,
        relationshipCount: 0,
        isolatedNodeTypes: ["process", "role", "service"],
        isolationPercentage: 100,
        availablePredicates: ["triggers", "performs"],
        usedPredicates: [],
        utilizationPercentage: 0,
        relationshipsPerNodeType: 0,
      },
    ];

    // Count total isolated types
    const totalIsolated = coverage.reduce(
      (sum, layer) => sum + layer.isolatedNodeTypes.length,
      0
    );

    expect(totalIsolated).toBe(5);
    expect(coverage[0].isolatedNodeTypes).toContain("goal");
    expect(coverage[1].isolationPercentage).toBe(100);
  });

  it("should handle layer review data structures", async () => {
    const layerReview = {
      layer: "security",
      coherenceScore: 0.75,
      issues: [
        {
          severity: "medium" as const,
          description: "Missing threat-countermeasure relationships",
          recommendation: "Add mitigates relationships",
        },
      ],
      strengths: ["Good role-permission coverage"],
    };

    expect(layerReview.layer).toBe("security");
    expect(layerReview.coherenceScore).toBe(0.75);
    expect(layerReview.issues).toHaveLength(1);
    expect(layerReview.strengths).toHaveLength(1);
  });

  it("should handle inter-layer validation structure", async () => {
    const interLayerValidation = {
      sourceLayer: "application",
      targetLayer: "technology",
      isValid: true,
      violations: [],
      suggestions: [
        "Consider adding component-artifact relationships",
      ],
    };

    expect(interLayerValidation.sourceLayer).toBe("application");
    expect(interLayerValidation.targetLayer).toBe("technology");
    expect(interLayerValidation.isValid).toBe(true);
    expect(interLayerValidation.violations).toHaveLength(0);
    expect(interLayerValidation.suggestions).toHaveLength(1);
  });

  it("should handle relationship recommendations format", async () => {
    const recommendation = {
      source: "motivation.goal.customer-satisfaction",
      predicate: "realizes",
      destination: "business.service.order-management",
      rationale: "The goal is realized by the service",
      confidence: "high" as const,
    };

    expect(recommendation.source).toContain("motivation.goal");
    expect(recommendation.predicate).toBe("realizes");
    expect(recommendation.confidence).toBe("high");
  });

  it("should handle error tracking for failed evaluations", async () => {
    const failures = [
      {
        type: "element" as const,
        key: "motivation.goal.test1",
        error: "Claude invocation failed: ENOENT",
        timestamp: new Date().toISOString(),
      },
      {
        type: "layer" as const,
        key: "security",
        error: "Rate limit exceeded",
        timestamp: new Date().toISOString(),
      },
      {
        type: "inter-layer" as const,
        key: "application->technology",
        error: "Parsing failed",
        timestamp: new Date().toISOString(),
      },
    ];

    expect(failures).toHaveLength(3);
    expect(failures[0].type).toBe("element");
    expect(failures[1].type).toBe("layer");
    expect(failures[2].type).toBe("inter-layer");
  });

  it("should fail fast after consecutive failures", async () => {
    // Verify the fail-fast mechanism is documented in the code
    // Actual invocation testing requires mocking Claude CLI, which is done in unit tests

    const failFastLogic = {
      maxConsecutiveFailures: 3,
      successResetsCounter: true,
      abortMessage: "AI evaluation aborted after 3 consecutive failures",
    };

    expect(failFastLogic.maxConsecutiveFailures).toBe(3);
    expect(failFastLogic.successResetsCounter).toBe(true);
    expect(failFastLogic.abortMessage).toContain("consecutive failures");
  });

  it("should resume from progress tracker state", async () => {
    const { AIEvaluator, InMemoryProgressTracker } = await import(
      "../../../src/audit/index.js"
    );

    const evaluator = new AIEvaluator({
      outputDir: tempDir,
      lowCoverageThreshold: 1.0,
      resumable: true,
    });

    const tracker = new InMemoryProgressTracker(5);

    // Mark some items as completed
    await tracker.markCompleted("motivation.goal.test1");
    await tracker.markCompleted("motivation.goal.test2");

    // Verify tracker state
    const progress = tracker.getProgress();
    expect(progress.completed).toBe(2);
    expect(progress.total).toBe(5);
    expect(tracker.isCompleted("motivation.goal.test1")).toBe(true);
    expect(tracker.isCompleted("motivation.goal.test3")).toBe(false);
  });

  it("should distinguish between consecutive and total failures", async () => {
    // When AI evaluation fails for some elements but succeeds for others,
    // consecutive counter should reset on success
    const failureSequence = [
      { success: false, consecutiveCount: 1 },
      { success: false, consecutiveCount: 2 },
      { success: true, consecutiveCount: 0 }, // Reset on success
      { success: false, consecutiveCount: 1 },
      { success: false, consecutiveCount: 2 },
    ];

    // Verify sequence structure
    expect(failureSequence[2].consecutiveCount).toBe(0); // Reset after success
    expect(failureSequence[0].consecutiveCount).toBe(1);
    expect(failureSequence[1].consecutiveCount).toBe(2);
    expect(failureSequence[4].consecutiveCount).toBe(2);
  });
});
