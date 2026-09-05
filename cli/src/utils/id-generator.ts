/**
 * Element ID generation utilities matching Python CLI implementation.
 */

import crypto from "node:crypto";

/**
 * Convert text to kebab-case.
 * Matches Python implementation in utils/id_generator.py
 *
 * @example
 * toKebabCase("Customer Management") // "customer-management"
 * toKebabCase("CustomerManagement")  // "customer-management"
 * toKebabCase("customer_management") // "customer-management"
 */
export function toKebabCase(text: string): string {
  // Replace spaces and underscores with hyphens
  let result = text.replace(/[\s_]+/g, "-");

  // Insert hyphen before capital letters (for camelCase/PascalCase)
  result = result.replace(/([a-z])([A-Z])/g, "$1-$2");

  // Convert to lowercase
  result = result.toLowerCase();

  // Remove dots (e.g. "Node.js" → "nodejs") to prevent extra ID segments
  result = result.replace(/\./g, "");

  // Remove any characters not valid in a slug (keeps only a-z, 0-9, hyphens)
  result = result.replace(/[^a-z0-9-]/g, "");

  // Remove multiple consecutive hyphens
  result = result.replace(/-+/g, "-");

  // Remove leading/trailing hyphens
  result = result.replace(/^-+|-+$/g, "");

  return result;
}

/**
 * Generate element ID following Python CLI convention: {layer}.{type}.{kebab-name}
 * Matches Python implementation in utils/id_generator.py
 *
 * @example
 * generateElementId("business", "service", "Customer Management")
 * // "business.service.customer-management"
 */
export function generateElementId(layer: string, elementType: string, name: string): string {
  const kebabName = toKebabCase(name);
  return `${layer}.${elementType}.${kebabName}`;
}

/**
 * Generate a new UUIDv4 using the Node.js built-in crypto module.
 *
 * @example
 * generateUUID() // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
