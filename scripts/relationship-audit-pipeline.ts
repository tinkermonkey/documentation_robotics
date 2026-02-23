#!/usr/bin/env node
/**
 * Relationship Audit Pipeline
 *
 * Maintainer script for running an AI-assisted relationship audit pipeline.
 * Produces a before/after audit with differential analysis.
 *
 * Requires Claude Code CLI to be installed and authenticated on the system.
 *
 * Usage:
 *   npx tsx scripts/relationship-audit-pipeline.ts
 *   npx tsx scripts/relationship-audit-pipeline.ts --layer security
 *   npx tsx scripts/relationship-audit-pipeline.ts --enable-ai
 *   npx tsx scripts/relationship-audit-pipeline.ts --enable-ai --output-dir my-audit
 *
 * Or via npm from the repo root:
 *   npm run audit:pipeline
 *   npm run audit:pipeline -- --enable-ai
 *   npm run audit:pipeline -- --layer api --enable-ai
 */

import { parseArgs } from "util";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { PipelineOrchestrator } from "../cli/src/audit/pipeline/pipeline-orchestrator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

interface ScriptOptions {
  layer?: string;
  format: "text" | "json" | "markdown";
  outputDir: string;
  enableAI: boolean;
  verbose: boolean;
  help: boolean;
}

function parseArguments(): ScriptOptions {
  const { values } = parseArgs({
    options: {
      layer:       { type: "string",  short: "l" },
      format:      { type: "string",  short: "f", default: "markdown" },
      "output-dir":{ type: "string",  short: "o", default: "audit-results" },
      "enable-ai": { type: "boolean", short: "a", default: false },
      verbose:     { type: "boolean", short: "v", default: false },
      help:        { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  return {
    layer:     values.layer as string | undefined,
    format:    (values.format as "text" | "json" | "markdown") || "markdown",
    outputDir: (values["output-dir"] as string) || "audit-results",
    enableAI:  values["enable-ai"] as boolean,
    verbose:   values.verbose as boolean,
    help:      values.help as boolean,
  };
}

function showHelp(): void {
  console.log(`
Relationship Audit Pipeline

Runs a before/after AI-assisted relationship audit with differential analysis.
Requires Claude Code CLI installed and authenticated when using --enable-ai.

Usage:
  npx tsx scripts/relationship-audit-pipeline.ts [options]
  npm run audit:pipeline -- [options]

Options:
  -l, --layer <name>       Audit specific layer only (default: all layers)
  -f, --format <format>    Report format: text, json, markdown (default: markdown)
  -o, --output-dir <dir>   Output directory (default: audit-results)
  -a, --enable-ai          Enable AI-assisted evaluation via Claude Code CLI
  -v, --verbose            Show detailed output
  -h, --help               Show this help message

Output structure:
  <output-dir>/{timestamp}/before/   - Initial audit report
  <output-dir>/{timestamp}/after/    - Post-AI audit report  (AI mode only)
  <output-dir>/{timestamp}/summary/  - Differential summary  (AI mode only)

Examples:
  npm run audit:pipeline                              # Before-only report
  npm run audit:pipeline -- --enable-ai              # Full AI pipeline
  npm run audit:pipeline -- --layer security --enable-ai
  npm run audit:pipeline -- --output-dir /tmp/audit --enable-ai
  `);
}

async function main(): Promise<void> {
  // Run from project root so model paths resolve correctly
  process.chdir(projectRoot);

  const options = parseArguments();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (options.enableAI) {
    console.log("ℹ️  AI mode enabled — Claude Code CLI must be installed and authenticated.");
  }

  try {
    const orchestrator = new PipelineOrchestrator();

    const result = await orchestrator.executePipeline({
      layer:     options.layer,
      format:    options.format,
      outputDir: options.outputDir,
      enableAI:  options.enableAI,
      verbose:   options.verbose,
    });

    console.log("\nGenerated reports:");
    console.log(`  Before:  ${result.reports.before}`);
    if (result.reports.after)    console.log(`  After:   ${result.reports.after}`);
    if (result.reports.summary)  console.log(`  Summary: ${result.reports.summary}`);

    if (result.summary) {
      console.log("\nImpact:");
      console.log(`  Relationships added:  ${result.summary.relationshipsAdded}`);
      console.log(`  Gaps resolved:        ${result.summary.gapsResolved}`);
      console.log(`  Coverage improvement: ${result.summary.coverageImprovement.toFixed(2)} rel/type`);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Pipeline failed: ${message}`);
    if (error instanceof Error && error.stack && options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
