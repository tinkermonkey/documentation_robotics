/**
 * Element ID generation utilities matching Python CLI implementation.
 */

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
