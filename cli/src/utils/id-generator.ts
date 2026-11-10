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
 * toKebabCase("PetTypeRepository.findPetTypes") // "pet-type-repository-find-pet-types"
 * toKebabCase("Node.js")             // "nodejs"
 */
export function toKebabCase(text: string): string {
  // A dot between code-symbol parts is a word break: "Repo.findAll" → "Repo-findAll". A part is a
  // code symbol when it is camelCase (a lowercase letter followed by an uppercase one). Other dots
  // are dropped below, so "Node.js", "ASP.NET" and "1.2.3" join as before.
  let result = text.replace(/[A-Za-z0-9$]+(?:\.[A-Za-z0-9$]+)+/g, (chain) => {
    const parts = chain.split(".");
    const camel = (part: string) => /[a-z][A-Z]/.test(part);
    return parts.reduce((joined, part, i) => {
      if (i === 0) return part;
      return joined + (camel(parts[i - 1]) || camel(part) ? "-" : ".") + part;
    }, "");
  });

  // Replace spaces and underscores with hyphens
  result = result.replace(/[\s_]+/g, "-");

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
