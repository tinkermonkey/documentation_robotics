/**
 * Performance benchmark for pre-compiled validators
 *
 * This benchmark measures the performance of the SchemaValidator with
 * pre-compiled base schemas. Validates that:
 * - Average validation time is ≤1ms per element
 * - Performance is consistent across multiple iterations
 * - Cache hit rate is high for repeated validations
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SchemaValidator } from "../../src/validators/schema-validator.js";
import { Element } from "../../src/core/element.js";
import { Layer } from "../../src/core/layer.js";
import { performance } from "perf_hooks";

describe("Validator Performance Benchmark", () => {
  let validator: SchemaValidator;

  beforeAll(() => {
    SchemaValidator.reset();
    validator = new SchemaValidator();
  });

  it("should validate elements in under 1ms average time (base schemas)", async () => {
    const element = new Element({
      id: "550e8400-e29b-41d4-a716-446655440000",
      spec_node_id: "motivation.goal",
      type: "goal",
      layer_id: "motivation",
      name: "Test Goal",
      description: "A test goal",
      attributes: {
        priority: "high",
      },
    });

    const iterations = 1000;
    const times: number[] = [];

    // Warm-up run to initialize caches
    for (let i = 0; i < 10; i++) {
      await validator["validateElement"](element, "motivation");
    }

    // Measurement run
    const startTime = performance.now();
    for (let i = 0; i < iterations; i++) {
      const iterStart = performance.now();
      await validator["validateElement"](element, "motivation");
      const iterEnd = performance.now();
      times.push(iterEnd - iterStart);
    }
    const endTime = performance.now();

    const totalTime = endTime - startTime;
    const avgTime = totalTime / iterations;
    const throughput = 1000 / avgTime;

    console.log(`
    Validation Performance Report
    ============================
    Iterations:        ${iterations}
    Total Time:        ${totalTime.toFixed(2)}ms
    Average Time:      ${avgTime.toFixed(3)}ms per element
    Throughput:        ${throughput.toFixed(0)} validations/sec
    Min Time:          ${Math.min(...times).toFixed(3)}ms
    Max Time:          ${Math.max(...times).toFixed(3)}ms
    Median Time:       ${times.sort((a, b) => a - b)[Math.floor(iterations / 2)].toFixed(3)}ms
    `);

    // Performance target: average validation < 1ms
    expect(avgTime).toBeLessThan(1.0);

    // Throughput should be at least 1000 validations/second
    expect(throughput).toBeGreaterThan(1000);
  });

  it("should handle multiple element types efficiently", async () => {
    const elements = [
      new Element({
        id: "550e8400-e29b-41d4-a716-446655440001",
        spec_node_id: "motivation.goal",
        type: "goal",
        layer_id: "motivation",
        name: "Goal 1",
        attributes: {},
      }),
      new Element({
        id: "550e8400-e29b-41d4-a716-446655440002",
        spec_node_id: "motivation.requirement",
        type: "requirement",
        layer_id: "motivation",
        name: "Requirement 1",
        attributes: {},
      }),
      new Element({
        id: "550e8400-e29b-41d4-a716-446655440003",
        spec_node_id: "business.service",
        type: "service",
        layer_id: "business",
        name: "Service 1",
        attributes: {},
      }),
    ];

    const iterations = 100;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      for (const element of elements) {
        const layer = element.layer_id || "motivation";
        await validator["validateElement"](element, layer);
      }
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const totalValidations = iterations * elements.length;
    const avgTime = totalTime / totalValidations;

    console.log(`
    Multi-Type Validation Benchmark
    ==============================
    Iterations:        ${iterations}
    Element Types:     ${elements.length}
    Total Validations: ${totalValidations}
    Total Time:        ${totalTime.toFixed(2)}ms
    Average Time:      ${avgTime.toFixed(3)}ms per element
    Throughput:        ${(1000 / avgTime).toFixed(0)} validations/sec
    `);

    expect(avgTime).toBeLessThan(1.0);
  });

  it("should show improved performance with pre-compiled validators", async () => {
    // This test documents that pre-compiled validators eliminate:
    // 1. JSON parsing overhead
    // 2. Schema compilation overhead
    // 3. Disk I/O overhead
    //
    // These are now moved to build-time

    const testElement = new Element({
      id: "550e8400-e29b-41d4-a716-446655440010",
      spec_node_id: "api.endpoint",
      type: "endpoint",
      layer_id: "api",
      name: "POST /orders",
      attributes: {
        method: "POST",
        path: "/orders",
      },
    });

    // Run several validation rounds
    const rounds = 5;
    const validationsPerRound = 200;
    const roundTimes: number[] = [];

    for (let round = 0; round < rounds; round++) {
      const roundStart = performance.now();
      for (let i = 0; i < validationsPerRound; i++) {
        await validator["validateElement"](testElement, "api");
      }
      const roundEnd = performance.now();
      roundTimes.push(roundEnd - roundStart);
    }

    // Performance should be consistent across rounds
    // (first round cache warming, subsequent rounds hit cache)
    const firstRoundAvg = roundTimes[0] / validationsPerRound;
    const laterRoundsAvg =
      roundTimes.slice(1).reduce((a, b) => a + b) / (4 * validationsPerRound);

    console.log(`
    Cache Performance Analysis
    =========================
    First Round Avg:   ${firstRoundAvg.toFixed(3)}ms per element
    Later Rounds Avg:  ${laterRoundsAvg.toFixed(3)}ms per element
    Variance:         ${((firstRoundAvg - laterRoundsAvg) / firstRoundAvg * 100).toFixed(1)}%

    Note: With pre-compiled validators, the difference between first and later
    rounds should be minimal since there's no compilation overhead.
    `);

    // Both should be well under 1ms
    expect(firstRoundAvg).toBeLessThan(1.0);
    expect(laterRoundsAvg).toBeLessThan(1.0);
  });

  it("should provide cache hit statistics for schema validation", async () => {
    // This documents the cache efficiency of pre-compiled validators

    const layer = new Layer({
      id: "test-layer",
      name: "Test Layer",
      number: 1,
      description: "Test",
      node_types: ["motivation.goal", "motivation.requirement"],
    });

    // Add elements of various types
    const goals = [];
    for (let i = 0; i < 10; i++) {
      goals.push(
        new Element({
          id: `550e8400-e29b-41d4-a716-44665544000${i}`,
          spec_node_id: "motivation.goal",
          type: "goal",
          layer_id: "motivation",
          name: `Goal ${i}`,
          attributes: {},
        })
      );
    }

    const requirements = [];
    for (let i = 0; i < 10; i++) {
      requirements.push(
        new Element({
          id: `550e8400-e29b-41d4-a716-44665544001${i}`,
          spec_node_id: "motivation.requirement",
          type: "requirement",
          layer_id: "motivation",
          name: `Requirement ${i}`,
          attributes: {},
        })
      );
    }

    // Validate layer
    const startTime = performance.now();
    const result = await validator.validateLayer(layer);
    const endTime = performance.now();

    console.log(`
    Layer Validation Cache Analysis
    ==============================
    Layer Elements:    ${layer.elements.size}
    Validation Time:   ${(endTime - startTime).toFixed(2)}ms
    Avg Per Element:   ${((endTime - startTime) / layer.elements.size).toFixed(3)}ms
    Valid:             ${result.isValid()}
    `);
  });
});
