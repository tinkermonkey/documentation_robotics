import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { Validator } from "./validator.js";
import { parseReferencePath, ReferencePathParseError } from "../utils/reference-path-parser.js";
import { getErrorMessage } from "../utils/errors.js";
import { promises as fs, Dirent } from "fs";
import path from "path";
import { parse as parseYAML } from "yaml";

interface ResolvedExternalModel {
  modelName: string;
  elementIds: Set<string>;
}

export class ComposedReferenceValidator {
  private modelPathOverrides: Record<string, string>;
  private resolvedModels: Map<string, ResolvedExternalModel> = new Map();
  private referencedModels: Set<string> = new Set();
  private resolutionDiagnostics: ValidationResult = new ValidationResult();

  constructor(modelPathOverrides: Record<string, string> = {}) {
    this.modelPathOverrides = modelPathOverrides;
  }

  async validateModel(model: Model): Promise<ValidationResult> {
    const fullValidator = new Validator();
    const result = await fullValidator.validateModel(model);

    const declaredModels = new Set(Object.keys(model.manifest.models || {}));

    // Clear all state to ensure fresh validation on reuse
    this.referencedModels.clear();
    this.resolvedModels.clear();
    this.resolutionDiagnostics = new ValidationResult();
    this.collectReferencedModels(model);

    for (const modelName of declaredModels) {
      await this.resolveExternalModel(modelName);
    }

    // Merge any diagnostics from resolution phase
    result.merge(this.resolutionDiagnostics);

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
            fixSuggestion: `Ensure the model exists on disk, or use '--model-path ${modelName}=/path/to/project-root' to specify its location`,
          });
        } else {
          // Declared but unreferenced and unresolvable → warning only
          result.addWarning({
            layer: "manifest",
            message: `External model '${modelName}' is declared but not referenced in any qualified paths and could not be found on disk`,
            category: "reference",
            fixSuggestion: `Remove the declaration if not needed, or use '--model-path ${modelName}=/path/to/project-root' to specify its location`,
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
            } catch (error) {
              if (error instanceof ReferencePathParseError) {
                // Parse errors are already handled by base validator
                continue;
              } else {
                throw error;
              }
            }
          }
        }
      }
    }
  }

  private async resolveExternalModel(modelName: string): Promise<void> {
    const modelPath = this.modelPathOverrides[modelName];

    if (!modelPath) {
      return;
    }

    try {
      // Try standard layout first: {modelPath}/documentation-robotics/model/
      let modelDir = path.join(modelPath, "documentation-robotics", "model");
      let stats = await fs.stat(modelDir).catch(() => null);

      // Fall back to legacy layout: {modelPath}/model/
      if (!stats) {
        modelDir = path.join(modelPath, "model");
        stats = await fs.stat(modelDir).catch(() => null);
      }

      if (!stats) {
        this.addResolutionDiagnostic(
          modelName,
          new Error("Model directory not found"),
          modelPath,
          true
        );
        return;
      }

      if (!stats.isDirectory()) {
        this.resolutionDiagnostics.addWarning({
          layer: "manifest",
          message: `External model '${modelName}' path is not a directory: ${modelDir}`,
          category: "reference",
          fixSuggestion: `Ensure '--model-path ${modelName}=${modelPath}' points to a project root or model directory`,
        });
        return;
      }

      const elementIds = new Set<string>();

      // Try to load all layer directories
      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(modelDir, { withFileTypes: true });
      } catch (error) {
        this.addResolutionDiagnostic(modelName, error, modelPath);
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
      this.addResolutionDiagnostic(modelName, error, modelPath);
    }
  }

  private async collectElementsFromLayer(layerPath: string, elementIds: Set<string>): Promise<void> {
    try {
      const entries = await fs.readdir(layerPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
          // Read the YAML file and extract element paths/IDs
          try {
            const content = await fs.readFile(path.join(layerPath, entry.name), "utf-8");
            this.extractElementPathsFromYAML(content, elementIds, layerPath, entry.name);
          } catch (error) {
            const filePath = path.join(layerPath, entry.name);
            this.resolutionDiagnostics.addWarning({
              layer: "manifest",
              message: `Failed to read YAML file at ${filePath}: ${getErrorMessage(error)}`,
              category: "reference",
            });
            continue;
          }
        }
      }
    } catch (error) {
      this.resolutionDiagnostics.addWarning({
        layer: "manifest",
        message: `Failed to read layer directory at ${layerPath}: ${getErrorMessage(error)}`,
        category: "reference",
      });
    }
  }

  private extractElementPathsFromYAML(
    content: string,
    elementIds: Set<string>,
    layerPath: string,
    fileName: string
  ): void {
    try {
      const parsed = parseYAML(content);

      if (!parsed) {
        this.resolutionDiagnostics.addWarning({
          layer: "manifest",
          message: `YAML file at ${path.join(layerPath, fileName)} parsed to empty content`,
          category: "reference",
        });
        return;
      }

      // Collect items to process from various YAML formats
      const items: unknown[] = [];

      // Format 1: elements: [{ path: "..." }, ...]
      if (parsed && typeof parsed === "object" && "elements" in parsed) {
        const elements = parsed.elements;
        if (Array.isArray(elements)) {
          items.push(...elements);
        }
      }
      // Format 2: Direct array [{ path: "..." }, ...]
      else if (Array.isArray(parsed)) {
        items.push(...parsed);
      }
      // Format 3: Object-of-objects { "key": { path: "..." }, ... }
      else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Check if this looks like an object-of-objects (values have path/id fields)
        const values = Object.values(parsed);
        if (values.length > 0 && values[0] && typeof values[0] === "object" && ("path" in values[0] || "id" in values[0])) {
          items.push(...values);
        } else {
          // Object without path/id fields, push as-is for type safety
          items.push(parsed);
        }
      }

      // Extract paths from collected items
      for (const item of items) {
        if (item && typeof item === "object") {
          const elementPath = (item as Record<string, unknown>).path || (item as Record<string, unknown>).id;
          if (elementPath && typeof elementPath === "string") {
            elementIds.add(elementPath.trim());
          }
        }
      }
    } catch (error) {
      this.resolutionDiagnostics.addWarning({
        layer: "manifest",
        message: `Failed to parse YAML file at ${path.join(layerPath, fileName)}: ${getErrorMessage(error)}`,
        category: "reference",
      });
    }
  }

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
            if (error instanceof ReferencePathParseError) {
              // Parse errors are already handled by base validator
              continue;
            } else {
              throw error;
            }
          }
        }
      }
    }

    return result;
  }

  private addResolutionDiagnostic(
    modelName: string,
    error: unknown,
    modelPath: string,
    isPathError: boolean = false
  ): void {
    const errorMsg = getErrorMessage(error);
    const code = (error as NodeJS.ErrnoException)?.code;

    let message = "";
    let fixSuggestion = "";

    if (code === "EACCES") {
      message =
        `Permission denied accessing external model '${modelName}' at ${modelPath}. ` +
        `Check file permissions.`;
      fixSuggestion = `Ensure the model path is readable, or use '--model-path ${modelName}=/path/to/alternative-location' to specify another location`;
    } else if (code === "EIO") {
      message =
        `I/O error reading external model '${modelName}' at ${modelPath}. ` +
        `There may be a filesystem or device issue.`;
      fixSuggestion = `Check the filesystem for errors, or provide an alternative model path via '--model-path ${modelName}=/path/to/alternative-location'`;
    } else if (code === "ENOENT" || isPathError) {
      message =
        `Could not find external model '${modelName}' — expected at ${modelPath}/documentation-robotics/model or ${modelPath}/model`;
      fixSuggestion = `Ensure the model exists at the specified path, or use '--model-path ${modelName}=/path/to/project-root' to specify its location`;
    } else {
      message =
        `Failed to resolve external model '${modelName}' at ${modelPath}: ${errorMsg}`;
      fixSuggestion = `Check the path and filesystem permissions, or use '--model-path ${modelName}=/path/to/project-root' to specify a different location`;
    }

    this.resolutionDiagnostics.addWarning({
      layer: "manifest",
      message,
      category: "reference",
      fixSuggestion,
    });
  }
}
