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
    const client = await createMcpClient(config);

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
      if (options.verbose) {
        warnings.push(`Could not load existing model for deduplication: ${getErrorMessage(error)}`);
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

    // If dry-run, print candidates and exit
    if (options.dryRun) {
      console.log(ansis.green(`\n✓ Found ${newCandidates.length} new candidates (dry-run mode):\n`));
      printCandidatesTable(newCandidates);
      return;
    }

    // Stage changeset with candidates
    if (newCandidates.length > 0) {
      console.log(`\nStaging ${newCandidates.length} new elements as changeset...`);
      await stageChangeset(newCandidates);
      console.log(ansis.green(`✓ Changeset staged successfully`));
    } else {
      console.log(ansis.yellow(`\n⚠ No new candidates found`));
    }

    // Print summary
    console.log(ansis.green("\n✓ Scan complete"));
    console.log(`  Patterns scanned: ${patternsToExecute.reduce((sum, set) => sum + set.patterns.length, 0)}`);
    console.log(`  Candidates found: ${candidates.length}`);
    console.log(`  Candidates above threshold: ${newCandidates.length}`);
    console.log(`  Elements staged: ${newCandidates.length}`);

    // Print warnings at the end
    if (warnings.length > 0) {
      console.log(ansis.yellow("\n⚠ Warnings:"));
      for (const warning of warnings) {
        console.log(`  • ${warning}`);
      }
    }

    // Cleanup
    await disconnectMcpClient(client);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.error(ansis.red(errorMsg));
    process.exit(1);
  }
}

/**
 * Execute all patterns and collect element candidates
 *
 * @param _client - MCP client (will be used for actual tool invocation in future)
 * @param patterns - Pattern sets to execute
 * @param threshold - Confidence threshold
 * @param warnings - Array to collect warnings
 * @param verbose - Show detailed output
 * @returns Array of element candidates
 */
async function executePatterns(
  _client: MCPClient,
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

        // For now, use mock results since actual MCP integration is not fully implemented
        // In a real implementation, this would call client.callTool()
        const mockMatches = generateMockMatches(pattern);

        // Map matches to candidates
        for (const match of mockMatches) {
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
 * Generate mock matches for a pattern (temporary implementation)
 *
 * This is a placeholder until actual MCP tool invocation is implemented.
 * Returns an empty array so the command works without a real CodePrism server.
 *
 * @param _pattern - Pattern to execute
 * @returns Array of mock matches
 */
function generateMockMatches(
  _pattern: PatternDefinition
): Array<{ [key: string]: string }> {
  // Placeholder for actual MCP tool execution
  // In production, this would call client.callTool(pattern.query.tool, pattern.query.params)
  // and parse the CodePrism results
  return [];
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
    // Render ID template
    const idTemplate = (pattern.mapping as any).id || `${pattern.produces.layer}.${pattern.produces.elementType}.{match.name|kebab}`;
    const id = renderTemplate(idTemplate, { match });

    // Get name from mapping or use a sensible default
    const nameTemplate = (pattern.mapping as any).name || "{match.name}";
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
 */
async function stageChangeset(candidates: ElementCandidate[]): Promise<void> {
  const storage = new StagedChangesetStorage(process.cwd());
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
