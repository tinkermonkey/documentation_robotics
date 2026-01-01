/**
 * Documentation Validation Test
 * Validates that all `dr` commands documented in markdown files are valid
 * according to the actual CLI schema extracted from Commander.js
 */

import { describe, it, expect } from 'bun:test';
import { join, relative } from 'path';
import { fileExists } from '../../src/utils/file-io.js';

interface CommandSchema {
  name: string;
  options: Array<{ flags: string; description: string }>;
  arguments: Array<{ name: string; required: boolean }>;
  subcommands?: CommandSchema[];
}

interface CommandInvocation {
  file: string;
  lineNumber: number;
  command: string;
  subcommand?: string;
  args: string[];
  flags: string[];
  fullCommand: string;
}

interface ValidationError {
  file: string;
  lineNumber: number;
  message: string;
  context: string;
}

/**
 * Extract CLI schema from the compiled CLI program
 * Caches help output to avoid repeated spawning
 * Handles both top-level commands and subcommands (e.g., changeset create)
 */
let cachedSchema: Map<string, CommandSchema> | null = null;

async function extractCliSchema(): Promise<Map<string, CommandSchema>> {
  if (cachedSchema) {
    return cachedSchema;
  }

  const schema = new Map<string, CommandSchema>();
  const cliPath = new URL('../../dist/cli.js', import.meta.url).pathname;

  // Get main help
  const mainHelpText = getCommandHelp(cliPath);
  const topLevelCommands = parseCommandsFromHelp(mainHelpText);

  // Initialize top-level commands in schema
  for (const cmdName of topLevelCommands) {
    schema.set(cmdName, {
      name: cmdName,
      options: [],
      arguments: [],
      subcommands: [],
    });
  }

  // Get details for each top-level command
  for (const cmdName of topLevelCommands) {
    const cmdHelpText = getCommandHelp(cliPath, cmdName);
    const cmdSchema = schema.get(cmdName)!;

    // Parse options and subcommands from help text
    const { options, subcommands } = parseCommandDetails(cmdHelpText);
    cmdSchema.options = options;

    for (const subName of subcommands) {
      cmdSchema.subcommands?.push({
        name: subName,
        options: [],
        arguments: [],
      });
    }

    // Get options for each subcommand
    for (const subName of subcommands) {
      const subHelpText = getCommandHelp(cliPath, cmdName, subName);
      const subSchema = cmdSchema.subcommands?.find((s) => s.name === subName);
      if (subSchema) {
        const { options: subOptions } = parseCommandDetails(subHelpText);
        subSchema.options = subOptions;
      }
    }
  }

  cachedSchema = schema;
  return schema;
}

/**
 * Get help text for a command, using spawnSync for speed
 */
function getCommandHelp(cliPath: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['node', cliPath, ...args, '--help'],
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.stdout?.toString() || '';
}

/**
 * Parse command names from help output
 */
function parseCommandsFromHelp(helpText: string): string[] {
  const commands: string[] = [];
  const lines = helpText.split('\n');
  let inCommandsSection = false;
  const commandPattern = /^\s{2}([a-z-]+)\s+(.*)$/;

  for (const line of lines) {
    if (line.includes('Commands:')) {
      inCommandsSection = true;
      continue;
    }

    if (inCommandsSection && line.trim() === '') {
      break;
    }

    if (inCommandsSection) {
      const match = line.match(commandPattern);
      if (match) {
        commands.push(match[1]);
      }
    }
  }

  return commands;
}

/**
 * Parse command options and subcommands from help text
 */
function parseCommandDetails(helpText: string): { options: Array<{ flags: string; description: string }>; subcommands: string[] } {
  const options: Array<{ flags: string; description: string }> = [];
  const subcommands: string[] = [];
  const lines = helpText.split('\n');

  let inOptionsSection = false;
  let inCommandsSection = false;
  const optionPattern = /^\s+(-[a-zA-Z]|--[a-z-]+)/;
  const commandPattern = /^\s{2}([a-z-]+)\s+(.*)$/;

  for (const line of lines) {
    if (line.includes('Commands:')) {
      inCommandsSection = true;
      inOptionsSection = false;
      continue;
    }

    if (line.includes('Options:')) {
      inOptionsSection = true;
      inCommandsSection = false;
      continue;
    }

    if ((inOptionsSection || inCommandsSection) && line.trim() === '') {
      inOptionsSection = false;
      inCommandsSection = false;
      continue;
    }

    // Parse options
    if (inOptionsSection && line.match(optionPattern)) {
      const flagMatch = line.match(/^\s+((?:-[a-zA-Z]|--[a-z-]+)(?:,\s*(?:-[a-zA-Z]|--[a-z-]+))*)/);
      if (flagMatch) {
        options.push({
          flags: flagMatch[1],
          description: line.trim(),
        });
      }
    }

    // Parse subcommands
    if (inCommandsSection) {
      const match = line.match(commandPattern);
      if (match && match[1] !== 'help') {
        subcommands.push(match[1]);
      }
    }
  }

  return { options, subcommands };
}

/**
 * Scan markdown files for `dr` command invocations
 * Looks for:
 * - Inline code: `dr command args`
 * - Code blocks: ```bash\ndr command args\n```
 */
async function scanDocumentation(directories: string[], schema?: Map<string, CommandSchema>): Promise<CommandInvocation[]> {
  const invocations: CommandInvocation[] = [];

  for (const dir of directories) {
    if (!(await fileExists(dir))) {
      continue;
    }

    // Recursively find all markdown files
    const mdFiles = await glob(join(dir, '**/*.md'));

    for (const file of mdFiles) {
      try {
        const content = await Bun.file(file).text();
        const lines = content.split('\n');

        let inCodeBlock = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;

          // Track code block state
          if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
          }

          // Match inline code: `dr command args...`
          const inlineMatches = line.matchAll(/`(dr\s+[^`]+)`/g);
          for (const match of inlineMatches) {
            const fullCmd = match[1];
            const invocation = parseCommandLine(fullCmd, schema);
            invocations.push({
              file,
              lineNumber: lineNum,
              ...invocation,
              fullCommand: fullCmd,
            });
          }

          // Match code block lines starting with dr
          if (inCodeBlock && line.trim().startsWith('dr ')) {
            const fullCmd = line.trim();
            const invocation = parseCommandLine(fullCmd, schema);
            invocations.push({
              file,
              lineNumber: lineNum,
              ...invocation,
              fullCommand: fullCmd,
            });
          }
        }
      } catch (error) {
        console.warn(`Failed to scan ${file}: ${error}`);
      }
    }
  }

  return invocations;
}

/**
 * Parse a command line into components
 * Format: dr <command> [subcommand] [args...] [--flags...]
 * Examples:
 *   dr add business service customer --name "Customer Service"
 *   dr changeset apply my-changeset
 *   dr validate --strict
 */
function parseCommandLine(
  commandLine: string,
  schema?: Map<string, CommandSchema>
): {
  command: string;
  subcommand?: string;
  args: string[];
  flags: string[];
} {
  const parts = commandLine.trim().split(/\s+/);

  // Remove 'dr' prefix
  if (parts[0] === 'dr') {
    parts.shift();
  }

  if (parts.length === 0) {
    return { command: '', args: [], flags: [] };
  }

  const command = parts[0];
  let subcommand: string | undefined;
  let startIdx = 1;

  // Check if second part is a subcommand
  // A subcommand is a word that:
  // 1. Doesn't start with -- or -
  // 2. Is in the schema for this command
  if (schema && parts.length > 1 && !parts[1].startsWith('-')) {
    const cmdSchema = schema.get(command);
    if (cmdSchema?.subcommands && cmdSchema.subcommands.length > 0) {
      const potentialSubcmd = parts[1];
      if (cmdSchema.subcommands.some((s) => s.name === potentialSubcmd)) {
        subcommand = potentialSubcmd;
        startIdx = 2;
      }
    }
  }

  const args: string[] = [];
  const flags: string[] = [];

  for (let i = startIdx; i < parts.length; i++) {
    if (parts[i].startsWith('-')) {
      flags.push(parts[i]);
    } else {
      args.push(parts[i]);
    }
  }

  return { command, subcommand, args, flags };
}

/**
 * Validate invocations against the CLI schema
 */
function validateInvocations(
  invocations: CommandInvocation[],
  schema: Map<string, CommandSchema>
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const inv of invocations) {
    if (!inv.command) {
      continue; // Skip empty commands
    }

    const cmdSchema = schema.get(inv.command);

    if (!cmdSchema) {
      errors.push({
        file: inv.file,
        lineNumber: inv.lineNumber,
        message: `Unknown command: '${inv.command}'`,
        context: inv.fullCommand,
      });
      continue;
    }

    // If there's a subcommand, validate it exists
    let optionsToCheck = cmdSchema.options;
    if (inv.subcommand) {
      const subSchema = cmdSchema.subcommands?.find((s) => s.name === inv.subcommand);
      if (!subSchema) {
        errors.push({
          file: inv.file,
          lineNumber: inv.lineNumber,
          message: `Unknown subcommand '${inv.subcommand}' for command '${inv.command}'`,
          context: inv.fullCommand,
        });
        continue;
      }
      optionsToCheck = subSchema.options;
    }

    // Validate flags - extract actual flag names from schema
    const validFlags = new Set<string>();
    for (const opt of optionsToCheck) {
      // Split by comma and clean up each flag
      const flagParts = opt.flags.split(/,\s*/).map((f) => f.trim());
      for (const flagPart of flagParts) {
        validFlags.add(flagPart);
      }
    }

    // Add global flags (always available)
    validFlags.add('-v');
    validFlags.add('--verbose');
    validFlags.add('--debug');
    validFlags.add('-h');
    validFlags.add('--help');

    for (const flag of inv.flags) {
      // Check if flag exists (exact match or with/without equals)
      const flagBase = flag.split('=')[0];

      if (!validFlags.has(flagBase)) {
        // Check if it's a partial match (e.g., --output in --output <path>)
        let found = false;
        for (const validFlag of validFlags) {
          if (validFlag.startsWith(flagBase)) {
            found = true;
            break;
          }
        }

        if (!found) {
          const cmdContext = inv.subcommand
            ? `'${inv.command} ${inv.subcommand}'`
            : `'${inv.command}'`;
          errors.push({
            file: inv.file,
            lineNumber: inv.lineNumber,
            message: `Unknown flag '${flagBase}' for command ${cmdContext}`,
            context: inv.fullCommand,
          });
        }
      }
    }
  }

  return errors;
}

describe('Documentation Validation', () => {
  it('all documented dr commands are valid', async () => {
    // Note: This test is more comprehensive and takes longer due to schema extraction
    // and markdown file scanning across multiple directories
    const startTime = Date.now();
    // Extract schema from CLI
    const schema = await extractCliSchema();

    // Directories to scan
    const docDirs = [
      new URL('../../src/documentation_robotics/claude_integration/', import.meta.url).pathname,
      new URL('../../../integrations/claude_code/', import.meta.url).pathname,
      new URL('../../../spec/', import.meta.url).pathname,
    ];

    // Scan documentation
    const invocations = await scanDocumentation(docDirs, schema);
    const errors = validateInvocations(invocations, schema);

    // Report errors with context
    if (errors.length > 0) {
      const errorReport = errors
        .map(
          (e) =>
            `${relative(process.cwd(), e.file)}:${e.lineNumber}\n` +
            `  Error: ${e.message}\n` +
            `  Context: ${e.context}`
        )
        .join('\n\n');

      throw new Error(`Documentation validation failed (${errors.length} issues):\n\n${errorReport}`);
    }

    // Verify we found some invocations to validate
    expect(invocations.length).toBeGreaterThan(0);
  });
});

/**
 * Glob implementation for finding markdown files
 * Since we don't have glob available, we'll use Node's fs.promises
 */
async function glob(pattern: string): Promise<string[]> {
  const { glob: globFn } = await import('bun');
  const results: string[] = [];

  try {
    // Use Bun's native glob if available
    for await (const file of globFn.scan({ cwd: '.', patterns: [pattern] })) {
      results.push(join('.', file));
    }
  } catch {
    // Fallback: manually search directories
    const fs = await import('fs/promises');
    const { basename, dirname } = await import('path');

    async function walkDir(dir: string, patterns: string[]): Promise<string[]> {
      const files: string[] = [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...(await walkDir(fullPath, patterns)));
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      } catch {
        // ignore unreadable directories
      }
      return files;
    }

    const dirPart = pattern.split('**')[0];
    return await walkDir(dirPart, [pattern]);
  }

  return results;
}
