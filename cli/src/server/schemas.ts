import { z } from 'zod';

// Base schemas for common types
// Accepts both formats:
// - New spec format: layer.type.name (e.g., motivation.goal.customer-satisfaction)
// - Legacy format: layer-type-name (e.g., motivation-goal-customer-satisfaction)
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
});

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

// Response schemas
export const AnnotationReplySchema = z.object({
  id: z.string(),
  author: z.string(),
  content: z.string(),
  createdAt: TimestampSchema,
});

export const AnnotationSchema = z.object({
  id: z.string(),
  elementId: z.string(),
  author: z.string(),
  content: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema.optional(),
  tags: z.array(z.string()).optional(),
  resolved: z.boolean(),
  replies: z.array(AnnotationReplySchema).optional(),
});

// Type inference from schemas
export type AnnotationCreate = z.infer<typeof AnnotationCreateSchema>;
export type AnnotationUpdate = z.infer<typeof AnnotationUpdateSchema>;
export type AnnotationReplyCreate = z.infer<typeof AnnotationReplyCreateSchema>;
export type AnnotationReply = z.infer<typeof AnnotationReplySchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
