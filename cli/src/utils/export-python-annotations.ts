#!/usr/bin/env node
/**
 * Annotation Export Utility
 *
 * Exports annotations from Python CLI format to help users migrate.
 * Python CLI stores annotations in `.dr/annotations/` directory.
 * This tool exports them to JSON or Markdown for manual migration.
 *
 * Usage:
 *   bun run src/utils/export-python-annotations.ts --output annotations.json
 *   bun run src/utils/export-python-annotations.ts --format markdown --output annotations.md
 */

import fs from "fs/promises";
import path from "path";
import { Command } from "commander";

interface Annotation {
  id: string;
  elementId: string;
  author: string;
  timestamp: string;
  content: string;
  threadId?: string;
  parentId?: string;
}

interface AnnotationThread {
  elementId: string;
  annotations: Annotation[];
}

async function findAnnotationsDirectory(modelRoot: string): Promise<string | null> {
  // Try .dr/annotations/ first
  const drPath = path.join(modelRoot, ".dr", "annotations");
  try {
    await fs.access(drPath);
    return drPath;
  } catch {
    // Try documentation-robotics/annotations/
    const drAltPath = path.join(modelRoot, "documentation-robotics", "annotations");
    try {
      await fs.access(drAltPath);
      return drAltPath;
    } catch {
      return null;
    }
  }
}

async function loadAnnotations(annotationsDir: string): Promise<AnnotationThread[]> {
  const threads: AnnotationThread[] = [];

  try {
    const files = await fs.readdir(annotationsDir);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const filePath = path.join(annotationsDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(content);

      // Extract element ID from filename (format: element-id.json)
      const elementId = file.replace(".json", "");

      threads.push({
        elementId,
        annotations: Array.isArray(data) ? data : [data],
      });
    }
  } catch (error) {
    console.error("Error loading annotations:", error);
  }

  return threads;
}

function exportToJSON(threads: AnnotationThread[]): string {
  return JSON.stringify(threads, null, 2);
}

function exportToMarkdown(threads: AnnotationThread[]): string {
  let markdown = "# Annotation Export\n\n";
  markdown += `**Exported:** ${new Date().toISOString()}\n\n`;
  markdown += `**Total Threads:** ${threads.length}\n\n`;
  markdown += "---\n\n";

  for (const thread of threads) {
    markdown += `## Element: ${thread.elementId}\n\n`;

    for (const annotation of thread.annotations) {
      markdown += `### Annotation by ${annotation.author}\n\n`;
      markdown += `**Date:** ${annotation.timestamp}\n\n`;
      if (annotation.threadId) {
        markdown += `**Thread:** ${annotation.threadId}\n\n`;
      }
      markdown += `${annotation.content}\n\n`;
      markdown += "---\n\n";
    }
  }

  return markdown;
}

async function main() {
  const program = new Command();

  program
    .name("export-python-annotations")
    .description("Export annotations from Python CLI format")
    .option("--model <path>", "Path to model root", process.cwd())
    .option("--output <file>", "Output file (required)")
    .option("--format <format>", "Output format: json, markdown", "json")
    .parse();

  const options = program.opts();

  if (!options.output) {
    console.error("Error: --output is required");
    process.exit(1);
  }

  console.log(`Searching for annotations in ${options.model}...`);

  const annotationsDir = await findAnnotationsDirectory(options.model);

  if (!annotationsDir) {
    console.log("No annotations directory found.");
    console.log("This is normal if you never used the Python CLI annotation feature.");
    console.log("");
    console.log("Annotation directories checked:");
    console.log("  - .dr/annotations/");
    console.log("  - documentation-robotics/annotations/");
    process.exit(0);
  }

  console.log(`Found annotations directory: ${annotationsDir}`);

  const threads = await loadAnnotations(annotationsDir);

  if (threads.length === 0) {
    console.log("No annotations found in directory.");
    process.exit(0);
  }

  console.log(`Loaded ${threads.length} annotation threads`);

  let output: string;

  if (options.format === "markdown") {
    output = exportToMarkdown(threads);
  } else {
    output = exportToJSON(threads);
  }

  await fs.writeFile(options.output, output, "utf-8");

  console.log(`✓ Annotations exported to ${options.output}`);
  console.log("");
  console.log("Next steps:");
  console.log("1. Review the exported annotations");
  console.log("2. Add important annotations to element descriptions:");
  console.log('   dr update <element-id> --description "Annotation content"');
  console.log("3. Consider using external tools for collaborative annotations:");
  console.log("   - GitHub Issues");
  console.log("   - Notion/Confluence");
  console.log("   - Linear/Jira");
}

main().catch(console.error);
