import { ValidationResult } from "./types.js";
import type { Model } from "../core/model.js";
import { Validator } from "./validator.js";
import { parseReferencePath, ReferencePathParseError } from "../utils/reference-path-parser.js";
import { getErrorMessage } from "../utils/errors.js";
import { promises as fs, Dirent } from "fs";
import path from "path";
import { parse as parseYAML } from "yaml";
import { FarmManifest } from "../core/farm-manifest.js";

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

  /**
   * Create a ComposedReferenceValidator from a farm root
   * Automatically builds model-path overrides from the farm's project entries
   * @param farmRoot - Path to the farm root directory
   * @returns ComposedReferenceValidator instance configured for the farm
   */
  static async fromFarm(farmRoot: string): Promise<ComposedReferenceValidator> {
    const farmYamlPath = path.join(farmRoot, "farm.yaml");
    const manifest = await FarmManifest.load(farmYamlPath);

    const modelPathOverrides: Record<string, string> = {};

    // Build model-path overrides for each project in the farm
    for (const project of manifest.getAllProjects()) {
      // For detached model layouts, point directly to the model folder.
      // The validator will look for manifest.yaml within this folder.
      // If the model is co-located (inside codebase), it will also find it
      // via the documentation-robotics/model/ path search.
      const modelFullPath = path.join(farmRoot, project.model_folder);
      modelPathOverrides[project.name] = modelFullPath;
    }

    return new ComposedReferenceValidator(modelPathOverrides);
  }

  async validateModel(model: Model): Promise<ValidationResult> {
    const fullValidator = new Validator();
    const result = await fullValidator.validateModel(model);

    const declaredModels = new Map<string, string>();
    // Map from lowercase model name to declared model name (preserving original casing)
    for (const modelName of Object.keys(model.manifest.models || {})) {
      declaredModels.set(modelName.toLowerCase(), modelName);
    }

    // Clear all state to ensure fresh validation on reuse
    this.referencedModels.clear();
    this.resolvedModels.clear();
    this.resolutionDiagnostics = new ValidationResult();
    this.collectReferencedModels(model);

    for (const declaredName of declaredModels.values()) {
      await this.resolveExternalModel(declaredName);
    }

    // Merge any diagnostics from resolution phase
    result.merge(this.resolutionDiagnostics);

    for (const [lowerModelName, declaredName] of declaredModels) {
      // Check if model is referenced using case-insensitive comparison
      const isReferenced = this.referencedModels.has(lowerModelName);
      // Check if model is resolved using the declared name
      const isResolved = this.resolvedModels.has(declaredName);

      if (!isResolved) {
        if (isReferenced) {
          // Declared, referenced, but unresolvable → error with guidance
          result.addError({
            layer: "manifest",
            message: `External model '${declaredName}' is referenced in qualified paths but could not be resolved from the configured paths`,
            category: "reference",
            fixSuggestion: `Ensure the model exists on disk, or use '--model-path ${declaredName}=/path/to/project-root' to specify its location`,
          });
        } else {
          // Declared but unreferenced and unresolvable → warning only
          result.addWarning({
            layer: "manifest",
            message: `External model '${declaredName}' is declared but not referenced in any qualified paths and could not be found on disk`,
            category: "reference",
            fixSuggestion: `Remove the declaration if not needed, or use '--model-path ${declaredName}=/path/to/project-root' to specify its location`,
          });
        }
      } else if (isReferenced) {
        // Declared, referenced, and resolvable → validate qualified references
        const validationResult = this.validateQualifiedReferencesAgainstModel(model, declaredName);
        result.merge(validationResult, `[Composed/${declaredName}]`);
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
                // Store lowercase for case-insensitive comparison with declared models
                this.referencedModels.add(parsed.modelName.toLowerCase());
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
    // Try exact match first, then case-insensitive match
    let modelPath = this.modelPathOverrides[modelName];
    if (!modelPath) {
      // Case-insensitive lookup in modelPathOverrides
      const lowerModelName = modelName.toLowerCase();
      for (const [key, overridePath] of Object.entries(this.modelPathOverrides)) {
        if (key.toLowerCase() === lowerModelName) {
          modelPath = overridePath;
          break;
        }
      }
    }

    if (!modelPath) {
      return;
    }

    try {
      // Verify modelPath itself is a directory
      const rootStats = await fs.stat(modelPath).catch(() => null);
      if (rootStats && !rootStats.isDirectory()) {
        this.resolutionDiagnostics.addWarning({
          layer: "manifest",
          message: `External model '${modelName}' path is not a directory: ${modelPath}`,
          category: "reference",
          fixSuggestion: `Ensure '--model-path ${modelName}=${modelPath}' points to a project root containing documentation-robotics/model/`,
        });
        return;
      }

      // Try standard layout first: {modelPath}/documentation-robotics/model/
      let modelDir = path.join(modelPath, "documentation-robotics", "model");
      let stats = await fs.stat(modelDir).catch(() => null);

      // Fall back to legacy layout: {modelPath}/model/
      if (!stats) {
        modelDir = path.join(modelPath, "model");
        stats = await fs.stat(modelDir).catch(() => null);
      }

      // Fall back to detached layout: modelPath itself is the model directory
      // (contains layer directories like 01_motivation, 07_api, etc.)
      if (!stats) {
        modelDir = modelPath;
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
            // Compare model names case-insensitively
            if (parsed.modelName?.toLowerCase() !== modelName.toLowerCase()) {
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
