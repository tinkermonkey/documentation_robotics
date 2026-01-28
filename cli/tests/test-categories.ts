/**
 * Phase 4: Test Categorization and Prioritization
 *
 * This module defines test categories for intelligent test execution,
 * prioritization, and sharding across parallel workers.
 *
 * Categories help optimize test execution by grouping related tests
 * and enabling selective test execution (e.g., fast-track for PRs).
 */

export interface TestCategory {
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  patterns: string[];
  description: string;
  estimatedDuration: string; // e.g., "fast", "medium", "slow"
}

export interface TestShard {
  shardId: number;
  totalShards: number;
  categories: TestCategory[];
}

/**
 * Test Categories for Parallel Execution
 *
 * Critical: Core operations that must work
 * High: Important features and workflows
 * Medium: Advanced features
 * Low: Optional features and advanced scenarios
 */
export const TEST_CATEGORIES: Record<string, TestCategory> = {
  // CRITICAL: Core CRUD operations
  ADD_COMMAND: {
    name: 'add-command',
    priority: 'critical',
    patterns: ['**/add-*.test.ts', '**/add/**/*.test.ts'],
    description: 'Element creation (add command)',
    estimatedDuration: 'fast',
  },

  DELETE_COMMAND: {
    name: 'delete-command',
    priority: 'critical',
    patterns: ['**/delete-*.test.ts', '**/delete/**/*.test.ts'],
    description: 'Element deletion (delete command)',
    estimatedDuration: 'fast',
  },

  UPDATE_COMMAND: {
    name: 'update-command',
    priority: 'critical',
    patterns: ['**/update-*.test.ts', '**/update/**/*.test.ts'],
    description: 'Element updates (update command)',
    estimatedDuration: 'fast',
  },

  VALIDATE_COMMAND: {
    name: 'validate-command',
    priority: 'critical',
    patterns: ['**/validate-*.test.ts', '**/validators/**/*.test.ts'],
    description: 'Validation pipeline',
    estimatedDuration: 'medium',
  },

  // HIGH: Important workflows
  CHANGESET_OPERATIONS: {
    name: 'changeset-operations',
    priority: 'high',
    patterns: ['**/changeset*.test.ts', '**/staging*.test.ts'],
    description: 'Changeset and staging workflows',
    estimatedDuration: 'medium',
  },

  RELATIONSHIP_OPERATIONS: {
    name: 'relationship-operations',
    priority: 'high',
    patterns: ['**/relationship*.test.ts'],
    description: 'Relationship management',
    estimatedDuration: 'medium',
  },

  REFERENCE_VALIDATION: {
    name: 'reference-validation',
    priority: 'high',
    patterns: ['**/reference*.test.ts', '**/link*.test.ts'],
    description: 'Cross-layer reference validation',
    estimatedDuration: 'medium',
  },

  // MEDIUM: Advanced features
  EXPORT_OPERATIONS: {
    name: 'export-operations',
    priority: 'medium',
    patterns: ['**/export*.test.ts'],
    description: 'Export to various formats',
    estimatedDuration: 'medium',
  },

  INFO_COMMAND: {
    name: 'info-command',
    priority: 'medium',
    patterns: ['**/info*.test.ts'],
    description: 'Model information queries',
    estimatedDuration: 'fast',
  },

  LAYER_OPERATIONS: {
    name: 'layer-operations',
    priority: 'medium',
    patterns: ['**/layer*.test.ts'],
    description: 'Layer-specific operations',
    estimatedDuration: 'medium',
  },

  // LOW: Optional and advanced scenarios
  PERFORMANCE_TESTS: {
    name: 'performance-tests',
    priority: 'low',
    patterns: ['**/performance*.test.ts', '**/*-performance.test.ts'],
    description: 'Performance benchmarks',
    estimatedDuration: 'slow',
  },

  ADVANCED_WORKFLOWS: {
    name: 'advanced-workflows',
    priority: 'low',
    patterns: ['**/chat*.test.ts', '**/visualization*.test.ts', '**/conformance*.test.ts'],
    description: 'Advanced features and integrations',
    estimatedDuration: 'slow',
  },

  COMPATIBILITY_TESTS: {
    name: 'compatibility-tests',
    priority: 'low',
    patterns: ['**/compatibility/**/*.test.ts'],
    description: 'Cross-platform and API compatibility',
    estimatedDuration: 'slow',
  },
};

/**
 * Get test categories by priority
 */
export function getCategoriesByPriority(
  priority: 'critical' | 'high' | 'medium' | 'low'
): TestCategory[] {
  return Object.values(TEST_CATEGORIES).filter((cat) => cat.priority === priority);
}

/**
 * Get all test patterns for a priority level
 */
export function getPatternsForPriority(
  priority: 'critical' | 'high' | 'medium' | 'low'
): string[] {
  return getCategoriesByPriority(priority).flatMap((cat) => cat.patterns);
}

/**
 * Create test shards for distributed execution
 *
 * @param totalShards - Number of workers/shards
 * @param shardId - This worker's shard ID (0-indexed)
 * @returns Shard configuration with assigned categories
 */
export function createTestShard(totalShards: number, shardId: number): TestShard {
  const allCategories = Object.values(TEST_CATEGORIES);

  // Distribute categories across shards by priority
  // Ensures each shard gets a balanced mix of priorities
  const categoriesByPriority = {
    critical: getCategoriesByPriority('critical'),
    high: getCategoriesByPriority('high'),
    medium: getCategoriesByPriority('medium'),
    low: getCategoriesByPriority('low'),
  };

  const assignedCategories: TestCategory[] = [];

  // Distribute critical tests across all shards (fail-fast)
  for (let i = 0; i < categoriesByPriority.critical.length; i++) {
    if (i % totalShards === shardId) {
      assignedCategories.push(categoriesByPriority.critical[i]);
    }
  }

  // Distribute other priorities by shard
  for (const priority of ['high', 'medium', 'low'] as const) {
    for (let i = 0; i < categoriesByPriority[priority].length; i++) {
      if (i % totalShards === shardId) {
        assignedCategories.push(categoriesByPriority[priority][i]);
      }
    }
  }

  return {
    shardId,
    totalShards,
    categories: assignedCategories,
  };
}

/**
 * Get test patterns for a specific shard
 */
export function getShardPatterns(totalShards: number, shardId: number): string[] {
  const shard = createTestShard(totalShards, shardId);
  return shard.categories.flatMap((cat) => cat.patterns);
}

/**
 * Fast-track test patterns for quick PR validation
 * (Critical + High priority tests only)
 */
export const FAST_TRACK_PATTERNS = [
  ...getPatternsForPriority('critical'),
  ...getPatternsForPriority('high'),
];

/**
 * Full test patterns (all tests)
 */
export const FULL_TEST_PATTERNS = Object.values(TEST_CATEGORIES).flatMap((cat) => cat.patterns);

export default TEST_CATEGORIES;
