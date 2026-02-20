/**
 * Integration tests for audit differential features:
 * - Snapshot storage and management
 * - Differential analysis
 * - Before/after comparison
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SnapshotStorage } from "../../src/audit/snapshot-storage.js";
import { DifferentialAnalyzer } from "../../src/audit/differential-analyzer.js";
import { AuditReport, CoverageMetrics, GapCandidate, DuplicateCandidate, BalanceAssessment } from "../../src/audit/types.js";
import { createTestWorkdir } from "../helpers/golden-copy.js";
import * as path from "path";
import { promises as fs } from "fs";

describe("Snapshot Storage", () => {
  let workdir: Awaited<ReturnType<typeof createTestWorkdir>>;
  let storage: SnapshotStorage;

  beforeEach(async () => {
    workdir = await createTestWorkdir();
    storage = new SnapshotStorage({
      storageDir: path.join(workdir.path, ".dr", "audit-snapshots"),
    });
  });

  afterEach(async () => {
    await workdir.cleanup();
  });

  it("should save a snapshot successfully", async () => {
    const report = createMockAuditReport();
    const metadata = await storage.save(report);

    expect(metadata.id).toMatch(/^\d{8}-\d{6}$/);
    expect(metadata.timestamp).toBe(report.timestamp);
    expect(metadata.modelName).toBe(report.model.name);
    expect(metadata.modelVersion).toBe(report.model.version);
    expect(metadata.layers).toEqual(["motivation", "business"]);
  });

  it("should load a saved snapshot", async () => {
    const report = createMockAuditReport();
    const metadata = await storage.save(report);

    const loaded = await storage.load(metadata.id);

    expect(loaded.timestamp).toBe(report.timestamp);
    expect(loaded.model.name).toBe(report.model.name);
    expect(loaded.coverage).toHaveLength(2);
  });

  it("should list all snapshots sorted by timestamp (newest first)", async () => {
    const report1 = createMockAuditReport("2026-02-20T10:00:00.000Z");
    const report2 = createMockAuditReport("2026-02-20T15:00:00.000Z");
    const report3 = createMockAuditReport("2026-02-20T20:00:00.000Z");

    await storage.save(report1);
    await storage.save(report2);
    await storage.save(report3);

    const snapshots = await storage.list();

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].timestamp).toBe("2026-02-20T20:00:00.000Z");
    expect(snapshots[1].timestamp).toBe("2026-02-20T15:00:00.000Z");
    expect(snapshots[2].timestamp).toBe("2026-02-20T10:00:00.000Z");
  });

  it("should delete a snapshot", async () => {
    const report = createMockAuditReport();
    const metadata = await storage.save(report);

    await storage.delete(metadata.id);

    const snapshots = await storage.list();
    expect(snapshots).toHaveLength(0);
  });

  it("should clear all snapshots", async () => {
    await storage.save(createMockAuditReport("2026-02-20T10:00:00.000Z"));
    await storage.save(createMockAuditReport("2026-02-20T15:00:00.000Z"));

    await storage.clear();

    const snapshots = await storage.list();
    expect(snapshots).toHaveLength(0);
  });

  it("should get the latest snapshot", async () => {
    const report1 = createMockAuditReport("2026-02-20T10:00:00.000Z");
    const report2 = createMockAuditReport("2026-02-20T15:00:00.000Z");

    await storage.save(report1);
    await storage.save(report2);

    const latest = await storage.getLatest();

    expect(latest).not.toBeNull();
    expect(latest?.timestamp).toBe("2026-02-20T15:00:00.000Z");
  });

  it("should get the latest pair for comparison", async () => {
    const report1 = createMockAuditReport("2026-02-20T10:00:00.000Z");
    const report2 = createMockAuditReport("2026-02-20T15:00:00.000Z");

    await storage.save(report1);
    await storage.save(report2);

    const [before, after] = await storage.getLatestPair();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(before?.timestamp).toBe("2026-02-20T10:00:00.000Z");
    expect(after?.timestamp).toBe("2026-02-20T15:00:00.000Z");
  });

  it("should return null pair when insufficient snapshots", async () => {
    const report = createMockAuditReport();
    await storage.save(report);

    const [before, after] = await storage.getLatestPair();

    expect(before).toBeNull();
    expect(after).toBeNull();
  });

  it("should respect max snapshots limit", async () => {
    const limitedStorage = new SnapshotStorage({
      storageDir: path.join(workdir.path, ".dr", "audit-snapshots-limited"),
      maxSnapshots: 2,
    });

    await limitedStorage.save(createMockAuditReport("2026-02-20T10:00:00.000Z"));
    await limitedStorage.save(createMockAuditReport("2026-02-20T15:00:00.000Z"));
    await limitedStorage.save(createMockAuditReport("2026-02-20T20:00:00.000Z"));

    const snapshots = await limitedStorage.list();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].timestamp).toBe("2026-02-20T20:00:00.000Z");
    expect(snapshots[1].timestamp).toBe("2026-02-20T15:00:00.000Z");
  });
});

describe("Differential Analysis", () => {
  let analyzer: DifferentialAnalyzer;

  beforeEach(() => {
    analyzer = new DifferentialAnalyzer();
  });

  it("should calculate coverage deltas correctly", () => {
    const before = createMockAuditReport("2026-02-20T10:00:00.000Z", {
      isolationPercentage: 20,
      density: 1.5,
    });

    const after = createMockAuditReport("2026-02-20T15:00:00.000Z", {
      isolationPercentage: 10,
      density: 2.5,
    });

    const analysis = analyzer.analyze(before, after);

    expect(analysis.summary.coverageChanges).toHaveLength(2);

    const motivationChange = analysis.summary.coverageChanges.find(
      (c) => c.layer === "motivation"
    );

    expect(motivationChange).toBeDefined();
    expect(motivationChange?.delta.isolation).toBe(-10);
    expect(motivationChange?.delta.density).toBe(1);
  });

  it("should identify resolved gaps", () => {
    const gap: GapCandidate = {
      sourceNodeType: "Goal",
      destinationNodeType: "Requirement",
      suggestedPredicate: "realizes",
      reason: "Goals should realize requirements",
      priority: "high",
    };

    const before = createMockAuditReport("2026-02-20T10:00:00.000Z", {}, [gap]);
    const after = createMockAuditReport("2026-02-20T15:00:00.000Z", {}, []);

    const analysis = analyzer.analyze(before, after);

    expect(analysis.summary.gapsResolved).toBe(1);
    expect(analysis.detailed.gapChanges.resolved).toHaveLength(1);
    expect(analysis.detailed.gapChanges.resolved[0]).toEqual(gap);
  });

  it("should identify new gaps", () => {
    const newGap: GapCandidate = {
      sourceNodeType: "BusinessService",
      destinationNodeType: "ApplicationComponent",
      suggestedPredicate: "serves",
      reason: "Business services should serve application components",
      priority: "medium",
    };

    const before = createMockAuditReport("2026-02-20T10:00:00.000Z", {}, []);
    const after = createMockAuditReport("2026-02-20T15:00:00.000Z", {}, [newGap]);

    const analysis = analyzer.analyze(before, after);

    expect(analysis.detailed.gapChanges.newGaps).toHaveLength(1);
    expect(analysis.detailed.gapChanges.newGaps[0]).toEqual(newGap);
  });

  it("should calculate gap resolution rate", () => {
    const gap1: GapCandidate = {
      sourceNodeType: "Goal",
      destinationNodeType: "Requirement",
      suggestedPredicate: "realizes",
      reason: "Test",
      priority: "high",
    };

    const gap2: GapCandidate = {
      sourceNodeType: "Requirement",
      destinationNodeType: "Constraint",
      suggestedPredicate: "constrains",
      reason: "Test",
      priority: "medium",
    };

    const before = createMockAuditReport("2026-02-20T10:00:00.000Z", {}, [gap1, gap2]);
    const after = createMockAuditReport("2026-02-20T15:00:00.000Z", {}, [gap2]);

    const analysis = analyzer.analyze(before, after);

    expect(analysis.detailed.gapChanges.resolutionRate).toBe(50);
  });

  it("should identify resolved duplicates", () => {
    const duplicate: DuplicateCandidate = {
      relationships: ["rel1", "rel2"],
      predicates: ["realizes", "fulfills"],
      sourceNodeType: "Goal",
      destinationNodeType: "Requirement",
      reason: "Semantic overlap",
      confidence: "high",
    };

    const before = createMockAuditReport("2026-02-20T10:00:00.000Z", {}, [], [duplicate]);
    const after = createMockAuditReport("2026-02-20T15:00:00.000Z", {}, [], []);

    const analysis = analyzer.analyze(before, after);

    expect(analysis.summary.duplicatesResolved).toBe(1);
    expect(analysis.detailed.duplicateChanges.resolved).toHaveLength(1);
  });

  it("should calculate duplicate elimination rate", () => {
    const dup1: DuplicateCandidate = {
      relationships: ["rel1", "rel2"],
      predicates: ["realizes", "fulfills"],
      sourceNodeType: "Goal",
      destinationNodeType: "Requirement",
      reason: "Test",
      confidence: "high",
    };

    const dup2: DuplicateCandidate = {
      relationships: ["rel3", "rel4"],
      predicates: ["serves", "supports"],
      sourceNodeType: "Service",
      destinationNodeType: "Component",
      reason: "Test",
      confidence: "medium",
    };

    const before = createMockAuditReport("2026-02-20T10:00:00.000Z", {}, [], [dup1, dup2]);
    const after = createMockAuditReport("2026-02-20T15:00:00.000Z", {}, [], [dup2]);

    const analysis = analyzer.analyze(before, after);

    expect(analysis.detailed.duplicateChanges.eliminationRate).toBe(50);
  });

  it("should identify balance improvements", () => {
    const beforeBalance: BalanceAssessment = {
      nodeType: "Goal",
      layer: "motivation",
      category: "structural",
      currentCount: 1,
      targetRange: [2, 4],
      status: "under",
    };

    const afterBalance: BalanceAssessment = {
      nodeType: "Goal",
      layer: "motivation",
      category: "structural",
      currentCount: 3,
      targetRange: [2, 4],
      status: "balanced",
    };

    const before = createMockAuditReport(
      "2026-02-20T10:00:00.000Z",
      {},
      [],
      [],
      [beforeBalance]
    );
    const after = createMockAuditReport(
      "2026-02-20T15:00:00.000Z",
      {},
      [],
      [],
      [afterBalance]
    );

    const analysis = analyzer.analyze(before, after);

    expect(analysis.detailed.balanceChanges.newlyBalanced).toHaveLength(1);
    expect(analysis.summary.balanceImprovements).toHaveLength(1);
    expect(analysis.summary.balanceImprovements[0]).toContain("Goal");
  });

  it("should calculate connectivity changes", () => {
    const before = createMockAuditReport("2026-02-20T10:00:00.000Z");
    before.connectivity.stats.isolatedNodes = 5;
    before.connectivity.stats.averageDegree = 1.5;

    const after = createMockAuditReport("2026-02-20T15:00:00.000Z");
    after.connectivity.stats.isolatedNodes = 2;
    after.connectivity.stats.averageDegree = 2.5;

    const analysis = analyzer.analyze(before, after);

    expect(analysis.detailed.connectivityChanges.deltas.isolationChange).toBe(-3);
    expect(analysis.detailed.connectivityChanges.deltas.degreeChange).toBe(1);
  });

  it("should generate comprehensive summary report", () => {
    const before = createMockAuditReport("2026-02-20T10:00:00.000Z");
    const after = createMockAuditReport("2026-02-20T15:00:00.000Z");

    const analysis = analyzer.analyze(before, after);

    expect(analysis.summary.timestamp).toBe("2026-02-20T15:00:00.000Z");
    expect(analysis.summary.coverageChanges).toBeDefined();
    expect(analysis.summary.relationshipsAdded).toBeGreaterThanOrEqual(0);
    expect(analysis.summary.gapsResolved).toBeGreaterThanOrEqual(0);
    expect(analysis.summary.duplicatesResolved).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(analysis.summary.balanceImprovements)).toBe(true);
  });
});

// Helper function to create mock audit reports
function createMockAuditReport(
  timestamp: string = "2026-02-20T12:00:00.000Z",
  overrides: {
    isolationPercentage?: number;
    density?: number;
  } = {},
  gaps: GapCandidate[] = [],
  duplicates: DuplicateCandidate[] = [],
  balance: BalanceAssessment[] = []
): AuditReport {
  const coverage: CoverageMetrics[] = [
    {
      layer: "motivation",
      nodeTypeCount: 10,
      relationshipCount: 15,
      isolatedNodeTypes: [],
      isolationPercentage: overrides.isolationPercentage ?? 0,
      availablePredicates: ["realizes", "influences"],
      usedPredicates: ["realizes"],
      utilizationPercentage: 50,
      relationshipsPerNodeType: overrides.density ?? 1.5,
    },
    {
      layer: "business",
      nodeTypeCount: 8,
      relationshipCount: 12,
      isolatedNodeTypes: [],
      isolationPercentage: overrides.isolationPercentage ?? 0,
      availablePredicates: ["serves", "accesses"],
      usedPredicates: ["serves"],
      utilizationPercentage: 50,
      relationshipsPerNodeType: overrides.density ?? 1.5,
    },
  ];

  return {
    timestamp,
    model: {
      name: "Test Model",
      version: "1.0.0",
    },
    coverage,
    duplicates,
    gaps,
    balance,
    connectivity: {
      components: [],
      degrees: [],
      transitiveChains: [],
      stats: {
        totalNodes: 100,
        totalEdges: 150,
        connectedComponents: 1,
        largestComponentSize: 100,
        isolatedNodes: 0,
        averageDegree: 3.0,
        transitiveChainCount: 0,
      },
    },
  };
}
