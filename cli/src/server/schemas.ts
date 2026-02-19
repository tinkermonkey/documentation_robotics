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

export const ElementResponseSchema = z.object({
  id: ElementIdSchema.describe('Element ID'),
  name: z.string().describe('Element name'),
  type: z.string().describe('Element type'),
  description: z.string().optional().describe('Element description'),
  properties: z.record(z.string(), z.unknown()).optional().describe('Element properties (key-value pairs with arbitrary values)'),
  annotations: z.array(AnnotationSchema).optional().describe('Associated annotations'),
});

export const ModelResponseSchema = z.object({
  manifest: z.record(z.string(), z.unknown()).describe('Model manifest metadata'),
  layers: z.record(z.string(), z.object({}).passthrough()).describe('All layers in the model (key-value pairs mapping layer names to layer objects)'),
  totalElements: z.number().describe('Total number of elements across all layers'),
});

export const SpecResponseSchema = z.object({
  version: z.string().describe('Spec version'),
  type: z.string().describe('Response type'),
  description: z.string().describe('Response description'),
  source: z.string().describe('Schema source'),
  schemas: z.record(z.string(), z.unknown()).describe('JSON schema definitions (each schema is a JSON Schema object)'),
  schemaCount: z.number().describe('Number of schemas'),
});

export const ChangesetMetadataSchema = z.object({
  name: z.string(),
  status: z.enum(['active', 'applied', 'abandoned'] as const),
  type: z.enum(['feature', 'bugfix', 'exploration'] as const),
  created_at: z.string(),
  elements_count: z.number(),
});

export const ChangesetsListSchema = z.object({
  version: z.string(),
  changesets: z.record(z.string(), ChangesetMetadataSchema),
});

export const ChangesetDetailSchema = z.object({
  metadata: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.enum(['feature', 'bugfix', 'exploration'] as const),
    status: z.enum(['active', 'applied', 'abandoned'] as const),
    created_at: z.string(),
    updated_at: z.string().optional(),
    workflow: z.string().optional(),
    summary: z.object({
      elements_added: z.number(),
      elements_updated: z.number(),
      elements_deleted: z.number(),
    }),
  }),
  changes: z.object({
    version: z.string(),
    changes: z.array(z.object({
      timestamp: z.string(),
      operation: z.enum(['add', 'update', 'delete'] as const),
      element_id: z.string(),
      layer: z.string(),
      element_type: z.string(),
      data: z.unknown().optional().describe('Element data (varies by element type)'),
      before: z.unknown().optional().describe('Previous element state (for update operations)'),
      after: z.unknown().optional().describe('New element state (for update operations)'),
    })),
  }),
});

// Type inference from input schemas
export type AnnotationCreate = z.infer<typeof AnnotationCreateSchema>;
export type AnnotationUpdate = z.infer<typeof AnnotationUpdateSchema>;
export type AnnotationReplyCreate = z.infer<typeof AnnotationReplyCreateSchema>;
