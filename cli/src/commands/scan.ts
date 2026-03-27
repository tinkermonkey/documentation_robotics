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
import { loadBuiltinPatterns, loadProjectPatterns, mergePatterns, filterByConfidence, renderTemplate, type PatternDefinition, type PatternSet, type ElementCandidate } from "../scan/pattern-loader.js";
import { getErrorMessage } from "../utils/errors.js";
import { Model } from "../core/model.js";
import { StagedChangesetStorage } from "../core/staged-changeset-storage.js";
import { isValidLayerName, CANONICAL_LAYER_NAMES } from "../core/layers.js";

export interface ScanOptions {
  config?: boolean;
  dryRun?: boolean;
  layer?: string;
  verbose?: boolean;
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
    const allPatterns = mergePatterns(builtinPatterns, projectPatterns);

    console.log(ansis.green(`✓ Loaded ${allPatterns.length} pattern sets`));

    // Count total patterns
    const totalPatterns = allPatterns.reduce((sum, set) => sum + set.patterns.length, 0);
    console.log(`  Total patterns: ${totalPatterns}`);

    // Apply layer filter if specified
    let patternsToExecute = allPatterns;
    if (options.layer) {
      // Validate layer name against canonical layer names
      if (!isValidLayerName(options.layer)) {
        throw new Error(`Invalid layer name: '${options.layer}'. Valid layers are: ${CANONICAL_LAYER_NAMES.join(', ')}`);
      }
      patternsToExecute = allPatterns.filter((set) => set.layer === options.layer);
      console.log(`  Filtered to layer '${options.layer}': ${patternsToExecute.reduce((sum, set) => sum + set.patterns.length, 0)} patterns`);
    }

    // Display framework coverage
    const frameworks = [...new Set(patternsToExecute.map((p) => p.framework))].sort();
    console.log(`  Frameworks: ${frameworks.join(", ")}`);

    // Execute patterns and collect candidates
    console.log("\nScanning codebase...");
    // Note: client is passed for future integration with actual MCP tool invocation
    const candidates = await executePatterns(client, patternsToExecute, config.confidence_threshold || 0.7, warnings, options.verbose || false);

    // Load current model for deduplication
    let model: Model | null = null;
    try {
      model = await Model.load(process.cwd());
    } catch (error) {
      const modelLoadError = `Could not load existing model for deduplication: ${getErrorMessage(error)}`;
      warnings.push(modelLoadError);
      if (!options.verbose) {
        // In non-verbose mode, still warn about deduplication being skipped
        console.warn(ansis.yellow(`⚠ ${modelLoadError}`));
      }
    }

    // Deduplicate against current model
    const newCandidates = candidates.filter((candidate) => {
      if (!model) return true; // Keep all if no model
      const element = model.getElementById(candidate.id);
      if (element) {
        if (options.verbose) {
          console.log(`  Skipping duplicate: ${candidate.id}`);
        }
        return false;
      }
      return true;
    });

    // If dry-run, print candidates and exit (with cleanup)
    if (options.dryRun) {
      console.log(ansis.green(`\n✓ Found ${newCandidates.length} new candidates (dry-run mode):\n`));
      printCandidatesTable(newCandidates);
      return; // Exit cleanly - finally block will run for cleanup
    }

    // Stage changeset with candidates
    if (newCandidates.length > 0) {
      console.log(`\nStaging ${newCandidates.length} new elements as changeset...`);
      await stageChangeset(newCandidates, process.cwd());
      console.log(ansis.green(`✓ Changeset staged successfully`));
    } else {
      console.log(ansis.yellow(`\n⚠ No new candidates found`));
    }

    // Print summary
    console.log(ansis.green("\n✓ Scan complete"));
    console.log(`  Patterns scanned: ${patternsToExecute.reduce((sum, set) => sum + set.patterns.length, 0)}`);
    console.log(`  Candidates found: ${candidates.length}`);
    console.log(`  Candidates deduplicated: ${candidates.length - newCandidates.length}`);
    console.log(`  New candidates: ${newCandidates.length}`);
    console.log(`  Elements staged: ${newCandidates.length}`);

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
 * Execute all patterns and collect element candidates
 *
 * @param client - MCP client for tool invocation
 * @param patterns - Pattern sets to execute
 * @param threshold - Confidence threshold
 * @param warnings - Array to collect warnings
 * @param verbose - Show detailed output
 * @returns Array of element candidates
 */
async function executePatterns(
  client: MCPClient,
  patterns: PatternSet[],
  threshold: number,
  warnings: string[],
  verbose: boolean
): Promise<ElementCandidate[]> {
  const candidates: ElementCandidate[] = [];

  for (const patternSet of patterns) {
    for (const pattern of patternSet.patterns) {
      try {
        if (verbose) {
          console.log(`  Executing pattern: ${pattern.id}`);
        }

        // Invoke the pattern via MCP
        const matches = await invokeMcpTool(client, pattern);

        // Map matches to candidates
        for (const match of matches) {
          const candidate = mapToCandidate(pattern, match);
          if (candidate) {
            candidates.push(candidate);
          }
        }
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        warnings.push(`Pattern '${pattern.id}' failed: ${errorMsg}`);
      }
    }
  }

  // Filter by confidence
  return filterByConfidence(candidates, threshold);
}

/**
 * Invoke an MCP tool to execute a pattern
 *
 * @param client - MCP client
 * @param pattern - Pattern to execute
 * @returns Array of matches from the tool
 */
async function invokeMcpTool(
  client: MCPClient,
  pattern: PatternDefinition
): Promise<Array<{ [key: string]: string }>> {
  try {
    // Call the pattern's query tool via MCP
    const result = await client.callTool(pattern.query.tool, pattern.query.params || {});

    // Parse the result - CodePrism returns an array of matches
    if (Array.isArray(result)) {
      return result;
    }

    // If result has a matches property, use that
    if (result && typeof result === "object" && "matches" in result && Array.isArray(result.matches)) {
      return result.matches;
    }

    // Otherwise return empty array
    return [];
  } catch (error) {
    // Tool invocation failed - return empty array so scan continues
    // The error is already captured by the caller's try/catch
    return [];
  }
}

/**
 * Map a pattern match to an element candidate
 *
 * @param pattern - Pattern definition
 * @param match - Match data from CodePrism
 * @returns Element candidate or null if mapping fails
 */
function mapToCandidate(
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
 * Print candidates as a table
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
 * Stage candidates as a changeset
 *
 * @param candidates - Element candidates to stage
 * @param workdir - Working directory for changeset storage
 */
async function stageChangeset(candidates: ElementCandidate[], workdir: string): Promise<void> {
  const storage = new StagedChangesetStorage(workdir);
  const changesetId = `scan-${Date.now()}`;
  const changeset = await storage.create(
    changesetId,
    `Scan Results - ${new Date().toLocaleString()}`,
    `${candidates.length} elements found by architecture scan`,
    "current"
  );

  // Add each candidate as an 'add' operation
  for (const candidate of candidates) {
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

  // Save changeset
  await storage.save(changeset);
}
