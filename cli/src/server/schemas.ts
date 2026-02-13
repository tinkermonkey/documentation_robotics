import { z } from 'zod';
import { CANONICAL_LAYER_NAMES } from '../core/layers.js';

// Base schemas for common types
// Accepts both formats:
// - New spec format: layer.type.name (e.g., motivation.goal.customer-satisfaction)
// - Legacy format: layer-type-name (e.g., motivation-goal-customer-satisfaction)
//
// Regex pattern: /^[a-z0-9][a-z0-9\.\-]*[a-z0-9]$|^[a-z0-9]$/
// - Allows lowercase letters, digits, dots, and hyphens
// - Must start and end with alphanumeric (no trailing dots/hyphens)
// - Single character IDs are allowed (e.g., 'a')
// Known limitation: Does not validate that consecutive dots/hyphens are present
// (e.g., 'a--b' or 'a..b' would pass). More strict validation could be added
// if the element ID format becomes more formally specified.
export const ElementIdSchema = z.string()
  .min(1, 'Element ID is required')
  .regex(/^[a-z0-9][a-z0-9\.\-]*[a-z0-9]$|^[a-z0-9]$/, 'Invalid element ID format');

export const TimestampSchema = z.string().datetime();

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
  tags: z.array(z.string()).optional().default([]),
}).strict(); // Prevent extra fields

// Annotation schemas - for updating annotations
export const AnnotationUpdateSchema = z.object({
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long')
    .optional(),
  tags: z.array(z.string()).optional(),
  resolved: z.boolean().optional(),
}).strict(); // Prevent extra fields

// Annotation schemas - for creating replies
export const AnnotationReplyCreateSchema = z.object({
  author: z.string()
    .min(1, 'Author is required')
    .max(100, 'Author name too long'),
  content: z.string()
    .min(1, 'Content is required')
    .max(5000, 'Content too long'),
}).strict(); // Prevent extra fields

// Layer name schema - validates against canonical layer names
export const LayerNameSchema = z.enum(
  [...CANONICAL_LAYER_NAMES] as unknown as [string, ...string[]]
, {
  message: `Invalid layer name. Must be one of: ${CANONICAL_LAYER_NAMES.join(', ')}`
});

// ID schema - validates generic IDs (annotations, changesets, elements)
// Accepts alphanumeric characters, hyphens, and underscores
export const IdSchema = z.string()
  .min(1, 'ID is required')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid ID format. Must contain only alphanumeric characters, hyphens, and underscores');

// Annotation filter schema - validates query parameters for GET /api/annotations
export const AnnotationFilterSchema = z.object({
  elementId: ElementIdSchema.optional()
}).strict(); // Prevent extra query parameters

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
  elements: z.array(z.any()).describe('Layer elements'),
  elementCount: z.number().describe('Total element count'),
});

export const ElementResponseSchema = z.object({
  id: ElementIdSchema.describe('Element ID'),
  name: z.string().describe('Element name'),
  type: z.string().describe('Element type'),
  description: z.string().optional().describe('Element description'),
  properties: z.record(z.string(), z.any()).optional().describe('Element properties'),
  annotations: z.array(AnnotationSchema).optional().describe('Associated annotations'),
});

export const SpecResponseSchema = z.object({
  version: z.string().describe('Spec version'),
  type: z.string().describe('Response type'),
  description: z.string().describe('Response description'),
  source: z.string().describe('Schema source'),
  schemas: z.record(z.string(), z.any()).describe('JSON schema definitions'),
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
      data: z.any().optional(),
      before: z.any().optional(),
      after: z.any().optional(),
    })),
  }),
});

// Type inference from input schemas
export type AnnotationCreate = z.infer<typeof AnnotationCreateSchema>;
export type AnnotationUpdate = z.infer<typeof AnnotationUpdateSchema>;
export type AnnotationReplyCreate = z.infer<typeof AnnotationReplyCreateSchema>;
