import { z } from '@hono/zod-openapi';
import { CANONICAL_LAYER_NAMES } from '../core/layers.js';

/**
 * Branded type for ElementId
 * Provides compile-time safety by distinguishing ElementId from plain strings
 * Use with parseElementId() to validate and brand a string at runtime
 *
 * This type is exported as a public API contract for external consumers who want
 * to use strong typing in their code. However, internal server.ts implementation
 * uses plain string keys in Maps and other internal structures for simplicity.
 *
 * USAGE PATTERNS:
 * - External/public APIs: Type function parameters with ElementId for contract clarity
 * - Internal state: Use plain strings in Maps/Sets for performance and simplicity
 * - Validation: Use parseElementId() to validate untrusted input
 * - Type guards: Use isElementId() for optional runtime type checking
 *
 * Example:
 *   const brandedId = parseElementId("motivation.goal.customer-satisfaction");
 *   function processElement(id: ElementId) { ... } // Type-safe public API
 *
 *   // Internal implementation can use plain strings:
 *   private annotations: Map<string, Annotation> = new Map();
 */
export type ElementId = string & { readonly __brand: 'ElementId' };

/**
 * Parse and validate a string as an ElementId
 * Returns a branded type for compile-time type safety
 */
export function parseElementId(input: string): ElementId {
  const result = ElementIdSchema.safeParse(input);
  if (!result.success) {
    const errorMessages = result.error.issues.map(issue => issue.message).join('; ');
    throw new Error(`Invalid element ID: ${errorMessages}`);
  }
  return result.data as ElementId;
}

/**
 * Type guard for ElementId
 * Use with function parameters for optional compile-time checking
 */
export function isElementId(value: unknown): value is ElementId {
  return typeof value === 'string' && ElementIdSchema.safeParse(value).success;
}

// WebSocket message schemas with runtime validation
export const SimpleWSMessageSchema = z.object({
  type: z.enum(['subscribe', 'annotate', 'ping']),
  topics: z.array(z.string()).optional(),
  annotation: z.object({
    elementId: z.string(),
    author: z.string(),
    text: z.string(),
    timestamp: z.string(),
  }).optional(),
});

export const JSONRPCRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
  id: z.union([z.string(), z.number()]).optional(),
});

export const JSONRPCResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }).optional(),
  id: z.union([z.string(), z.number(), z.null()]),
}).refine(
  (data) => (data.result !== undefined) !== (data.error !== undefined),
  {
    message: "JSON-RPC 2.0 response must contain either 'result' or 'error', not both",
    path: ["response"],
  }
);

export const WSMessageSchema = z.union([
  SimpleWSMessageSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
]);

// Base schemas for common types
// Enforces three-part element ID format: layer.type.name
// - layer: canonical layer name (e.g., motivation, api, data-store)
// - type: lowercase element type (e.g., goal, endpoint, entity)
// - name: kebab-case element name (e.g., customer-satisfaction)
//
// Example valid IDs:
// - motivation.goal.customer-satisfaction
// - api.endpoint.create-order
// - data-store.table.user-profile
// - a.b.c (minimal single-character segments, valid for testing purposes)
// - ux.a.test (two-character segments are valid)
export const ElementIdSchema = z.string()
  .min(1, 'Element ID is required')
  .regex(
    /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/,
    'Invalid element ID format. Must be: layer.type.name (e.g., motivation.goal.customer-satisfaction)'
  );

export const TimestampSchema = z.string().datetime();

/**
 * Tag validation schema.
 *
 * Format: lowercase alphanumeric with optional internal hyphens
 * Pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
 *
 * Constraints:
 * - Cannot start or end with hyphens: Prevents URL slugification issues and confusion with CLI flags (e.g., --tag-name)
 * - Single character tags allowed (e.g., "a", "1") via the second alternation
 * - Matches common tag conventions (GitHub labels, NPM tags, etc.)
 *
 * Examples:
 * - ✅ "api-critical"
 * - ✅ "high-priority"
 * - ✅ "p0"
 * - ❌ "-api-critical" (starts with hyphen)
 * - ❌ "api-critical-" (ends with hyphen)
 * - ❌ "API-CRITICAL" (uppercase not allowed)
 */
export const TagSchema = z.string()
  .min(1, 'Tag cannot be empty')
  .max(50, 'Tag too long')
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Tag must contain only lowercase letters, digits, and hyphens');

// Annotation schemas - for creating annotations
export const AnnotationCreateSchema = z.object({
  elementId: ElementIdSchema,
  author: z.string()
    .min(1, 'Author is required')
    .max(100, 'Author name too long')
    .optional()
    .default('Anonymous'),
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long'),
  tags: z.array(TagSchema).optional().default([]),
}).strict();

// Annotation schemas - for updating annotations
export const AnnotationUpdateSchema = z.object({
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long')
    .optional(),
  tags: z.array(TagSchema).optional(),
  resolved: z.boolean().optional(),
}).strict().refine(
  (obj) => Object.keys(obj).some(key => obj[key as keyof typeof obj] !== undefined),
  'At least one field must be provided for update'
);

// Annotation schemas - for creating replies
export const AnnotationReplyCreateSchema = z.object({
  author: z.string()
    .min(1, 'Author is required')
    .max(100, 'Author name too long'),
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long'),
}).strict();

// Layer name schema - validates against canonical layer names
export const LayerNameSchema = z.enum(CANONICAL_LAYER_NAMES, {
  message: `Invalid layer name. Must be one of: ${CANONICAL_LAYER_NAMES.join(', ')}`
});

// ID schema - validates generic IDs for annotations, changesets, and other non-element identifiers
// Accepts lowercase alphanumeric characters, hyphens, and underscores
// Note: Different from ElementIdSchema which requires dot-separated format (layer.type.name)
//
// Lowercase-only constraint rationale:
// - Provides case-insensitive ID lookups by normalizing to lowercase at validation time
// - Prevents collisions (MyId vs myid cannot coexist in same namespace)
// - System-generated IDs comply; externally-generated uppercase IDs will be rejected
// - If external systems need uppercase support, IDs should be normalized before API transmission
// - Consider implementing ID normalization in API middleware if integration with external systems is required
export const IdSchema = z.string()
  .min(1, 'ID is required')
  .regex(/^[a-z0-9_-]+$/, 'Invalid ID format. Must contain only lowercase alphanumeric characters, hyphens, and underscores');

// Annotation filter schema - validates query parameters for GET /api/annotations
// Currently only supports filtering by elementId
// UNIMPLEMENTED FILTERS: author, tags, and resolved fields are defined here but filtering is not yet implemented.
// See /workspace/cli/src/server/server.ts:650-651 for implementation details.
// These fields are reserved for future extensibility and currently ignored by the handler.
export const AnnotationFilterSchema = z.object({
  elementId: ElementIdSchema.optional(),
  author: z.string().optional(),
  tags: z.string().optional(),
  resolved: z.enum(['true', 'false']).optional(),
}).strict(); // Validate only declared fields

// Response schemas for OpenAPI documentation
export const ErrorResponseSchema = z.object({
  error: z.string().describe('Error message'),
});

export const HealthResponseSchema = z.object({
  status: z.string().describe('Server health status'),
  version: z.string().describe('API version'),
});

export const AnnotationSchema = z.object({
  id: z.string().describe('Annotation ID'),
  elementId: ElementIdSchema.describe('Target element ID'),
  author: z.string().describe('Author name'),
  content: z.string().describe('Annotation content'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().optional().describe('Last update timestamp'),
  tags: z.array(z.string()).optional().describe('Annotation tags'),
  resolved: z.boolean().optional().describe('Resolution status'),
  replies: z.array(z.object({
    id: z.string(),
    author: z.string(),
    content: z.string(),
    createdAt: z.string(),
  })).optional().describe('Annotation replies'),
});

export const AnnotationReplySchema = z.object({
  id: z.string().describe('Reply ID'),
  author: z.string().describe('Author name'),
  content: z.string().describe('Reply content'),
  createdAt: z.string().describe('Creation timestamp'),
});

export const AnnotationsListSchema = z.object({
  annotations: z.array(AnnotationSchema).describe('List of annotations'),
});

export const AnnotationRepliesSchema = z.object({
  replies: z.array(AnnotationReplySchema).describe('List of replies'),
});

export const LayerResponseSchema = z.object({
  name: z.string().describe('Layer name'),
  elements: z.array(z.object({}).passthrough()).describe('Layer elements (each element is an object with id, name, type, and properties)'),
  elementCount: z.number().describe('Total element count'),
});

export const GraphNodeSchema = z.object({
  id: z.string().describe('Element ID (UUID)'),
  spec_node_id: z.string().describe('Spec node type ID (e.g. motivation.goal)'),
  type: z.string().describe('Element type (e.g. goal, endpoint)'),
  layer_id: z.string().describe('Layer this element belongs to'),
  name: z.string().describe('Element display name'),
  description: z.string().optional().describe('Element description'),
  attributes: z.record(z.string(), z.unknown()).optional()
    .describe('Typed attribute bag per spec-node schema'),
  source_reference: z.object({
    provenance: z.enum(['extracted', 'manual', 'inferred', 'generated']),
    locations: z.array(z.object({
      file: z.string(),
      symbol: z.string().optional(),
    })),
    repository: z.object({
      url: z.string().optional(),
      commit: z.string().optional(),
    }).optional(),
  }).optional().describe('Source code provenance linking this element to its implementation'),
  metadata: z.object({
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    created_by: z.string().optional(),
    version: z.number().optional(),
  }).optional().describe('Element lifecycle metadata (timestamps, version)'),
  properties: z.record(z.string(), z.unknown()).optional()
    .describe('Legacy property bag (deprecated — prefer attributes)'),
});

export const GraphLinkSchema = z.object({
  id: z.string().describe('Stable link ID derived from source, target, and type'),
  source: z.string().describe('Source element ID'),
  target: z.string().describe('Target element ID'),
  type: z.string().describe('Relationship predicate or reference type'),
  // Intra-layer links carry layer_id; cross-layer links carry source/target layer IDs
  layer_id: z.string().optional().describe('Layer ID for intra-layer relationships'),
  source_layer_id: z.string().optional().describe('Source layer ID for cross-layer references'),
  target_layer_id: z.string().optional().describe('Target layer ID for cross-layer references'),
});

export const ModelResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema).describe('All architecture elements across all layers'),
  links: z.array(GraphLinkSchema).describe('Intra-layer relationships and cross-layer references'),
});

export const SpecResponseSchema = z.object({
  version: z.string().describe('Spec version'),
  type: z.string().describe('Response type'),
  description: z.string().describe('Response description'),
  source: z.string().describe('Schema source'),
  schemas: z.record(z.string(), z.unknown()).describe('JSON schema definitions (each schema is a JSON Schema object)'),
  schemaCount: z.number().describe('Number of schemas'),
});

export const ChangesetOriginSchema = z.object({
  kind: z.enum(['chat', 'plan', 'extract', 'cli'] as const)
    .describe('Who created the changeset: DrBot in `dr visualize` (chat), the changeset_create MCP tool (plan), codebase_extract (extract), or `dr changeset create` (cli)'),
  detail: z.string().optional(),
}).describe('Where the changeset came from; absent on changesets made before it was recorded');

export const ReviewVerdictSchema = z.enum(['keep', 'drop', 'ask'] as const);

export const ReviewDecisionSchema = z.object({
  verdict: ReviewVerdictSchema,
  note: z.string().optional(),
  atRevision: z.number().int().describe('The changeset revision (nextSequenceNumber) when the decision was made'),
  decidedAt: z.string().describe('ISO timestamp of the decision'),
});

export const ChangesetReviewSchema = z.object({
  decisions: z.record(z.string(), ReviewDecisionSchema)
    .describe('Decisions keyed by the change\'s sequenceNumber, as a string'),
  lastReviewedRevision: z.number().int().optional()
    .describe('The highest atRevision among the decisions; absent when there are none'),
});

export const ChangesetReviewCountsSchema = z.object({
  decided: z.number().int().describe('Decisions whose change is still staged and was not rewritten after the decision (any verdict, ask included)'),
  total: z.number().int().describe('Staged changes'),
  asked: z.number().int().describe('Of the decided, those with verdict ask'),
});

export const ChangesetMetadataSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['staged', 'committed', 'discarded'] as const),
  created: z.string(),
  changes_count: z.number(),
  origin: ChangesetOriginSchema.optional(),
  revision: z.number().int().optional().describe('The changeset\'s nextSequenceNumber'),
  review: ChangesetReviewCountsSchema.optional(),
});

export const ChangesetsListSchema = z.object({
  version: z.string(),
  changesets: z.record(z.string(), ChangesetMetadataSchema),
});

export const DeleteBlockerSchema = z.object({
  relationshipId: z.string().describe('source::predicate::target (dotted ids)'),
  direction: z.enum(['in', 'out'] as const).describe('out: the deleted element is the source; in: it is the target'),
  otherElementId: z.string().describe('The element at the other end (dotted id)'),
  predicate: z.string(),
});

const ChangeTypeSchema = z.enum(['add', 'update', 'delete', 'relationship-add', 'relationship-delete'] as const);

/**
 * Who decided a staged change: `ChangeOrigin` in cli/src/core/changeset.ts
 * (docs/analyzers/TIER1_DESIGN.md section 7). codebase_extract sets it on the adds and
 * relationship-adds it stages; changes staged otherwise, and changesets older than it, have none.
 * Not to be confused with the changeset's own `origin` (ChangesetOriginSchema: who created the
 * changeset). Holds no secret.
 */
export const ChangeOriginSchema = z.object({
  by: z.enum(['tier0', 'tier1', 'agent'] as const)
    .describe('tier0: a Tier-0 rule or the node or edge mapping; tier1: a decision model (Tier 1); agent: the calling agent'),
  rule: z.string().optional()
    .describe('Tier 0: the rule (e.g. node-mapping:Route, or edge:CALLS for a relationship between elements the run did not add); Tier 1: tier1:<question set> (e.g. tier1:dr-qset-2)'),
  provider: z.string().optional().describe('Tier 1: the provider (e.g. cloudflare-workers-ai)'),
  model: z.string().optional().describe('Tier 1: the model, as the provider\'s response named it when it did'),
  upstream: z.string().optional().describe('Tier 1 through OpenRouter: the upstream that served the request'),
  p: z.object({
    layer: z.number().describe('Probability of the chosen layer'),
    type: z.number().nullable().describe('Probability of the chosen element type; null when the type was not asked'),
  }).optional().describe('Tier 1: the probabilities of the chosen layer and type'),
  confirmed: z.enum(['auto', 'agent'] as const).optional()
    .describe('Tier 1: auto (staged by stage mode) or agent (the agent accepted the band with acceptTier1)'),
}).describe('Who decided this change (codebase_extract only); absent on changes staged otherwise and in older changesets')
  .openapi('ChangeOrigin');

/** A change as stored in a tombstone (compact: no `before` on an add). */
const CompactChangeSchema = z.object({
  type: ChangeTypeSchema,
  elementId: z.string(),
  layerName: z.string(),
  timestamp: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  origin: ChangeOriginSchema.optional(),
});

export const UnstagedChangeSchema = z.object({
  sequence: z.number().int().describe('The sequence number the change had'),
  removedAt: z.number().int().describe('The revision the unstage or rewrite took'),
  rewritten: z.literal(true).optional()
    .describe('The change was rewritten in place (still staged under the same sequence number); the tombstone holds its earlier version'),
  change: CompactChangeSchema,
});

export const ChangesetCommitRequestSchema = z.object({
  drop: z.array(z.number().int()).optional()
    .describe('Sequence numbers to leave out. Changes that depend on an element a dropped add creates (relationship-adds with it at either end, updates of it) are left out too. All are unstaged (tombstoned) before the commit.'),
  deleteBlockedLinks: z.array(z.number().int()).optional()
    .describe('Sequence numbers of delete changes whose blockers may be deleted with the element. With a body, any other delete with blockers is refused (422).'),
});

export const ChangesetActionResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['staged', 'committed', 'discarded'] as const),
  committed: z.number().optional().describe('Changes applied to the model (commit only)'),
  skipped: z.number().optional().describe('Changes skipped as already present (commit only)'),
  failed: z.number().optional().describe('Changes that failed to apply (commit only)'),
  preExistingErrors: z.number().optional().describe('Validation errors the base model already had (commit only)'),
  deactivated: z.boolean().optional().describe('The changeset was active and was deactivated (commit only)'),
  deactivationError: z.string().optional(),
  dropped: z.array(z.number().int()).optional()
    .describe('Commit with a body only: every sequence number left out, cascaded ones included'),
  linksDeleted: z.number().int().optional()
    .describe('Commit with a body only: relationships deleted with the deletes named in deleteBlockedLinks'),
});

export const ChangesetCommitRefusedSchema = z.object({
  error: z.string(),
  blockers: z.record(z.string(), z.array(DeleteBlockerSchema)).optional()
    .describe('When deletes have blockers and are not in deleteBlockedLinks: their blockers, keyed by sequence number'),
});

export const ChangesetReviewUpdateSchema = z.object({
  decisions: z.array(z.object({
    sequence: z.number().int().min(0),
    verdict: ReviewVerdictSchema.nullable().describe('null clears the decision'),
    note: z.string().optional(),
  })),
});

export const ChangesetDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: z.enum(['staged', 'committed', 'discarded'] as const),
  created: z.string(),
  modified: z.string(),
  baseSnapshot: z.string().optional(),
  stats: z.object({
    additions: z.number(),
    modifications: z.number(),
    deletions: z.number(),
  }),
  revision: z.number().int().describe('The changeset\'s nextSequenceNumber: one past the highest sequence number used'),
  origin: ChangesetOriginSchema.optional(),
  unstaged: z.array(UnstagedChangeSchema).describe('Unstaged and rewritten changes (tombstones), oldest first'),
  review: ChangesetReviewSchema,
  changes: z.array(z.object({
    type: ChangeTypeSchema,
    elementId: z.string().describe('For relationship changes: source::predicate::target'),
    layerName: z.string(),
    sequenceNumber: z.number().int().optional().describe('Stable identity of the change; never renumbered'),
    timestamp: z.string().optional(),
    before: z.unknown().optional().describe('Previous element state (for update/delete operations)'),
    after: z.unknown().optional().describe('New element state (for add/update operations)'),
    origin: ChangeOriginSchema.optional(),
    blockers: z.array(DeleteBlockerSchema).optional()
      .describe('Delete changes of a staged changeset only: relationships in the projected model that still reference the deleted element and that the changeset does not delete'),
  })),
});

// GET /api/tier1: Tier 1's state and spend (docs/analyzers/TIER1_DESIGN.md sections 4.3 and 7).
// The body is the tier1_status MCP tool's, built by the same code (cli/src/analyzers/classifier/
// status.ts), without the probe: a GET never sends a request to a provider. It never holds a key.

export const Tier1StateSchema = z.enum(['off', 'misconfigured', 'no-credentials', 'on', 'capped'] as const)
  .describe('on: Tier 1 runs; capped: opted in and ready, but this month\'s spend reached the cap (cached answers are still used); off: no tier1.json (the default); misconfigured: tier1.json is unreadable, invalid, tracked by git, too open, or names an unknown provider or model; no-credentials: a key is missing');

export const Tier1MonthSchema = z.object({
  spentUsd: z.number().describe('Spent this calendar month (UTC), from the ledger'),
  capUsd: z.number().describe('The monthly cap (monthlyCapUsd in tier1.json; $20 by default; 0 sends nothing)'),
  remainingUsd: z.number().describe('What is left of the cap this month (never below 0)'),
  resetsAt: z.string().describe('When the window resets: the first of next month, 00:00 UTC (ISO 8601)'),
  cards: z.number().int().describe('Cards asked this month'),
  percentUsed: z.number().min(0).max(100).nullable()
    .describe('spentUsd as a percentage of capUsd, 0 to 100 (held at 100 past the cap), to one decimal; null when the cap is 0'),
});

const Tier1SourceSpendSchema = z.object({
  cards: z.number().int(),
  costUsd: z.number(),
  lastAt: z.string().describe('The last time this source spent (ISO 8601)'),
});

export const Tier1StatusResponseSchema = z.object({
  state: Tier1StateSchema,
  reason: z.string().optional().describe('Why Tier 1 is not on, for a person: set for every state but on (capped included: the cap, when it resets, how to raise it)'),
  analyzer: z.string().describe('The analyzer Tier 1 is configured for (the active one, else cbm)'),
  config: z.string().describe('The opt-in file, relative to the project root (.dr/analyzers/<analyzer>/tier1.json)'),
  provider: z.string().optional().describe('The provider tier1.json names (on, capped, no-credentials)'),
  model: z.string().optional().describe('The model tier1.json names (on, capped, no-credentials)'),
  modelId: z.string().optional().describe('The provider\'s model id, e.g. @cf/cloudflare/clef (on and capped only)'),
  monthlyCapUsd: z.number().optional().describe('The cap tier1.json sets, default filled in (on, capped, no-credentials); month.capUsd is always present'),
  concurrency: z.number().int().optional().describe('Requests in flight at once (on, capped, no-credentials)'),
  credentials: z.record(z.string(), z.object({
    set: z.boolean(),
    from: z.string().nullable().describe('Where the value comes from: tier1.json or an environment variable\'s name; null when unset. Never the value'),
  })).describe('Per credential the provider needs: whether it is set and where from (never the value); empty when off or misconfigured'),
  month: Tier1MonthSchema,
  nearCap: z.boolean().describe('True at 80% of the cap or more, before it is reached: the warning state (a cap of 0 never warns)'),
  bySource: z.record(z.string(), Tier1SourceSpendSchema)
    .describe('This month\'s spend per source (extract, index, classify, probe); a source that spent nothing this month is absent'),
  cache: z.object({
    entries: z.number().int().describe('Lines in the cache files, one per cached answer, before compaction drops any (read without parsing; `dr analyzer tier1 cache status` has the exact count)'),
    bytes: z.number().int(),
    files: z.number().int(),
    lastCompaction: z.string().nullable().describe('When the cache was last compacted (ISO 8601), or null'),
  }).describe('The Tier-1 answer cache'),
  dotDrIgnored: z.boolean().nullable().describe('Whether git ignores .dr/ (null when git cannot say: outside a git work tree, or git is unavailable)'),
  warnings: z.array(z.string()),
  summary: z.string().describe('One line for a person: the state, then this month\'s spend against the cap (and the 80% warning)'),
  note: z.string().describe('How a person changes Tier 1 (dr analyzer tier1 ...; nothing over this API) and what the spend counts'),
}).openapi('Tier1Status');

// Type inference from input schemas
export type AnnotationCreate = z.infer<typeof AnnotationCreateSchema>;
export type AnnotationUpdate = z.infer<typeof AnnotationUpdateSchema>;
export type AnnotationReplyCreate = z.infer<typeof AnnotationReplyCreateSchema>;
