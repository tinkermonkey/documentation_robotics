/**
 * Scan command - initiate architecture model scanning via CodePrism MCP
 *
 * Usage:
 *   dr scan [options]
 *
 * Options:
 *   --config        Validate configuration without connecting to CodePrism
 *   --dry-run       Print candidates without creating a changeset
 *   --layer LAYER   Restrict scan to one layer
 *   --verbose       Show detailed scanning output
 *
 * Configuration location: ~/.dr-config.yaml (scan section)
 *
 * Example config:
 *   scan:
 *     codeprism:
 *       command: codeprism
 *       args: ["--mcp"]
 *       timeout: 5000
 *     confidence_threshold: 0.7
 */

import ansis from "ansis";
import { Command } from "commander";
import { createMcpClient, validateConnection, disconnectMcpClient, type MCPClient } from "../scan/mcp-client.js";
import { loadScanConfig } from "../scan/config.js";
import { loadBuiltinPatterns, loadProjectPatterns, mergePatterns, filterByConfidence, renderTemplate, isValidRelationshipDirection, type PatternDefinition, type PatternSet, type ElementCandidate, type RelationshipCandidate } from "../scan/pattern-loader.js";
import { buildScanIndex, saveScanIndex, loadScanIndex, isIndexFresh } from "../scan/index-builder.js";
import { LAYER_MAP, isValidLayerName, CANONICAL_LAYER_NAMES, extractLayerFromId } from "../core/layers.js";
import { getErrorMessage, handleError, CLIError, ErrorCategory } from "../utils/errors.js";
import { Model } from "../core/model.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { RelationshipInferenceEngine } from "../scan/relationship-inference.js";

export interface ScanOptions {
  config?: boolean;
  dryRun?: boolean;
  layer?: string;
  verbose?: boolean;
}

/**
 * Options for the scan index command
 */
export interface ScanIndexOptions {
  workspace?: string;
  output?: string;
  verbose?: boolean;
}

/**
 * Parse a line number string safely, validating the result
 *
 * @param lineStr - Line number as string or undefined
 * @returns Valid line number or undefined if parsing fails
 */
export function parseLineNumber(lineStr?: string): number | undefined {
  if (!lineStr) {
    return undefined;
  }
  const parsed = parseInt(lineStr, 10);
  // Return undefined if parse produced NaN or invalid number
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Derive relationship candidate ID from source, target, and relationship type
 *
 * @param sourceId - Source element ID
 * @param relationshipType - Relationship predicate type
 * @param targetId - Target element ID
 * @returns Relationship ID in format "sourceId::relationshipType::targetId"
 */
export function deriveRelationshipId(sourceId: string, relationshipType: string, targetId: string): string {
  return `${sourceId}::${relationshipType}::${targetId}`;
}

/**
 * Filter pattern sets by removing those whose framework appears in disabled_patterns list
 *
 * @param patterns - Pattern sets to filter
 * @param disabledPatterns - List of framework names to disable
 * @returns Pattern sets after removing disabled frameworks
 */
export function filterDisabledPatterns(patterns: PatternSet[], disabledPatterns?: string[]): PatternSet[] {
  if (!disabledPatterns || disabledPatterns.length === 0) {
    return patterns;
  }

  return patterns.filter((patternSet) => !disabledPatterns.includes(patternSet.framework));
}

/**
 * Expand wildcard element IDs to concrete element IDs
 *
 * Wildcards (e.g., "api.endpoint.*") are resolved against available elements.
 * Pattern: "{layer}.{elementType}.*" matches any element of that type in that layer.
 *
 * When a wildcard is provided but no matching elements are found, returns an empty array
 * rather than the unresolved wildcard, allowing the relationship candidate to be skipped.
 *
 * @param elementId - Element ID that may contain a wildcard
 * @param availableElements - Elements to match against (from model and candidates)
 * @param warnings - Array to collect warning messages
 * @returns Array of concrete element IDs matching the wildcard, or empty array if wildcard matches nothing
 */
export function expandWildcardElementId(elementId: string, availableElements: Array<{ id: string }>, warnings?: string[]): string[] {
  // Check if elementId contains a wildcard
  if (!elementId.includes("*")) {
    return [elementId];
  }

  // Parse the wildcard pattern: "{layer}.{elementType}.*"
  const parts = elementId.split(".");
  if (parts.length < 3 || parts[parts.length - 1] !== "*") {
    // Invalid wildcard format - not a valid wildcard pattern
    if (warnings) {
      warnings.push(
        `Invalid wildcard pattern: '${elementId}'. ` +
        `Wildcard patterns must be in the format: 'layer.elementType.*' ` +
        `(e.g., 'api.endpoint.*'). This relationship will be skipped.`
      );
    }
    return [];
  }

  const targetLayer = parts[0];
  const targetElementType = parts[1];

  // Match against available elements
  const matched = availableElements.filter((elem) => {
    const elemParts = elem.id.split(".");
    return elemParts.length >= 3 && elemParts[0] === targetLayer && elemParts[1] === targetElementType;
  });

  // Warn if valid wildcard pattern matches zero elements
  if (matched.length === 0) {
    if (warnings) {
      warnings.push(
        `Wildcard pattern '${elementId}' matched zero elements. ` +
        `No elements found in layer '${targetLayer}' with type '${targetElementType}'. ` +
        `This relationship will be skipped.`
      );
    }
  }

  // Return matched elements, or empty array if no matches (allows candidate to be skipped)
  return matched.map((e) => e.id);
}

/**
 * Execute the scan index command
 *
 * Runs CodePrism's three orientation tools and persists the results as a scan index.
 * The index provides repository context for subsequent scan operations.
 *
 * @param options - Command options
 */
export async function scanIndexCommand(options: ScanIndexOptions): Promise<void> {
  let client: MCPClient | null = null;

  try {
    // Determine workspace path
    const workspace = options.workspace || process.cwd();

    // Load scan configuration
    const config = await loadScanConfig();

    console.log("Initializing CodePrism connection for indexing...");
    client = await createMcpClient(config);

    // Validate connection to CodePrism server
    console.log("Validating CodePrism server connection...");
    await validateConnection(client);

    console.log(ansis.green("✓ Connected to CodePrism"));

    // Build the scan index
    console.log("\nRunning repository analysis...");
    console.log("  • Analyzing repository structure and statistics");
    console.log("  • Detecting architectural patterns");
    console.log("  • Suggesting analysis workflow");

    const index = await buildScanIndex(client, workspace);

    // Save the index
    console.log("\nSaving scan index...");
    await saveScanIndex(index, workspace);

    // Print summary
    console.log(ansis.green("\n✓ Scan index created successfully"));
    console.log(`  Index timestamp: ${index.indexed_at}`);
    console.log(`  Repository files: ${index.repository.total_files}`);
    console.log(`  Languages: ${index.repository.languages.join(", ")}`);
    if (index.repository.primary_language) {
      console.log(`  Primary language: ${index.repository.primary_language}`);
    }
    console.log(`  Frameworks: ${index.repository.frameworks.join(", ")}`);

    if (options.verbose) {
      console.log(`\nDetected patterns:`);
      const categories = Object.entries(index.detected_patterns);
      for (const [category, patterns] of categories) {
        if (patterns.length > 0) {
          console.log(`  ${category}:`);
          for (const pattern of patterns) {
            console.log(`    • ${pattern.name} (${(pattern.confidence * 100).toFixed(0)}%)`);
          }
        }
      }

      console.log(`\nSuggested workflow:`);
      console.log(`  Tools: ${index.suggested_workflow.recommended_tools.join(", ")}`);
      console.log(`  Rationale: ${index.suggested_workflow.rationale}`);
    }

    console.log(`\nIndex saved to: ${options.workspace ? options.output : "documentation-robotics/scan-index.json"}`);
  } catch (error) {
    handleError(error);
  } finally {
    // Always disconnect MCP client
    if (client) {
      try {
        await disconnectMcpClient(client);
      } catch (error) {
        console.warn(ansis.yellow(`⚠ Warning: Failed to disconnect from CodePrism: ${getErrorMessage(error)}`));
      }
    }
  }
}

/**
 * Execute the scan command
 *
 * @param options - Command options
 */
export async function scanCommand(options: ScanOptions): Promise<void> {
  const warnings: string[] = [];
  let client: MCPClient | null = null;

  try {
    // Validate layer name first, before any other operations
    if (options.layer) {
      if (!isValidLayerName(options.layer)) {
        throw new CLIError(
          `Invalid layer name: '${options.layer}'`,
          ErrorCategory.USER,
          [`Valid layers are: ${CANONICAL_LAYER_NAMES.join(", ")}`]
        );
      }
    }

    // Load scan configuration
    const config = await loadScanConfig();

    // If --config flag is set, just validate configuration loaded successfully
    if (options.config) {
      console.log(ansis.green("✓ Configuration loaded successfully"));
      console.log(`  CodePrism command: ${config.codeprism.command}`);
      console.log(`  Confidence threshold: ${config.confidence_threshold}`);
      return;
    }

    // Create MCP client (validates binary is available)
    console.log("Initializing CodePrism connection...");
    client = await createMcpClient(config);

    // Validate connection to CodePrism server
    console.log("Validating CodePrism server connection...");
    await validateConnection(client);

    console.log(ansis.green("✓ Connected to CodePrism"));
    console.log(`  Endpoint: ${client.endpoint}`);
    console.log(`  Confidence threshold: ${config.confidence_threshold}`);

    // Check for fresh scan index
    try {
      const loadedIndex = await loadScanIndex(process.cwd());
      if (loadedIndex) {
        const indexFresh = await isIndexFresh(loadedIndex, process.cwd());
        if (indexFresh) {
          console.log(ansis.cyan(`\n✓ Using cached repository index from ${loadedIndex.indexed_at}`));
          console.log(`  Repository has ${loadedIndex.repository.total_files} files in ${loadedIndex.repository.languages.join(", ")}`);
        } else {
          console.log(ansis.yellow(`\n⚠ Repository index is stale (source files newer than ${loadedIndex.indexed_at})`));
          console.log(`  Recommend refreshing with: dr scan index`);
        }
      }
    } catch (error) {
      // Log warning but continue - index loading failure shouldn't stop scan
      warnings.push(`Failed to check index freshness: ${getErrorMessage(error)}`);
    }

    // Load built-in and project patterns
    console.log("\nLoading pattern library...");
    const builtinPatterns = await loadBuiltinPatterns();
    const projectPatterns = await loadProjectPatterns(process.cwd());
    const mergedPatterns = mergePatterns(builtinPatterns, projectPatterns);

    // Apply disabled patterns filter
    const allPatterns = filterDisabledPatterns(mergedPatterns, config.disabled_patterns);

    console.log(ansis.green(`✓ Loaded ${allPatterns.length} pattern sets`));

    // Count total patterns
    const totalPatterns = allPatterns.reduce((sum, set) => sum + set.patterns.length, 0);
    console.log(`  Total patterns: ${totalPatterns}`);

    // Report disabled patterns if any
    if (config.disabled_patterns.length > 0) {
      console.log(`  Disabled frameworks: ${config.disabled_patterns.join(", ")}`);
    }

    // Apply layer filter if specified
    let patternsToExecute = allPatterns;
    if (options.layer) {
      patternsToExecute = allPatterns.filter((set) => set.layer === options.layer);
      console.log(`  Filtered to layer '${options.layer}': ${patternsToExecute.reduce((sum, set) => sum + set.patterns.length, 0)} patterns`);
    }

    // Display framework coverage
    const frameworks = [...new Set(patternsToExecute.map((p) => p.framework))].sort();
    console.log(`  Frameworks: ${frameworks.join(", ")}`);

    // Execute patterns and collect candidates
    console.log("\nScanning codebase...");
    const { elementCandidates, relationshipCandidates } = await executePatterns(client, patternsToExecute, config.confidence_threshold ?? 0.7, warnings, options.verbose || false);

    // Apply relationship inference engine to derive implicit relationships
    if (options.verbose) {
      console.log("\nApplying relationship inference engine...");
    }

    const inferenceContext = {
      elements: new Map(elementCandidates.map((el) => [el.id, el])),
      existingRelationships: relationshipCandidates,
    };

    const inferenceEngine = new RelationshipInferenceEngine(inferenceContext);
    const inferredRelationships = inferenceEngine.inferRelationships();

    if (options.verbose) {
      console.log(`  Inferred ${inferredRelationships.length} relationships from patterns`);
    }

    // Filter inferred relationships by confidence threshold (same threshold applied to pattern-extracted relationships)
    const confidenceThreshold = config.confidence_threshold ?? 0.7;
    const filteredInferredRelationships = filterByConfidence(inferredRelationships, confidenceThreshold);

    if (options.verbose && filteredInferredRelationships.length < inferredRelationships.length) {
      console.log(`  ${inferredRelationships.length - filteredInferredRelationships.length} inferred relationships filtered by confidence threshold`);
    }

    // Merge inferred relationships with pattern-extracted ones
    relationshipCandidates.push(...filteredInferredRelationships);

    // Load current model for deduplication
    let model: Model | null = null;
    try {
      model = await Model.load(process.cwd());
    } catch (error) {
      const modelLoadError = `Could not load existing model: ${getErrorMessage(error)}. Deduplication will be skipped and all candidates will be staged, including potential duplicates. Additionally, wildcard expansion in relationships will be limited to newly-discovered candidates only.`;
      warnings.push(modelLoadError);
    }

    // Deduplicate element candidates against current model
    const newElementCandidates = elementCandidates.filter((candidate) => {
      if (!model) return true; // Keep all if no model
      const element = model.getElementById(candidate.id);
      if (element) {
        if (options.verbose) {
          console.log(`  Skipping duplicate element: ${candidate.id}`);
        }
        return false;
      }
      return true;
    });

    // Expand wildcards and validate relationship candidates
    const expandedRelationshipCandidates: RelationshipCandidate[] = [];

    // Collect all available elements from model and new candidates
    const allAvailableElements: Array<{ id: string }> = [];
    if (model) {
      for (const layer of model.layers.values()) {
        for (const element of layer.elements.values()) {
          allAvailableElements.push({ id: element.id });
        }
      }
    }
    allAvailableElements.push(...newElementCandidates);

    // Track relationship keys already added to avoid duplicates among expanded candidates
    const addedRelationshipKeys = new Set<string>();

    for (const candidate of relationshipCandidates) {
      // Expand wildcards in source and target
      const sourceIds = expandWildcardElementId(candidate.sourceId, allAvailableElements, warnings);
      const targetIds = expandWildcardElementId(candidate.targetId, allAvailableElements, warnings);

      // Skip this candidate if wildcard expansion produces no matches
      if (sourceIds.length === 0 || targetIds.length === 0) {
        continue;
      }

      // Create expanded candidates for each source-target combination
      for (const sourceId of sourceIds) {
        for (const targetId of targetIds) {
          const expandedCandidate: RelationshipCandidate = {
            ...candidate,
            sourceId,
            targetId,
            id: deriveRelationshipId(sourceId, candidate.relationshipType, targetId),
          };

          // Check cross-layer direction rule
          if (!isValidRelationshipDirection(expandedCandidate.sourceId, expandedCandidate.targetId)) {
            warnings.push(
              `Relationship violates direction rule: ${expandedCandidate.sourceId} → ${expandedCandidate.targetId}. ` +
              `Cross-layer relationships must go from higher-numbered layers to lower-numbered layers (e.g., api[6] → application[4]). ` +
              `Same-layer relationships are always allowed.`
            );
            continue;
          }

          // Check if source element exists
          const sourceExists = model?.getElementById(expandedCandidate.sourceId) !== undefined ||
                             newElementCandidates.some((e) => e.id === expandedCandidate.sourceId);
          if (!sourceExists) {
            warnings.push(
              `Relationship references missing source element: ${expandedCandidate.sourceId}`
            );
            continue;
          }

          // Check if target element exists
          const targetExists = model?.getElementById(expandedCandidate.targetId) !== undefined ||
                             newElementCandidates.some((e) => e.id === expandedCandidate.targetId);
          if (!targetExists) {
            warnings.push(
              `Relationship references missing target element: ${expandedCandidate.targetId}`
            );
            continue;
          }

          // Check for duplicates in existing model
          if (model) {
            const existing = model.relationships.find(
              expandedCandidate.sourceId,
              expandedCandidate.targetId,
              expandedCandidate.relationshipType
            );
            if (existing && existing.length > 0) {
              if (options.verbose) {
                console.log(
                  `  Skipping duplicate relationship: ${expandedCandidate.sourceId} → ${expandedCandidate.targetId}`
                );
              }
              continue;
            }
          }

          // Check for duplicates among expanded candidates in this scan
          const relationshipKey = `${expandedCandidate.sourceId}|${expandedCandidate.targetId}|${expandedCandidate.relationshipType}`;
          if (addedRelationshipKeys.has(relationshipKey)) {
            if (options.verbose) {
              console.log(
                `  Skipping duplicate expanded relationship: ${expandedCandidate.sourceId} → ${expandedCandidate.targetId}`
              );
            }
            continue;
          }

          addedRelationshipKeys.add(relationshipKey);
          expandedRelationshipCandidates.push(expandedCandidate);
        }
      }
    }

    // If dry-run, print candidates and exit (with cleanup)
    if (options.dryRun) {
      console.log(ansis.green(`\n✓ Found ${newElementCandidates.length} element candidates and ${expandedRelationshipCandidates.length} relationship candidates (dry-run mode):\n`));
      if (newElementCandidates.length > 0) {
        console.log("Elements:");
        printCandidatesTable(newElementCandidates);
      }
      if (expandedRelationshipCandidates.length > 0) {
        console.log("\nRelationships:");
        printRelationshipCandidatesTable(expandedRelationshipCandidates);
      }
      return; // Exit cleanly - finally block will run for cleanup
    }

    // Stage changeset with candidates
    let scanSucceeded = true;
    if (newElementCandidates.length > 0 || expandedRelationshipCandidates.length > 0) {
      console.log(`\nStaging ${newElementCandidates.length} elements and ${expandedRelationshipCandidates.length} relationships as changeset...`);
      const stageResult = await stageChangeset(newElementCandidates, expandedRelationshipCandidates, process.cwd());
      // Add any staging failures to warnings for display in summary
      warnings.push(...stageResult.warnings);

      // Report success or failure based on whether changeset was saved
      if (stageResult.changesetSaved) {
        console.log(ansis.green(`✓ Changeset staged successfully`));
      } else {
        console.log(ansis.red(`✗ Failed to stage changeset: no valid candidates`));
        scanSucceeded = false;
      }
    } else {
      console.log(ansis.yellow(`\n⚠ No new candidates found`));
    }

    // Print summary - only show success if scan actually succeeded
    if (scanSucceeded) {
      console.log(ansis.green("\n✓ Scan complete"));
    } else {
      console.log(ansis.red("\n✗ Scan failed: no candidates were staged"));
    }
    console.log(`  Patterns scanned: ${patternsToExecute.reduce((sum, set) => sum + set.patterns.length, 0)}`);
    console.log(`  Element candidates found: ${elementCandidates.length}`);
    console.log(`  Element candidates deduplicated: ${elementCandidates.length - newElementCandidates.length}`);
    console.log(`  New element candidates: ${newElementCandidates.length}`);
    console.log(`  Relationship candidates found: ${relationshipCandidates.length}`);
    console.log(`  Valid relationships staged: ${expandedRelationshipCandidates.length}`);
    if (scanSucceeded) {
      console.log(`  Elements staged: ${newElementCandidates.length}`);
      console.log(`  Relationships staged: ${expandedRelationshipCandidates.length}`);
    }

    // Print warnings at the end (all warnings displayed, not just in verbose mode)
    if (warnings.length > 0) {
      console.log(ansis.yellow("\n⚠ Warnings:"));
      for (const warning of warnings) {
        console.log(`  • ${warning}`);
      }
    }
  } catch (error) {
    handleError(error);
  } finally {
    // Always disconnect MCP client
    if (client) {
      try {
        await disconnectMcpClient(client);
      } catch (error) {
        // Disconnect errors should always be reported to prevent silent zombie processes.
        // Even though the command completes, zombie processes could accumulate across
        // multiple scan invocations if disconnection failures go unnoticed.
        console.warn(ansis.yellow(`⚠ Warning: Failed to disconnect from CodePrism: ${getErrorMessage(error)}`));
        if (options.verbose) {
          // In verbose mode, provide additional context about potential process cleanup
          console.warn("  The CodePrism process may still be running. You may need to terminate it manually.");
        }
      }
    }
  }
}

/**
 * Execute all patterns and collect element and relationship candidates
 *
 * FR-1: Pattern Execution Engine Implementation
 *
 * Invokes each pattern's CodePrism query tool via MCP and maps results to DR candidates.
 * This is the core functional requirement that was previously a hardcoded stub.
 *
 * @param client - MCP client for tool invocation
 * @param patterns - Pattern sets to execute
 * @param threshold - Confidence threshold
 * @param warnings - Array to collect warnings
 * @param verbose - Show detailed output
 * @returns Object containing elementCandidates and relationshipCandidates arrays
 */
export async function executePatterns(
  client: MCPClient,
  patterns: PatternSet[],
  threshold: number,
  warnings: string[],
  verbose: boolean
): Promise<{ elementCandidates: ElementCandidate[]; relationshipCandidates: RelationshipCandidate[] }> {
  const elementCandidates: ElementCandidate[] = [];
  const relationshipCandidates: RelationshipCandidate[] = [];

  for (const patternSet of patterns) {
    for (const pattern of patternSet.patterns) {
      if (verbose) {
        console.log(`  Executing pattern: ${pattern.id}`);
      }

      // Invoke the pattern's CodePrism tool via MCP
      const toolName = pattern.query.tool;
      const toolParams = pattern.query.params || {};

      if (verbose) {
        console.log(`    Tool: ${toolName}`);
        console.log(`    Params: ${JSON.stringify(toolParams)}`);
      }

      // Call the tool via MCP client. Transport/infrastructure errors are thrown
      // (connection lost, server crash) and will bubble up to fail the entire scan.
      // Tool-level errors (tool runs but fails) are returned as ToolResult with type: "error"
      // and can be handled gracefully.
      const results = await client.callTool(toolName, toolParams);

      // Parse results - each result should be parseable JSON containing match data
      const matches: Array<{ [key: string]: string }> = [];
      for (const result of results) {
        if (result.type === "error") {
          // Tool-level errors (tool ran but failed) are logged as warnings.
          // These are recoverable; we can continue with remaining patterns.
          // Always log tool errors as warnings, not just in verbose mode.
          // Tool failures should be visible to the user regardless of verbosity.
          warnings.push(`Tool '${toolName}' returned error: ${result.text}`);
          if (verbose) {
            console.log(`    Warning: Tool returned error: ${result.text}`);
          }
          continue;
        }

        if (result.type === "text" && result.text) {
          try {
            // Attempt to parse as JSON array of matches
            const parsed = JSON.parse(result.text);
            if (Array.isArray(parsed)) {
              matches.push(...parsed);
            } else if (typeof parsed === "object" && parsed !== null) {
              // Single match object
              matches.push(parsed);
            }
          } catch (parseError) {
            // If not JSON, treat the text as unparseable tool output.
            // Always add to warnings so user knows tool ran but output couldn't be interpreted.
            const parseMsg = `Could not parse tool result as JSON: ${result.text.slice(0, 100)}`;
            warnings.push(parseMsg);
          }
        }
      }

      if (verbose) {
        console.log(`    Found ${matches.length} matches`);
      }

      // Map matches to candidates based on pattern produces type
      // Wrap each match individually so one error doesn't break the entire pattern
      let matchErrorCount = 0;
      for (const match of matches) {
        try {
          if (pattern.produces.type === "relationship") {
            const candidate = mapToRelationshipCandidate(pattern, match, warnings);
            if (candidate) {
              relationshipCandidates.push(candidate);
            }
          } else {
            const candidate = mapToElementCandidate(pattern, match, warnings);
            if (candidate) {
              elementCandidates.push(candidate);
            }
          }
        } catch (matchError) {
          // Unexpected errors during match processing (programming errors, not expected validation errors)
          // Tracked as warnings to preserve partial results and report issues to the user
          const errorMsg = getErrorMessage(matchError);
          const errorDetail = `Pattern '${pattern.id}' encountered unexpected error processing match: ${errorMsg}`;
          warnings.push(errorDetail);
          matchErrorCount++;
        }
      }
      if (matchErrorCount > 0 && verbose) {
        console.log(`    ${matchErrorCount} match(es) failed due to unexpected errors`);
      }
    }
  }

  // Filter by confidence
  const filteredElements = filterByConfidence(elementCandidates, threshold);
  const filteredRelationships = filterByConfidence(relationshipCandidates, threshold);

  return { elementCandidates: filteredElements, relationshipCandidates: filteredRelationships };
}

/**
 * Map a pattern match to an element candidate
 *
 * @param pattern - Pattern definition
 * @param match - Match data from CodePrism
 * @param warnings - Array to collect mapping errors as warnings
 * @returns Element candidate or null if mapping fails
 */
export function mapToElementCandidate(
  pattern: PatternDefinition,
  match: Record<string, string>,
  warnings: string[]
): ElementCandidate | null {
  try {
    // Get ID template from mapping - must be a string (not nested object)
    let idTemplate: string | undefined;
    const idValue = pattern.mapping["id"];
    if (typeof idValue === "string") {
      idTemplate = idValue;
    }
    if (!idTemplate) {
      idTemplate = `${pattern.produces.layer}.${pattern.produces.elementType}.{match.name|kebab}`;
    }
    const id = renderTemplate(idTemplate, { match });

    // Get name template from mapping - must be a string (not nested object)
    let nameTemplate: string | undefined;
    const nameValue = pattern.mapping["name"];
    if (typeof nameValue === "string") {
      nameTemplate = nameValue;
    }
    if (!nameTemplate) {
      nameTemplate = "{match.name}";
    }
    const name = renderTemplate(nameTemplate, { match });

    // Collect other attributes from mapping
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(pattern.mapping)) {
      if (key === "id" || key === "name") continue;
      if (typeof value === "string") {
        attributes[key] = renderTemplate(value, { match });
      }
    }

    const lineNumber = parseLineNumber(match.line);
    return {
      id,
      type: pattern.produces.elementType,
      layer: pattern.produces.layer,
      name,
      confidence: pattern.confidence,
      attributes,
      source: match.file ? { file: match.file, ...(lineNumber !== undefined && { line: lineNumber }) } : undefined,
    };
  } catch (error) {
    // Log mapping error as warning so users know matches were received but couldn't be processed
    const errorMsg = getErrorMessage(error);
    warnings.push(`Pattern '${pattern.id}' failed to map element candidate: ${errorMsg}`);
    return null;
  }
}

/**
 * Map a pattern match to a relationship candidate
 *
 * Relationship patterns must produce fully-qualified element IDs (format: layer.elementType.name).
 * Bare names (e.g., "user-service") are NOT supported because we cannot reliably infer both the
 * target layer and element type from a bare name alone. Pattern writers should use templates like:
 * - source: "api.endpoint.{match.endpointName|kebab}"
 * - target: "application.service.{match.serviceName|kebab}"
 *
 * Wildcard patterns (e.g., "api.endpoint.*") are handled separately during wildcard expansion
 * in the scan command and are valid for both source and target.
 *
 * @param pattern - Relationship pattern definition
 * @param match - Match data from CodePrism
 * @param warnings - Array to collect mapping errors as warnings
 * @returns Relationship candidate or null if mapping fails
 */
export function mapToRelationshipCandidate(
  pattern: PatternDefinition,
  match: Record<string, string>,
  warnings: string[]
): RelationshipCandidate | null {
  try {
    // Type guard: this function should only be called with relationship patterns
    if (pattern.produces.type !== "relationship") {
      throw new Error("mapToRelationshipCandidate called with non-relationship pattern");
    }

    // Get sourceId template from mapping - support both "source" and "sourceId" keys
    let sourceIdTemplate: string | undefined;
    const sourceIdValue = pattern.mapping["sourceId"] || pattern.mapping["source"];
    if (typeof sourceIdValue === "string") {
      sourceIdTemplate = sourceIdValue;
    }
    if (!sourceIdTemplate) {
      throw new Error("Relationship pattern must define 'source' or 'sourceId' in mapping");
    }
    let sourceId = renderTemplate(sourceIdTemplate, { match });

    // Get targetId template from mapping - support both "target" and "targetId" keys
    let targetIdTemplate: string | undefined;
    const targetIdValue = pattern.mapping["targetId"] || pattern.mapping["target"];
    if (typeof targetIdValue === "string") {
      targetIdTemplate = targetIdValue;
    }
    if (!targetIdTemplate) {
      throw new Error("Relationship pattern must define 'target' or 'targetId' in mapping");
    }
    let targetId = renderTemplate(targetIdTemplate, { match });

    // Get relationshipType from pattern definition
    const relationshipType = pattern.produces.relationshipType;
    if (!relationshipType) {
      throw new Error("Relationship pattern must define 'relationshipType' in produces");
    }

    // Extract source layer from source element ID (validation occurs here)
    const sourceLayer = extractLayerFromId(sourceId);
    if (!sourceLayer) {
      throw new Error(
        `Invalid source element ID format: '${sourceId}'. ` +
        `Relationship patterns must produce fully-qualified element IDs in the format: ` +
        `'layer.elementType.element-name' (e.g., 'api.endpoint.get-users'). ` +
        `Valid layers are: ${Object.keys(LAYER_MAP).join(", ")}`
      );
    }

    // Extract target layer from target element ID (validation occurs here)
    const targetLayer = extractLayerFromId(targetId);
    if (!targetLayer) {
      throw new Error(
        `Invalid target element ID format: '${targetId}'. ` +
        `Relationship patterns must produce fully-qualified element IDs in the format: ` +
        `'layer.elementType.element-name' (e.g., 'application.service.user-service'). ` +
        `Valid layers are: ${Object.keys(LAYER_MAP).join(", ")}`
      );
    }

    // Create relationship candidate ID using derivation helper
    const id = deriveRelationshipId(sourceId, relationshipType, targetId);

    // Collect attributes from mapping (excluding source, target, sourceId, and targetId)
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pattern.mapping)) {
      if (key === "source" || key === "target" || key === "sourceId" || key === "targetId") continue;
      if (typeof value === "string") {
        attributes[key] = renderTemplate(value, { match });
      }
    }

    const lineNumber = parseLineNumber(match.line);
    return {
      id,
      relationshipType,
      sourceId,
      targetId,
      layer: sourceLayer,
      confidence: pattern.confidence,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      source: match.file ? { file: match.file, ...(lineNumber !== undefined && { line: lineNumber }) } : undefined,
    };
  } catch (error) {
    // Log mapping error as warning so users know matches were received but couldn't be processed
    const errorMsg = getErrorMessage(error);
    warnings.push(
      `Pattern '${pattern.id}' mapping error: ${errorMsg}. ` +
      `This relationship candidate will be skipped. Review the pattern's 'source' and 'target' mappings ` +
      `to ensure they render to fully-qualified element IDs in the format: 'layer.elementType.element-name' ` +
      `(e.g., 'api.endpoint.get-users', 'application.service.user-service').`
    );
    return null;
  }
}

/**
 * Print element candidates as a table
 *
 * @param candidates - Candidates to print
 */
export function printCandidatesTable(candidates: ElementCandidate[]): void {
  if (candidates.length === 0) {
    console.log("No candidates to display");
    return;
  }

  // Print header
  console.log(`${"ID".padEnd(50)} ${"Layer".padEnd(15)} ${"Type".padEnd(20)} ${"Confidence".padEnd(12)}`);
  console.log("-".repeat(97));

  // Print rows
  for (const candidate of candidates) {
    const idTruncated = candidate.id.length > 50 ? candidate.id.slice(0, 47) + "..." : candidate.id;
    const confidence = (candidate.confidence * 100).toFixed(0) + "%";
    console.log(`${idTruncated.padEnd(50)} ${candidate.layer.padEnd(15)} ${candidate.type.padEnd(20)} ${confidence.padEnd(12)}`);
  }
}

/**
 * Print relationship candidates as a table
 *
 * @param candidates - Relationship candidates to print
 */
export function printRelationshipCandidatesTable(candidates: RelationshipCandidate[]): void {
  if (candidates.length === 0) {
    console.log("No relationship candidates to display");
    return;
  }

  // Print header
  console.log(`${"Source ID".padEnd(35)} ${"Target ID".padEnd(35)} ${"Type".padEnd(20)} ${"Confidence".padEnd(12)}`);
  console.log("-".repeat(102));

  // Print rows
  for (const candidate of candidates) {
    const sourceTruncated = candidate.sourceId.length > 35 ? candidate.sourceId.slice(0, 32) + "..." : candidate.sourceId;
    const targetTruncated = candidate.targetId.length > 35 ? candidate.targetId.slice(0, 32) + "..." : candidate.targetId;
    const confidence = (candidate.confidence * 100).toFixed(0) + "%";
    console.log(`${sourceTruncated.padEnd(35)} ${targetTruncated.padEnd(35)} ${candidate.relationshipType.padEnd(20)} ${confidence.padEnd(12)}`);
  }
}

/**
 * Stage candidates as a changeset
 *
 * Stages both element and relationship candidates with proper ordering:
 * - All element 'add' operations first
 * - All relationship 'relationship-add' operations second
 *
 * This ensures elements exist before relationships reference them.
 *
 * Partial success is preserved: if some candidates fail to stage, the changeset
 * is still saved with the successful candidates, and failures are returned as warnings.
 *
 * @param elementCandidates - Element candidates to stage
 * @param relationshipCandidates - Relationship candidates to stage
 * @param workdir - Working directory for changeset storage
 * @returns Object with warnings array and whether changeset was saved
 */
export async function stageChangeset(
  elementCandidates: ElementCandidate[],
  relationshipCandidates: RelationshipCandidate[],
  workdir: string
): Promise<{ warnings: string[]; changesetSaved: boolean }> {
  const storage = new StagedChangesetStorage(workdir);
  const changesetId = `scan-${Date.now()}`;
  const totalItems = elementCandidates.length + relationshipCandidates.length;
  const changeset = await storage.create(
    changesetId,
    `Scan Results - ${new Date().toLocaleString()}`,
    `${totalItems} items (${elementCandidates.length} elements, ${relationshipCandidates.length} relationships) found by architecture scan`,
    "current"
  );

  // Track failed candidates so partial success is still saved
  const failedElements: string[] = [];
  const failedRelationships: string[] = [];

  // First: Add all element candidates as 'add' operations
  for (const candidate of elementCandidates) {
    try {
      // Extract layer name from full layer ID
      const layerName = candidate.layer;

      // Create element data matching spec-node format
      const elementData = {
        id: candidate.id,
        type: candidate.type,
        name: candidate.name,
        layer_id: layerName,
        spec_node_id: candidate.type, // Use type as spec_node_id
        path: candidate.id.replace(/\./g, "/"),
        attributes: candidate.attributes,
        ...(candidate.source && { source_reference: candidate.source }),
      };

      changeset.addChange("add", candidate.id, layerName, undefined, elementData);
    } catch (error) {
      // Track failed element but continue processing others
      failedElements.push(`${candidate.id}: ${getErrorMessage(error)}`);
    }
  }

  // Second: Add all relationship candidates as 'relationship-add' operations
  for (const candidate of relationshipCandidates) {
    try {
      // Create relationship data
      const relationshipData = {
        source: candidate.sourceId,
        target: candidate.targetId,
        predicate: candidate.relationshipType,
        layer: candidate.layer,
        category: candidate.attributes?.category || "structural",
        ...(candidate.attributes && { properties: candidate.attributes }),
        ...(candidate.source && { source_reference: candidate.source }),
      };

      // Use candidate ID directly (already in persistence format: source::predicate::target)
      changeset.addChange("relationship-add", candidate.id, candidate.layer, undefined, relationshipData);
    } catch (error) {
      // Track failed relationship but continue processing others
      failedRelationships.push(`${candidate.sourceId} → ${candidate.targetId}: ${getErrorMessage(error)}`);
    }
  }

  // Save changeset only if it has changes; partial success is preserved
  const warnings: string[] = [];
  let changesetSaved = false;
  if (changeset.changes.length > 0) {
    await storage.save(changeset);
    changesetSaved = true;
  } else {
    // All candidates failed to stage - report this as a critical issue
    warnings.push(`Failed to stage any candidates. All ${totalItems} item(s) failed to add to changeset.`);
  }

  // Return staging failures as warnings
  if (failedElements.length > 0 || failedRelationships.length > 0) {
    if (failedElements.length > 0) {
      warnings.push(`Failed to stage ${failedElements.length} element(s):`);
      failedElements.forEach((msg) => warnings.push(`  • ${msg}`));
    }
    if (failedRelationships.length > 0) {
      const plural = failedRelationships.length === 1 ? 'relationship' : 'relationships';
      warnings.push(`Failed to stage ${failedRelationships.length} ${plural}:`);
      failedRelationships.forEach((msg) => warnings.push(`  • ${msg}`));
    }
  }
  return { warnings, changesetSaved };
}

/**
 * Session subcommands for managing persistent CodePrism lifecycle
 */

import {
  startSession,
  stopSession,
  getSessionState,
  querySession,
} from "../scan/session-manager.js";
import { findProjectRoot } from "../utils/project-paths.js";

/**
 * dr scan session start [--workspace <path>]
 * Spawn CodePrism as background process and poll until ready
 */
export async function sessionStartCommand(options: {
  workspace?: string;
}): Promise<void> {
  try {
    const workspace = options.workspace || (await findProjectRoot());

    if (!workspace) {
      throw new CLIError(
        "No workspace specified and no documentation-robotics directory found",
        ErrorCategory.USER,
        [
          "Specify workspace with: dr scan session start --workspace /path/to/project",
          "Or run from within a project directory",
        ]
      );
    }

    console.log(`Starting CodePrism session for workspace: ${workspace}`);

    const config = await loadScanConfig();
    const session = await startSession(workspace, config, {
      maxWaitMs: 60000,
      pollIntervalMs: 1000,
    });

    console.log(ansis.green(`✓ Session started (PID: ${session.pid})`));
    console.log(`  Indexed files: ${session.indexed_files}`);
    console.log(`  Workspace: ${session.workspace}`);
    console.log(`\nSession is ready for queries. Use 'dr scan session query' to interact.`);
  } catch (error) {
    handleError(error);
  }
}

/**
 * dr scan session status
 * Check if session is active and report status
 */
export async function sessionStatusCommand(options?: {
  workspace?: string;
}): Promise<void> {
  try {
    const workspace = options?.workspace || (await findProjectRoot());

    if (!workspace) {
      throw new CLIError(
        "No workspace specified and no documentation-robotics directory found",
        ErrorCategory.USER,
        [
          "Specify workspace with: dr scan session status --workspace /path/to/project",
          "Or run from within a project directory",
        ]
      );
    }

    const state = await getSessionState(workspace);

    if (!state) {
      console.log(ansis.yellow("No session found"));
      console.log(`\nTo start a session, run: dr scan session start --workspace ${workspace}`);
      process.exit(1);
    }

    if (state.isActive) {
      console.log(ansis.green(`✓ running (${state.status})`));
      console.log(`  PID: ${state.pid}`);
      console.log(`  Workspace: ${state.workspace}`);
      console.log(`  Indexed files: ${state.indexedFiles}`);
      console.log(`  Uptime: ${state.uptime}`);
    } else {
      console.log(ansis.red("✗ stopped"));
      console.log(`  Last PID: ${state.pid}`);
      console.log(`\nTo start a new session, run: dr scan session start --workspace ${workspace}`);
      process.exit(1);
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * dr scan session query <tool> [--params <json>] [--format json|text]
 * Forward a tool call to the running CodePrism session
 */
export async function sessionQueryCommand(
  tool: string,
  options?: {
    params?: string;
    format?: "json" | "text";
    workspace?: string;
  }
): Promise<void> {
  try {
    const workspace = options?.workspace || (await findProjectRoot());

    if (!workspace) {
      throw new CLIError(
        "No workspace specified and no documentation-robotics directory found",
        ErrorCategory.USER,
        [
          "Specify workspace with: dr scan session query <tool> --workspace /path/to/project",
          "Or run from within a project directory",
        ]
      );
    }

    // Parse tool parameters
    let toolParams: Record<string, unknown> = {};
    if (options?.params) {
      try {
        toolParams = JSON.parse(options.params);
      } catch (error) {
        throw new CLIError(
          "Invalid JSON in --params",
          ErrorCategory.USER,
          [
            `Provided: ${options.params}`,
            `Error: ${getErrorMessage(error)}`,
            `Example: dr scan session query repository_stats --params '{"limit": 10}'`,
          ]
        );
      }
    }

    const config = await loadScanConfig();
    const results = await querySession(workspace, config, tool, toolParams);

    const format = options?.format || "text";

    if (format === "json") {
      console.log(JSON.stringify(results, null, 2));
    } else {
      // Text format: print each result
      for (const result of results) {
        if (result.type === "text") {
          console.log(result.text);
        } else if (result.type === "error") {
          console.error(ansis.red(`Error: ${result.text}`));
        } else if (result.type === "image") {
          console.log(`[Image data: ${result.data.substring(0, 50)}...]`);
        }
      }
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * dr scan session stop [--workspace <path>]
 * Send graceful shutdown to CodePrism and remove session file
 */
export async function sessionStopCommand(options?: {
  workspace?: string;
}): Promise<void> {
  try {
    const workspace = options?.workspace || (await findProjectRoot());

    if (!workspace) {
      throw new CLIError(
        "No workspace specified and no documentation-robotics directory found",
        ErrorCategory.USER,
        [
          "Specify workspace with: dr scan session stop --workspace /path/to/project",
          "Or run from within a project directory",
        ]
      );
    }

    console.log(`Stopping CodePrism session in workspace: ${workspace}`);

    await stopSession(workspace);

    console.log(ansis.green("✓ Session stopped"));
  } catch (error) {
    handleError(error);
  }
}

/**
 * Register scan commands with commander
 * Includes main scan command and session subcommands
 */
export function scanCommands(program: Command): void {
  const scanCmd = program
    .command("scan")
    .description("Scan codebase using CodePrism MCP server or manage persistent sessions");

  // Main scan action
  scanCmd
    .option("--config", "Validate configuration without connecting to CodePrism")
    .option("--dry-run", "Print candidates without creating a changeset")
    .option("--layer <layer>", "Restrict scan to one layer (e.g., api, application)")
    .option("--verbose", "Show detailed scanning output")
    .addHelpText(
      "after",
      `
Configuration location: ~/.dr-config.yaml (scan section)

Example config:
  scan:
    codeprism:
      command: codeprism
      args: ["--mcp"]
      timeout: 5000
    confidence_threshold: 0.6

Examples:
  $ dr scan --config              # Validate configuration
  $ dr scan                       # Start scanning the codebase
  $ dr scan --dry-run             # Preview candidates without staging
  $ dr scan --layer api           # Scan only API layer patterns
  $ dr scan --verbose             # Show detailed output`
    )
    .action(async (options) => {
      await scanCommand({
        config: options.config,
        dryRun: options.dryRun,
        layer: options.layer,
        verbose: options.verbose,
      });
    });

  // Index subcommand
  scanCmd
    .command("index")
    .description("Index repository for codebase orientation (runs repository_stats, detect_patterns, suggest_analysis_workflow)")
    .option("--workspace <path>", "Workspace root path (optional, auto-detected if in project)")
    .option("--verbose", "Show detailed indexing output")
    .addHelpText(
      "after",
      `
The index command analyzes your repository structure and caches the results
in documentation-robotics/scan-index.json. This cache is used by 'dr scan' to
avoid re-indexing on subsequent runs.

Examples:
  $ dr scan index                 # Index the current workspace
  $ dr scan index --verbose       # Show detailed pattern detection
  $ dr scan index --workspace /path/to/project`
    )
    .action(async (options) => {
      await scanIndexCommand({
        workspace: options.workspace,
        verbose: options.verbose,
      });
    });

  // Session subcommands
  const sessionCmd = scanCmd
    .command("session")
    .description("Manage persistent CodePrism sessions");

  sessionCmd
    .command("start")
    .description("Start a new CodePrism session")
    .option("--workspace <path>", "Workspace root path (optional, auto-detected if in project)")
    .action((options) =>
      sessionStartCommand({
        workspace: options.workspace,
      })
    );

  sessionCmd
    .command("status")
    .description("Check status of current session")
    .option("--workspace <path>", "Workspace root path (optional, auto-detected if in project)")
    .action((options) =>
      sessionStatusCommand({
        workspace: options.workspace,
      })
    );

  sessionCmd
    .command("query <tool>")
    .description("Query a running session with a CodePrism tool")
    .option("--params <json>", "Tool parameters as JSON object")
    .option("--format <format>", "Output format: json or text (default: text)")
    .option("--workspace <path>", "Workspace root path (optional, auto-detected if in project)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr scan session query repository_stats
  $ dr scan session query search_code --params '{"pattern":"class.*User","language":"typescript"}'
  $ dr scan session query repository_stats --format json`
    )
    .action((tool, options) =>
      sessionQueryCommand(tool, {
        params: options.params,
        format: options.format,
        workspace: options.workspace,
      })
    );

  sessionCmd
    .command("stop")
    .description("Stop the current CodePrism session")
    .option("--workspace <path>", "Workspace root path (optional, auto-detected if in project)")
    .action((options) =>
      sessionStopCommand({
        workspace: options.workspace,
      })
    );
}
