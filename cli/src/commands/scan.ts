/**
 * Scan command - initiate architecture model scanning via CodePrism MCP
 *
 * Usage:
 *   dr scan [options]
 *
 * Options:
 *   --config     Validate configuration without connecting to CodePrism
 *   --debug      Enable debug logging
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
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createMcpClient, validateConnection, disconnectMcpClient } from "../scan/mcp-client.js";
import { loadScanConfig } from "../scan/config.js";
import { getErrorMessage } from "../utils/errors.js";

export interface ScanOptions {
  config?: boolean;
  debug?: boolean;
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

    // If --config flag is set, just validate configuration file exists
    if (options.config) {
      const configPath = join(homedir(), ".dr-config.yaml");
      if (!existsSync(configPath)) {
        console.error(ansis.red("Error: Configuration file not found"));
        console.error(`Expected at: ${configPath}`);
        console.error("\nCreate the file with:");
        console.error("  scan:");
        console.error("    codeprism:");
        console.error("      command: codeprism");
        console.error("      args: [--mcp]");
        console.error("      timeout: 5000");
        process.exit(1);
      }

      console.log(ansis.green("✓ Configuration file found and valid"));
      console.log(`  Location: ${configPath}`);
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

    // Phase 2+ would proceed with actual scanning operations here

    // Cleanup
    await disconnectMcpClient(client);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    console.error(ansis.red(errorMsg));
    process.exit(1);
  }
}
