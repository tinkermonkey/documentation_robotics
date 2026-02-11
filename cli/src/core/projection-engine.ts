/**
 * Projection Engine - Python CLI Compatible Implementation
 *
 * Automatically creates elements across layers based on projection rules
 * with property transformations, conditional logic, and template rendering.
 *
 * Spec: cli-validation/projection-engine-spec.md
 */

import { readFile } from "fs/promises";
import { parse as parseYAML } from "yaml";
import { Model } from "./model.js";
import { Element } from "./element.js";
import { ReferenceRegistry } from "./reference-registry.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Transform types for property mapping
 */
export type TransformType =
  | "uppercase"
  | "lowercase"
  | "kebab"
  | "snake"
  | "pascal"
  | "prefix"
  | "suffix"
  | "template";

/**
 * Condition operators for filtering
 */
export type ConditionOperator =
  | "exists"
  | "equals"
  | "not_equals"
  | "contains"
  | "matches"
  | "gt"
  | "lt"
  | "in";

/**
 * Property transformation configuration
 */
export interface PropertyTransform {
  type: TransformType;
  value?: string; // For prefix/suffix/template
}

/**
 * Condition for filtering source elements
 */
export interface ProjectionCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  pattern?: string; // For regex matching
}

/**
 * Property mapping from source to target
 */
export interface PropertyMapping {
  source: string;
  target: string;
  default?: unknown;
  required?: boolean;
  transform?: PropertyTransform;
}

/**
 * Projection rule definition
 */
export interface ProjectionRule {
  name: string;
  from_layer: string;
  from_type: string;
  to_layer: string;
  to_type: string;
  name_template: string;
  property_mappings: PropertyMapping[];
  conditions?: ProjectionCondition[];
  template_file?: string;
  create_bidirectional?: boolean;
}

/**
 * Helper class for property transformations
 */
export class PropertyTransformer {
  constructor(private config: PropertyTransform) {}

  apply(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    const strValue = String(value);

    switch (this.config.type) {
      case "uppercase":
        return strValue.toUpperCase();

      case "lowercase":
        return strValue.toLowerCase();

      case "kebab":
        return toKebabCase(strValue);

      case "snake":
        return toSnakeCase(strValue);

      case "pascal":
        return toPascalCase(strValue);

      case "prefix":
        return `${this.config.value}${strValue}`;

      case "suffix":
        return `${strValue}${this.config.value}`;

      case "template":
        return this.config.value?.replace("{value}", strValue) ?? strValue;

      default:
        return strValue;
    }
  }
}

/**
 * Helper class for condition evaluation
 */
export class ConditionEvaluator {
  constructor(private config: ProjectionCondition) {}

  evaluate(element: unknown): boolean {
    const fieldValue = getNestedProperty(element as Record<string, unknown>, this.config.field);

    switch (this.config.operator) {
      case "exists":
        return fieldValue !== null && fieldValue !== undefined;

      case "equals":
        return fieldValue === this.config.value;

      case "not_equals":
        return fieldValue !== this.config.value;

      case "contains":
        return fieldValue ? String(fieldValue).includes(String(this.config.value)) : false;

      case "matches":
        return fieldValue && this.config.pattern
          ? new RegExp(this.config.pattern).test(String(fieldValue))
          : false;

      case "gt":
        return (fieldValue as number) > (this.config.value as number);

      case "lt":
        return (fieldValue as number) < (this.config.value as number);

      case "in":
        return Array.isArray(this.config.value) ? this.config.value.includes(fieldValue) : false;

      default:
        return false;
    }
  }
}

/**
 * Projection Engine - Creates elements across layers based on rules
 */
export class ProjectionEngine {
  private rules: ProjectionRule[] = [];
  private registry?: ReferenceRegistry;

  constructor(
    private model: Model,
    rulesPath?: string
  ) {
    if (rulesPath) {
      this.loadRulesSync(rulesPath);
    }
  }

  /**
   * Set reference registry for element registration
   */
  setRegistry(registry: ReferenceRegistry): void {
    this.registry = registry;
  }

  /**
   * Load projection rules from YAML file
   */
  async loadRules(path: string): Promise<void> {
    try {
      const content = await readFile(path, "utf-8");
      const data = parseYAML(content) as Record<string, unknown>;

      if (!data.projections || !Array.isArray(data.projections)) {
        throw new Error("Invalid projection rules file: missing projections array");
      }

      this.rules = (data.projections as Record<string, unknown>[]).map((proj) =>
        this.parseProjectionRule(proj)
      );
    } catch (error) {
      throw new Error(
        `Failed to load projection rules from ${path}: ${getErrorMessage(error)}`
      );
    }
  }

  /**
   * Synchronous version for constructor
   */
  private loadRulesSync(_path: string): void {
    // For now, rules must be loaded async via loadRules()
    // This is a placeholder for backward compatibility
  }

  /**
   * Add a projection rule programmatically
   */
  addRule(rule: ProjectionRule): void {
    this.rules.push(rule);
  }

  /**
   * Get all loaded rules
   */
  getRules(): ProjectionRule[] {
    return [...this.rules];
  }

  /**
   * Clear all rules
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * Parse YAML projection definition into ProjectionRule
   */
  private parseProjectionRule(data: Record<string, unknown>): ProjectionRule {
    // Split from/to into layer.type
    const [from_layer, from_type] = (data.from as string).split(".");
    const [to_layer, to_type] = (data.to as string).split(".");

    // Get first rule definition (simplified - Python CLI could support multiple)
    const ruleData = Array.isArray(data.rules)
      ? (data.rules as Record<string, unknown>[])[0]
      : (data.rules as Record<string, unknown>);

    // Parse conditions
    const conditions: ProjectionCondition[] = (
      (data.conditions as Record<string, unknown>[] | undefined) || []
    ).map((c: Record<string, unknown>) => ({
      field: c.field as string,
      operator: c.operator as ConditionOperator,
      value: c.value,
      pattern: c.pattern as string | undefined,
    }));

    // Parse property mappings
    const property_mappings: PropertyMapping[] = [];
    if (
      ruleData &&
      typeof ruleData === "object" &&
      "properties" in ruleData &&
      ruleData.properties
    ) {
      const properties = ruleData.properties as Record<string, unknown>;
      for (const [target, mapping] of Object.entries(properties)) {
        if (typeof mapping === "string") {
          // Simple format: { target: source }
          property_mappings.push({ source: mapping, target });
        } else if (typeof mapping === "object" && mapping !== null) {
          // Advanced format with transform
          const m = mapping as Record<string, unknown>;
          property_mappings.push({
            source: m.source as string,
            target,
            default: m.default,
            required: (m.required as boolean | undefined) ?? false,
            transform: m.transform as PropertyTransform | undefined,
          });
        }
      }
    }

    return {
      name: data.name as string,
      from_layer,
      from_type,
      to_layer,
      to_type,
      name_template:
        ruleData && typeof ruleData === "object" && "name_template" in ruleData
          ? (ruleData.name_template as string)
          : "",
      property_mappings,
      conditions,
      template_file:
        ruleData && typeof ruleData === "object" && "template" in ruleData
          ? (ruleData.template as string | undefined)
          : undefined,
      create_bidirectional:
        ruleData &&
        typeof ruleData === "object" &&
        "create_bidirectional" in ruleData &&
        ruleData.create_bidirectional !== undefined
          ? (ruleData.create_bidirectional as boolean)
          : true,
    };
  }

  /**
   * Find rules applicable to a source element
   */
  findApplicableRules(source: Element, targetLayer?: string): ProjectionRule[] {
    return this.rules.filter((rule) => {
      // Check layer match
      if (rule.from_layer !== source.layer) return false;

      // Check type match (if specified)
      if (rule.from_type && rule.from_type !== source.type) return false;

      // Check target layer filter (if specified)
      if (targetLayer && rule.to_layer !== targetLayer) return false;

      // Evaluate all conditions (ALL must be true)
      if (rule.conditions) {
        for (const condition of rule.conditions) {
          const evaluator = new ConditionEvaluator(condition);
          if (!evaluator.evaluate(source)) {
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * Project a single element to target layer
   */
  async projectElement(
    source: Element,
    targetLayer: string,
    rule?: ProjectionRule,
    dryRun: boolean = false
  ): Promise<Element> {
    // Find rule if not provided
    if (!rule) {
      const applicableRules = this.findApplicableRules(source, targetLayer);
      if (applicableRules.length === 0) {
        throw new Error(
          `No applicable projection rule found for element ${source.id} to layer ${targetLayer}`
        );
      }
      rule = applicableRules[0];
    }

    // Build projected element
    const projected = this.buildProjectedElement(source, rule);

    // If not dry run, add to model
    if (!dryRun) {
      const layer = await this.model.getLayer(rule.to_layer);
      if (!layer) {
        throw new Error(`Target layer ${rule.to_layer} not found`);
      }

      // Add element to layer
      layer.addElement(projected);

      // Register with reference registry if available
      if (this.registry) {
        this.registry.registerElement(projected);
      }
    }

    return projected;
  }

  /**
   * Build projected element from source and rule
   */
  private buildProjectedElement(source: Element, rule: ProjectionRule): Element {
    // Render element name
    const name = this.renderTemplate(rule.name_template, source);

    // Generate element ID
    const id = generateElementId(rule.to_layer, rule.to_type, name);

    // Initialize element data
    const data: Record<string, unknown> = {
      id,
      name,
      type: rule.to_type,
      layer: rule.to_layer,
    };

    // Map properties
    for (const mapping of rule.property_mappings) {
      let value: unknown;

      // Get source value
      if (mapping.source.includes("{") || mapping.source.includes("{{")) {
        // Template string
        value = this.renderTemplate(mapping.source, source);
      } else {
        // Direct property or nested property
        value = this.getSourceValue(source, mapping.source);
      }

      // Use default if null
      if (value === null || value === undefined) {
        if (mapping.required) {
          throw new Error(
            `Required property ${mapping.target} is missing from source ${source.id}`
          );
        }
        value = mapping.default;
      }

      // Apply transformation if specified
      if (mapping.transform && value !== null && value !== undefined) {
        const transformer = new PropertyTransformer(mapping.transform);
        value = transformer.apply(value);
      }

      // Set target property
      if (value !== null && value !== undefined) {
        setNestedProperty(data, mapping.target, value);
      }
    }

    // Add bidirectional reference if enabled
    if (rule.create_bidirectional !== false) {
      if (!data.properties) data.properties = {};
      (data.properties as Record<string, unknown>).realizes = source.id;
    }

    // Create Element instance
    return new Element(data as ConstructorParameters<typeof Element>[0]);
  }

  /**
   * Get value from source element (supports dot notation)
   */
  private getSourceValue(source: Element, path: string): unknown {
    // Check for direct element properties
    if (path === "id") return source.id;
    if (path === "name") return source.name;
    if (path === "type") return source.type;
    if (path === "layer") return source.layer;
    if (path === "description") return source.description;

    // Check nested properties in the properties map
    return getNestedProperty(source.properties, path);
  }

  /**
   * Render template string with source element data
   */
  private renderTemplate(template: string, source: Element): string {
    // Build context
    const context: Record<string, string | Record<string, unknown>> = {
      id: source.id,
      name: source.name,
      type: source.type,
      layer: source.layer ?? "",
      description: source.description ?? "",
      properties: source.properties,
      name_pascal: toPascalCase(source.name),
      name_kebab: toKebabCase(source.name),
      name_snake: toSnakeCase(source.name),
    };

    // Simple template replacement for {source.xxx}
    let result = template;
    const regex = /\{source\.(\w+)\}/g;
    result = result.replace(regex, (match, prop) => {
      return context[prop] !== undefined ? String(context[prop]) : match;
    });

    return result;
  }

  /**
   * Project all elements that match rules
   */
  async projectAll(
    fromLayer?: string,
    toLayer?: string,
    dryRun: boolean = false
  ): Promise<Element[]> {
    const projected: Element[] = [];

    // Get source elements
    const layers = fromLayer
      ? [await this.model.getLayer(fromLayer)]
      : Array.from(this.model.layers.values());

    for (const layer of layers) {
      if (!layer) continue;

      for (const element of layer.listElements()) {
        // Find applicable rules
        const applicableRules = this.findApplicableRules(element, toLayer);

        // Project with each applicable rule
        for (const rule of applicableRules) {
          try {
            const projectedElement = await this.projectElement(
              element,
              rule.to_layer,
              rule,
              dryRun
            );
            projected.push(projectedElement);
          } catch (error) {
            // Log warning and continue
            console.warn(
              `Warning: Failed to project ${element.id} with rule ${rule.name}: ${getErrorMessage(error)}`
            );
          }
        }
      }
    }

    return projected;
  }
}

/**
 * Helper: Get nested property from object
 */
function getNestedProperty(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Helper: Set nested property on object
 */
function setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Helper: Convert to kebab-case
 */
function toKebabCase(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
}

/**
 * Helper: Convert to snake_case
 */
function toSnakeCase(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

/**
 * Helper: Convert to PascalCase
 */
function toPascalCase(text: string): string {
  const words = text.replace(/-/g, " ").replace(/_/g, " ").split(/\s+/);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

/**
 * Helper: Generate element ID
 */
function generateElementId(layer: string, type: string, name: string): string {
  const kebabName = toKebabCase(name);
  return `${layer}.${type}.${kebabName}`;
}
