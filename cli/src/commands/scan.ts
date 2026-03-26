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
 *     confidence_threshold: 0.6
 */

import ansis from "ansis";
import { createMcpClient, validateConnection, disconnectMcpClient, type MCPClient } from "../scan/mcp-client.js";
import { loadScanConfig } from "../scan/config.js";
import { loadBuiltinPatterns, loadProjectPatterns, mergePatterns, filterByConfidence, renderTemplate, isValidRelationshipDirection, extractLayerFromId, type PatternDefinition, type PatternSet, type ElementCandidate, type RelationshipCandidate } from "../scan/pattern-loader.js";
import { getErrorMessage } from "../utils/errors.js";
import { Model } from "../core/model.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";

export interface ScanOptions {
  config?: boolean;
  dryRun?: boolean;
  layer?: string;
  verbose?: boolean;
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
 * Execute the scan command
 *
 * @param options - Command options
 */
export async function scanCommand(options: ScanOptions): Promise<void> {
  const warnings: string[] = [];
  let client: MCPClient | null = null;

  try {
    // Load scan configuration
    const config = await loadScanConfig();

    // If --config flag is set, just validate configuration loaded successfully
    if (options.config) {
      console.log(ansis.green("✓ Configuration loaded successfully"));
      console.log(`  CodePrism command: ${config.codeprism?.command || "codeprism"}`);
      console.log(`  Confidence threshold: ${config.confidence_threshold || 0.7}`);
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
    if (config.disabled_patterns && config.disabled_patterns.length > 0) {
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
    const { elementCandidates, relationshipCandidates } = await executePatterns(client, patternsToExecute, config.confidence_threshold || 0.7, warnings, options.verbose || false);

    // Load current model for deduplication
    let model: Model | null = null;
    try {
      model = await Model.load(process.cwd());
    } catch (error) {
      if (options.verbose) {
        warnings.push(`Could not load existing model for deduplication: ${getErrorMessage(error)}`);
      }
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

    // Validate and filter relationship candidates
    const validRelationshipCandidates = relationshipCandidates.filter((candidate) => {
      // Check cross-layer direction rule
      if (!isValidRelationshipDirection(candidate.sourceId, candidate.targetId)) {
        warnings.push(`Relationship violates cross-layer direction rule: ${candidate.sourceId} → ${candidate.targetId} (higher layer must reference lower layer)`);
        return false;
      }

      // Check if source element exists
      const sourceExists = model?.getElementById(candidate.sourceId) !== undefined ||
                         newElementCandidates.some((e) => e.id === candidate.sourceId);
      if (!sourceExists) {
        warnings.push(`Relationship references missing source element: ${candidate.sourceId}`);
        return false;
      }

      // Check if target element exists
      const targetExists = model?.getElementById(candidate.targetId) !== undefined ||
                         newElementCandidates.some((e) => e.id === candidate.targetId);
      if (!targetExists) {
        warnings.push(`Relationship references missing target element: ${candidate.targetId}`);
        return false;
      }

      // Check for duplicates in existing model
      if (model) {
        const existing = model.relationships.find(
          candidate.sourceId,
          candidate.targetId,
          candidate.relationshipType
        );
        if (existing && existing.length > 0) {
          if (options.verbose) {
            console.log(`  Skipping duplicate relationship: ${candidate.sourceId} → ${candidate.targetId}`);
          }
          return false;
        }
      }

      return true;
    });

    // If dry-run, print candidates and exit (with cleanup)
    if (options.dryRun) {
      console.log(ansis.green(`\n✓ Found ${newElementCandidates.length} element candidates and ${validRelationshipCandidates.length} relationship candidates (dry-run mode):\n`));
      if (newElementCandidates.length > 0) {
        console.log("Elements:");
        printCandidatesTable(newElementCandidates);
      }
      if (validRelationshipCandidates.length > 0) {
        console.log("\nRelationships:");
        printRelationshipCandidatesTable(validRelationshipCandidates);
      }
      return; // Exit cleanly - finally block will run for cleanup
    }

    // Stage changeset with candidates
    if (newElementCandidates.length > 0 || validRelationshipCandidates.length > 0) {
      console.log(`\nStaging ${newElementCandidates.length} elements and ${validRelationshipCandidates.length} relationships as changeset...`);
      await stageChangeset(newElementCandidates, validRelationshipCandidates, process.cwd());
      console.log(ansis.green(`✓ Changeset staged successfully`));
    } else {
      console.log(ansis.yellow(`\n⚠ No new candidates found`));
    }

    // Print summary
    console.log(ansis.green("\n✓ Scan complete"));
    console.log(`  Patterns scanned: ${patternsToExecute.reduce((sum, set) => sum + set.patterns.length, 0)}`);
    console.log(`  Element candidates found: ${elementCandidates.length}`);
    console.log(`  Element candidates deduplicated: ${elementCandidates.length - newElementCandidates.length}`);
    console.log(`  New element candidates: ${newElementCandidates.length}`);
    console.log(`  Relationship candidates found: ${relationshipCandidates.length}`);
    console.log(`  Valid relationships staged: ${validRelationshipCandidates.length}`);
    console.log(`  Elements staged: ${newElementCandidates.length}`);
    console.log(`  Relationships staged: ${validRelationshipCandidates.length}`);

    // Print warnings at the end
    if (warnings.length > 0) {
      console.log(ansis.yellow("\n⚠ Warnings:"));
      for (const warning of warnings) {
        console.log(`  • ${warning}`);
      }
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.error(ansis.red(errorMsg));
  } finally {
    // Always disconnect MCP client, even on error or dry-run
    if (client) {
      try {
        await disconnectMcpClient(client);
      } catch (error) {
        // Disconnect errors should not crash the command
        if (options.verbose) {
          console.warn(`Warning: Failed to disconnect from CodePrism: ${getErrorMessage(error)}`);
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
async function executePatterns(
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
      try {
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

        // Call the tool via MCP client
        const results = await client.callTool(toolName, toolParams);

        // Parse results - each result should be parseable JSON containing match data
        const matches: Array<{ [key: string]: string }> = [];
        for (const result of results) {
          if (result.type === "error") {
            if (verbose) {
              console.log(`    Warning: Tool returned error: ${result.text}`);
            }
            continue;
          }

          if (result.text) {
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
              // If not JSON, try to treat the text itself as match data
              if (verbose) {
                console.log(`    Warning: Could not parse tool result as JSON: ${result.text?.slice(0, 100)}`);
              }
            }
          }
        }

        if (verbose) {
          console.log(`    Found ${matches.length} matches`);
        }

        // Map matches to candidates based on pattern produces type
        for (const match of matches) {
          if (pattern.produces.type === "relationship") {
            const candidate = mapToRelationshipCandidate(pattern, match);
            if (candidate) {
              relationshipCandidates.push(candidate);
            }
          } else {
            const candidate = mapToElementCandidate(pattern, match);
            if (candidate) {
              elementCandidates.push(candidate);
            }
          }
        }
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        warnings.push(`Pattern '${pattern.id}' failed: ${errorMsg}`);
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
 * @returns Element candidate or null if mapping fails
 */
function mapToElementCandidate(
  pattern: PatternDefinition,
  match: Record<string, string>
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

    return {
      id,
      type: pattern.produces.elementType,
      layer: pattern.produces.layer,
      name,
      confidence: pattern.confidence,
      attributes,
      source: match.file ? { file: match.file, line: parseInt(match.line || "0") } : undefined,
    };
  } catch (error) {
    // Return null if mapping fails
    return null;
  }
}

/**
 * Map a pattern match to a relationship candidate
 *
 * @param pattern - Relationship pattern definition
 * @param match - Match data from CodePrism
 * @returns Relationship candidate or null if mapping fails
 */
function mapToRelationshipCandidate(
  pattern: PatternDefinition,
  match: Record<string, string>
): RelationshipCandidate | null {
  try {
    // Get sourceId template from mapping
    let sourceIdTemplate: string | undefined;
    const sourceIdValue = pattern.mapping["sourceId"];
    if (typeof sourceIdValue === "string") {
      sourceIdTemplate = sourceIdValue;
    }
    if (!sourceIdTemplate) {
      throw new Error("Relationship pattern must define 'sourceId' in mapping");
    }
    const sourceId = renderTemplate(sourceIdTemplate, { match });

    // Get targetId template from mapping
    let targetIdTemplate: string | undefined;
    const targetIdValue = pattern.mapping["targetId"];
    if (typeof targetIdValue === "string") {
      targetIdTemplate = targetIdValue;
    }
    if (!targetIdTemplate) {
      throw new Error("Relationship pattern must define 'targetId' in mapping");
    }
    const targetId = renderTemplate(targetIdTemplate, { match });

    // Get relationshipType from pattern definition
    const relationshipType = pattern.produces.relationshipType;
    if (!relationshipType) {
      throw new Error("Relationship pattern must define 'relationshipType' in produces");
    }

    // Extract source layer from source element ID
    const sourceLayer = extractLayerFromId(sourceId);
    if (!sourceLayer) {
      throw new Error(`Invalid source element ID format: ${sourceId}`);
    }

    // Create relationship candidate ID
    const id = `${sourceId}->${targetId}`;

    // Collect attributes from mapping (excluding sourceId and targetId)
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pattern.mapping)) {
      if (key === "sourceId" || key === "targetId") continue;
      if (typeof value === "string") {
        attributes[key] = renderTemplate(value, { match });
      }
    }

    return {
      id,
      relationshipType,
      sourceId,
      targetId,
      layer: sourceLayer,
      confidence: pattern.confidence,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      source: match.file ? { file: match.file, line: parseInt(match.line || "0") } : undefined,
    };
  } catch (error) {
    // Return null if mapping fails
    return null;
  }
}

/**
 * Print element candidates as a table
 *
 * @param candidates - Candidates to print
 */
function printCandidatesTable(candidates: ElementCandidate[]): void {
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
function printRelationshipCandidatesTable(candidates: RelationshipCandidate[]): void {
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
 * @param elementCandidates - Element candidates to stage
 * @param relationshipCandidates - Relationship candidates to stage
 * @param workdir - Working directory for changeset storage
 */
async function stageChangeset(elementCandidates: ElementCandidate[], relationshipCandidates: RelationshipCandidate[], workdir: string): Promise<void> {
  const storage = new StagedChangesetStorage(workdir);
  const changesetId = `scan-${Date.now()}`;
  const totalItems = elementCandidates.length + relationshipCandidates.length;
  const changeset = await storage.create(
    changesetId,
    `Scan Results - ${new Date().toLocaleString()}`,
    `${totalItems} items (${elementCandidates.length} elements, ${relationshipCandidates.length} relationships) found by architecture scan`,
    "current"
  );

  // First: Add all element candidates as 'add' operations
  for (const candidate of elementCandidates) {
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
  }

  // Second: Add all relationship candidates as 'relationship-add' operations
  for (const candidate of relationshipCandidates) {
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

    // Composite key for relationships: source::predicate::target
    const relationshipId = `${candidate.sourceId}::${candidate.relationshipType}::${candidate.targetId}`;

    changeset.addChange("relationship-add", relationshipId, candidate.layer, undefined, relationshipData);
  }

  // Save changeset
  await storage.save(changeset);
}
