/**
 * Scan command - initiate architecture model scanning via CodePrism MCP
 *
 * Usage:
 *   dr scan [options]
 *
 * Options:
 *   --config     Validate configuration without connecting to CodePrism
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
import { createMcpClient, validateConnection, disconnectMcpClient } from "../scan/mcp-client.js";
import { loadScanConfig } from "../scan/config.js";
import { loadBuiltinPatterns } from "../scan/pattern-loader.js";
import { getErrorMessage } from "../utils/errors.js";

export interface ScanOptions {
  config?: boolean;
}

/**
 * Execute the scan command
 *
 * @param options - Command options
 */
export async function scanCommand(options: ScanOptions): Promise<void> {
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

    // Load built-in patterns
    console.log("\nLoading pattern library...");
    const patterns = await loadBuiltinPatterns();
    console.log(ansis.green(`✓ Loaded ${patterns.length} pattern sets`));

    // Count total patterns
    const totalPatterns = patterns.reduce((sum, set) => sum + set.patterns.length, 0);
    console.log(`  Total patterns: ${totalPatterns}`);

    // Display framework coverage
    const frameworks = [...new Set(patterns.map((p) => p.framework))].sort();
    console.log(`  Frameworks: ${frameworks.join(", ")}`);

    // TODO: Scanning operations will be added in subsequent phases

    // Cleanup
    await disconnectMcpClient(client);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.error(ansis.red(errorMsg));
    process.exit(1);
  }
}
