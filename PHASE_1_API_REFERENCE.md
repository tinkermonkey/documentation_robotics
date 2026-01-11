# Phase 1 API Reference

## New Interfaces

### StagedChange

Extends the basic `Change` interface with a sequence number for deterministic replay.

```typescript
export interface StagedChange extends Change {
  sequenceNumber: number;
}
```

### StagedChangesetData

Extended changeset metadata with staging semantics.

```typescript
export interface StagedChangesetData extends ChangesetData {
  id: string;
  status: 'draft' | 'staged' | 'committed' | 'discarded';
  baseSnapshot: string;
  changes: StagedChange[];
  stats: {
    additions: number;
    modifications: number;
    deletions: number;
  };
}
```

### DriftReport

Report on model drift between snapshots.

```typescript
export interface DriftReport {
  baseSnapshotHash: string;
  currentModelHash: string;
  hasDrift: boolean;
  affectedLayers: string[];
  affectedElements: string[];
}
```

### MigrationResult

Result of changeset migration operation.

```typescript
export interface MigrationResult {
  totalChangesets: number;
  migratedChangesets: number;
  failedChangesets: number;
  skippedChangesets: number;
  errors: Array<{
    name: string;
    error: string;
  }>;
}
```

## API Methods

### Changeset (Extended)

```typescript
class Changeset {
  // New fields
  id?: string;
  baseSnapshot?: string;
  stats?: {
    additions: number;
    modifications: number;
    deletions: number;
  };

  // New methods for status lifecycle
  markStaged(): void;
  markCommitted(): void;
  markDiscarded(): void;

  // Calculate and update statistics
  updateStats(): void;
}
```

### BaseSnapshotManager

```typescript
class BaseSnapshotManager {
  /**
   * Capture current model state as a SHA-256 hash
   * Hash includes: manifest, all layers/elements (sorted), relationships
   * Returns: "sha256:{hex}" format string
   */
  async captureSnapshot(model: Model): Promise<string>;

  /**
   * Detect drift between expected snapshot and current model
   * Returns: DriftReport with affected layers/elements
   */
  async detectDrift(
    expectedSnapshot: string,
    currentModel: Model
  ): Promise<DriftReport>;

  /**
   * Compare two snapshot hashes
   * Returns: { identical: boolean, difference: string | null }
   */
  async compareSnapshots(
    snapshot1: string,
    snapshot2: string
  ): Promise<{ identical: boolean; difference: string | null }>;
}
```

### StagedChangesetStorage

```typescript
class StagedChangesetStorage {
  /**
   * Create new changeset in YAML format
   * Creates directory: documentation-robotics/changesets/{id}/
   * Creates files: metadata.yaml, changes.yaml
   */
  async create(
    id: string,
    name: string,
    description: string | undefined,
    baseSnapshot: string
  ): Promise<Changeset>;

  /**
   * Load changeset from YAML files
   * Returns: Changeset object or null if not found
   */
  async load(id: string): Promise<Changeset | null>;

  /**
   * Save changeset to YAML files
   * Updates both metadata.yaml and changes.yaml
   */
  async save(changeset: Changeset): Promise<void>;

  /**
   * List all changesets by scanning directory
   */
  async list(): Promise<Changeset[]>;

  /**
   * Delete changeset directory
   */
  async delete(id: string): Promise<void>;

  /**
   * Add change to changeset
   * Automatically assigns sequence number
   */
  async addChange(id: string, change: StagedChange): Promise<void>;

  /**
   * Remove all changes for an element
   * Recalculates sequence numbers after removal
   */
  async removeChange(id: string, elementId: string): Promise<void>;

  /**
   * Get the storage path for a changeset
   */
  getChangesetPath(id: string): string;

  /**
   * Get the root changesets directory path
   */
  getChangesetsDir(): string;
}
```

### Migration Functions

```typescript
/**
 * Migrate all changesets from old to new format
 * - Loads old changesets from .dr/changesets/
 * - Captures base snapshot
 * - Creates new YAML structure
 * - Maps statuses: draft→draft, applied→committed, reverted→discarded
 */
async function migrateChangesets(
  rootPath: string,
  model: Model
): Promise<MigrationResult>;

/**
 * Check if migration is needed
 * Returns: true if .dr/changesets/ directory exists
 */
async function isMigrationNeeded(rootPath: string): Promise<boolean>;
```

## Usage Examples

### Create a New Changeset

```typescript
import { StagedChangesetStorage } from './core/staged-changeset-storage.js';
import { BaseSnapshotManager } from './core/base-snapshot-manager.js';

const storage = new StagedChangesetStorage('/path/to/project');
const snapshots = new BaseSnapshotManager();

// Capture base model state
const baseSnapshot = await snapshots.captureSnapshot(model);

// Create changeset
const changeset = await storage.create(
  'api-updates-001',
  'API Layer Updates',
  'Add new customer endpoints',
  baseSnapshot
);
```

### Add Changes to Changeset

```typescript
import { StagedChange } from './core/changeset.js';

const change: StagedChange = {
  type: 'add',
  elementId: 'api-endpoint-create-customer',
  layerName: 'api',
  sequenceNumber: 0,
  timestamp: new Date().toISOString(),
  after: {
    id: 'api-endpoint-create-customer',
    name: 'Create Customer',
    type: 'endpoint',
    properties: {
      method: 'POST',
      path: '/customers'
    }
  }
};

await storage.addChange('api-updates-001', change);
```

### Detect Drift

```typescript
const report = await snapshots.detectDrift(changeset.baseSnapshot!, model);

if (report.hasDrift) {
  console.log(`Drift detected!`);
  console.log(`Affected layers: ${report.affectedLayers.join(', ')}`);
  console.log(`Affected elements: ${report.affectedElements.join(', ')}`);
} else {
  console.log('No drift - base model unchanged');
}
```

### Load Existing Changeset

```typescript
const changeset = await storage.load('api-updates-001');

if (changeset) {
  console.log(`Changeset: ${changeset.name}`);
  console.log(`Status: ${changeset.status}`);
  console.log(`Changes: ${changeset.changes.length}`);
  console.log(`  - Additions: ${changeset.stats?.additions}`);
  console.log(`  - Modifications: ${changeset.stats?.modifications}`);
  console.log(`  - Deletions: ${changeset.stats?.deletions}`);
}
```

### Run Migration

```typescript
import { migrateChangesets, isMigrationNeeded } from './core/changeset-migration.js';

if (await isMigrationNeeded('/path/to/project')) {
  const result = await migrateChangesets('/path/to/project', model);

  console.log(`Migrated: ${result.migratedChangesets} changesets`);
  console.log(`Skipped: ${result.skippedChangesets} (already migrated)`);
  console.log(`Failed: ${result.failedChangesets}`);

  if (result.errors.length > 0) {
    console.error('Migration errors:');
    result.errors.forEach(e => {
      console.error(`  ${e.name}: ${e.error}`);
    });
  }
}
```

## Storage Structure

```
project-root/
└── documentation-robotics/
    └── changesets/
        ├── api-updates-001/
        │   ├── metadata.yaml
        │   └── changes.yaml
        ├── db-migration-002/
        │   ├── metadata.yaml
        │   └── changes.yaml
        └── security-patch-003/
            ├── metadata.yaml
            └── changes.yaml
```

### metadata.yaml Format

```yaml
id: api-updates-001
name: "API Layer Updates"
description: "Add new customer endpoints"
created: "2024-01-15T10:00:00Z"
modified: "2024-01-15T14:30:00Z"
status: draft
baseSnapshot: "sha256:abc123def456..."
stats:
  additions: 3
  modifications: 2
  deletions: 0
```

### changes.yaml Format

```yaml
- type: add
  elementId: api-endpoint-create-customer
  layerName: api
  sequenceNumber: 0
  timestamp: "2024-01-15T10:15:00Z"
  after:
    id: api-endpoint-create-customer
    name: "Create Customer"
    type: endpoint
    properties:
      method: POST
      path: /customers

- type: update
  elementId: api-endpoint-list-customers
  layerName: api
  sequenceNumber: 1
  timestamp: "2024-01-15T10:20:00Z"
  before:
    name: "List Customers"
    properties:
      method: GET
      path: /customers
  after:
    name: "List Customers (v2)"
    properties:
      method: GET
      path: /v2/customers

- type: delete
  elementId: api-endpoint-legacy-query
  layerName: api
  sequenceNumber: 2
  timestamp: "2024-01-15T10:25:00Z"
  before:
    name: "Legacy Query"
    type: endpoint
```

## Status Lifecycle

```
┌─────────────────────────────────────────────────────┐
│ Changeset Status Lifecycle                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐                                       │
│  │  draft   │  Initial state when created          │
│  └────┬─────┘                                       │
│       │                                             │
│       ├─ stage() ─────────────────┐                │
│       │                           ▼                │
│       │                    ┌──────────────┐        │
│       │                    │   staged     │        │
│       │                    │   (ready for │        │
│       │                    │    commit)   │        │
│       │                    └──────┬───────┘        │
│       │                           │                │
│       │                           ├─ commit() ───┐│
│       │                           │              ││
│       │                           ▼              ││
│       │                    ┌──────────────┐     ││
│       │                    │  committed   │     ││
│       │                    │  (applied to │     ││
│       │                    │   base)      │     ││
│       │                    └──────────────┘     ││
│       │                                          ││
│       └─ discard() ──────────────────────┐      ││
│                                           ▼      ││
│                                   ┌──────────────┴┤
│                                   │  discarded   │
│                                   │  (no longer  │
│                                   │   valid)     │
│                                   └──────────────┘
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Backward Compatibility

The extended `Changeset` class maintains backward compatibility:

- Existing changesets can still be created with `Changeset.create()`
- All new fields (`id`, `baseSnapshot`, `stats`) are optional
- `toJSON()` only includes new fields if they're present
- Existing code continues to work unchanged

```typescript
// Old style still works
const changeset = Changeset.create('my-changeset');
changeset.addChange('add', 'elem-1', 'api', undefined, { name: 'New' });
// changeset.status will be 'draft'

// New style with extended fields
const staged = Changeset.create('staged-changeset');
staged.id = 'staged-changeset-001';
staged.baseSnapshot = 'sha256:abc...';
staged.markStaged();
// changeset.status will be 'staged'
```

---

For complete implementation details, see `/workspace/PHASE_1_IMPLEMENTATION_SUMMARY.md`
