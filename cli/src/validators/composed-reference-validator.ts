/**
 * Composed reference validation for cross-model reference resolution
 *
 * Validates qualified references against resolved external models with graduated
 * warning/error behavior when models can't be resolved.
 */

import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { parseReferencePath } from "../utils/reference-path-parser.js";
import { promises as fs } from "fs";
import path from "path";

interface ResolvedExternalModel {
  modelName: string;
  elementIds: Set<string>;
}

/**
 * Composed validator that extends reference validation to check qualified
 * references against resolved external models on disk.
 *
 * This validator:
 * 1. Runs the full standard validation pipeline (schema, naming, reference, semantic, relationship)
 * 2. Extends reference validation to check qualified references against resolved external models
 * 3. Applies graduated warning/error behavior for unresolved models
 */
export class ComposedReferenceValidator {
  private modelPathOverrides: Record<string, string>;
  private resolvedModels: Map<string, ResolvedExternalModel> = new Map();
  private unresolvedModels: Set<string> = new Set();
  private referencedModels: Set<string> = new Set();

  constructor(modelPathOverrides: Record<string, string> = {}) {
    this.modelPathOverrides = modelPathOverrides;
  }

  /**
   * Validate model references in composed scope
   * - First runs base validation (unqualified references + all other stages)
   * - Then validates qualified references against resolved external models
   * - Applies graduated warning/error behavior
   */
  async validateModel(model: Model): Promise<ValidationResult> {
    // Import the full Validator to run all validation stages
    const { Validator } = await import("./validator.js");
    const fullValidator = new Validator();

    // Stage 0: Run full validation (all 5 stages)
    const result = await fullValidator.validateModel(model);

    // Collect external model names from manifest
    const declaredModels = new Set(Object.keys(model.manifest.models || {}));

    // Stage 2: Collect qualified references and track which models are used
    this.referencedModels.clear();
    this.collectReferencedModels(model);

    // Stage 3: Try to resolve each declared external model
    for (const modelName of declaredModels) {
      await this.resolveExternalModel(modelName);
    }

    // Stage 4: Apply graduated warning/error behavior
    for (const modelName of declaredModels) {
      const isReferenced = this.referencedModels.has(modelName);
      const isResolved = this.resolvedModels.has(modelName);

      if (!isResolved) {
        if (isReferenced) {
          // Declared, referenced, but unresolvable → error with guidance
          result.addError({
            layer: "manifest",
            message: `External model '${modelName}' is referenced in qualified paths but could not be resolved from the configured paths`,
            category: "reference",
            fixSuggestion: `Ensure the model exists on disk, or use '--model-path ${modelName}=/path/to/model' to specify its location`,
          });
        } else {
          // Declared but unreferenced and unresolvable → warning only
          result.addWarning({
            layer: "manifest",
            message: `External model '${modelName}' is declared but not referenced in any qualified paths and could not be found on disk`,
            category: "reference",
            fixSuggestion: `Remove the declaration if not needed, or use '--model-path ${modelName}=/path/to/model' to specify its location`,
          });
        }
      } else if (isReferenced) {
        // Declared, referenced, and resolvable → validate qualified references
        const validationResult = this.validateQualifiedReferencesAgainstModel(model, modelName);
        result.merge(validationResult, `[Composed/${modelName}]`);
      }
    }

    return result;
  }

  /**
   * Collect all models referenced in qualified paths throughout the model
   */
  private collectReferencedModels(model: Model): void {
    for (const [, layer] of model.layers) {
      for (const element of layer.listElements()) {
        for (const ref of element.references || []) {
          if (ref.target.startsWith("@")) {
            try {
              const parsed = parseReferencePath(ref.target);
              if (parsed.modelName) {
                this.referencedModels.add(parsed.modelName);
              }
            } catch {
              // Parse errors are already handled by base validator
              continue;
            }
          }
        }
      }
    }
  }

  /**
   * Try to resolve an external model from disk
   */
  private async resolveExternalModel(modelName: string): Promise<void> {
    const modelPath = this.modelPathOverrides[modelName];

    if (!modelPath) {
      this.unresolvedModels.add(modelName);
      return;
    }

    try {
      // Verify the model directory exists
      const modelDir = path.join(modelPath, "model");
      const stats = await fs.stat(modelDir);

      if (!stats.isDirectory()) {
        this.unresolvedModels.add(modelName);
        return;
      }

      const elementIds = new Set<string>();

      // Try to load all layer directories
      let entries: any[] = [];
      try {
        entries = await fs.readdir(modelDir, { withFileTypes: true });
      } catch {
        this.unresolvedModels.add(modelName);
        return;
      }

      // Load elements from each layer directory
      for (const entry of entries) {
        if (entry.isDirectory() && /^\d+_/.test(entry.name)) {
          // This looks like a layer directory (e.g., "01_motivation", "08_data-model")
          const layerPath = path.join(modelDir, entry.name);
          await this.collectElementsFromLayer(layerPath, elementIds);
        }
      }

      // Successfully resolved the model (track it even if empty)
      this.resolvedModels.set(modelName, {
        modelName,
        elementIds,
      });
    } catch (error) {
      // Failed to resolve model
      this.unresolvedModels.add(modelName);
    }
  }

  /**
   * Collect element IDs from a layer directory by reading YAML files
   */
  private async collectElementsFromLayer(layerPath: string, elementIds: Set<string>): Promise<void> {
    try {
      const entries = await fs.readdir(layerPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
          // Read the YAML file and extract element paths/IDs
          try {
            const content = await fs.readFile(path.join(layerPath, entry.name), "utf-8");
            this.extractElementPathsFromYAML(content, elementIds);
          } catch {
            // Skip files we can't read
            continue;
          }
        }
      }
    } catch {
      // Layer directory doesn't exist or can't be read
    }
  }

  /**
   * Extract element paths from YAML content
   * Looks for "path:" fields in the YAML
   */
  private extractElementPathsFromYAML(content: string, elementIds: Set<string>): void {
    // Simple YAML parsing: look for "path: value" patterns
    // This handles both quoted and unquoted values
    const pathPattern = /^\s*path:\s*["']?([^"'\n]+)["']?/gm;
    let match;

    while ((match = pathPattern.exec(content)) !== null) {
      const elementPath = match[1]?.trim();
      if (elementPath) {
        elementIds.add(elementPath);
      }
    }
  }

  /**
   * Validate qualified references against a resolved external model
   */
  private validateQualifiedReferencesAgainstModel(
    model: Model,
    modelName: string
  ): ValidationResult {
    const result = new ValidationResult();
    const resolvedModel = this.resolvedModels.get(modelName);

    if (!resolvedModel) {
      return result;
    }

    for (const [sourceLayerName, layer] of model.layers) {
      for (const element of layer.listElements()) {
        const elementId = element.path || element.id;

        for (const ref of element.references || []) {
          if (!ref.target.startsWith("@")) {
            continue;
          }

          try {
            const parsed = parseReferencePath(ref.target);
            if (parsed.modelName !== modelName) {
              continue;
            }

            // Check if target element exists in the resolved external model
            if (!resolvedModel.elementIds.has(parsed.segment)) {
              result.addError({
                layer: sourceLayerName,
                elementId,
                message: `Broken qualified reference: target '${parsed.segment}' does not exist in external model '${modelName}'`,
                category: "reference",
                fixSuggestion: `Create element '${parsed.segment}' in model '${modelName}' or remove this reference`,
              });
            }
          } catch (error) {
            // Parse errors are already handled by base validator
            continue;
          }
        }
      }
    }

    return result;
  }
}
