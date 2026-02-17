import { z } from '@hono/zod-openapi';
import { CANONICAL_LAYER_NAMES } from '../core/layers.js';

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
export const ElementIdSchema = z.string()
  .min(1, 'Element ID is required')
  .regex(
    /^[a-z][a-z0-9-]*[a-z0-9]\.[a-z][a-z0-9-]*[a-z0-9]\.[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]\.[a-z]\.[a-z]$/,
    'Invalid element ID format. Must be: layer.type.name (e.g., motivation.goal.customer-satisfaction)'
  );

export const TimestampSchema = z.string().datetime();

// Annotation schemas - for creating annotations
export const AnnotationCreateSchema = z.object({
  elementId: ElementIdSchema,
  author: z.string()
    .max(100, 'Author name too long')
    .optional()
    .default('Anonymous'),
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long'),
  tags: z.array(
    z.string()
      .min(1, 'Tag cannot be empty')
      .max(50, 'Tag too long')
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Tag must contain only lowercase letters, digits, and hyphens')
  ).optional().default([]),
}).strict();

// Annotation schemas - for updating annotations
export const AnnotationUpdateSchema = z.object({
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long')
    .optional(),
  tags: z.array(
    z.string()
      .min(1, 'Tag cannot be empty')
      .max(50, 'Tag too long')
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Tag must contain only lowercase letters, digits, and hyphens')
  ).optional(),
  resolved: z.boolean().optional(),
}).strict();

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
export const LayerNameSchema = z.enum(
  [...CANONICAL_LAYER_NAMES] as unknown as [string, ...string[]]
, {
  message: `Invalid layer name. Must be one of: ${CANONICAL_LAYER_NAMES.join(', ')}`
});

// ID schema - validates generic IDs (annotations, changesets, elements)
// Accepts lowercase alphanumeric characters, hyphens, and underscores (consistent with ElementIdSchema)
export const IdSchema = z.string()
  .min(1, 'ID is required')
  .regex(/^[a-z0-9_-]+$/, 'Invalid ID format. Must contain only lowercase alphanumeric characters, hyphens, and underscores');

// Annotation filter schema - validates query parameters for GET /api/annotations
// Supports filtering by elementId, author, tags, and resolved status
export const AnnotationFilterSchema = z.object({
  elementId: ElementIdSchema.optional(),
  author: z.string().optional(),
  tags: z.string().optional(),
  resolved: z.enum(['true', 'false']).optional(),
}).passthrough(); // Allow extra query parameters (e.g., auth token) to pass through

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
  layers: z.record(z.string(), z.object({}).passthrough()).describe('All layers in the model (key-value pairs mapping layer names to layer objects)'),
  layerCount: z.number().describe('Total number of layers'),
  elementCount: z.number().describe('Total number of elements across all layers'),
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
  id: z.string(),
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
