/**
 * Validates all `dr ...` example commands found in Claude Code integration markdown files
 * against the live CLI command structure, built dynamically from `dr --help` output.
 *
 * For each discovered example, checks:
 *   1. The command path exists in the installed CLI (top-level command and any subcommand)
 *   2. All --flags are declared options for that command
 *   3. Positional arg count does not exceed the command's maximum
 *      (skipped when any placeholder token like <id> or [layer] is present)
 *
 * The command map is built fresh each run from the installed `dr` binary — never
 * hardcoded — so the test stays accurate as the CLI evolves.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { execSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

// ─── Path Setup ───────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to integrations/claude_code relative to this test file. */
const INTEGRATIONS_DIR = path.resolve(__dirname, "../../../integrations/claude_code");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedOption {
  short: string | undefined;
  long: string;
  takesValue: boolean;
}

interface CommandNode {
  /** Full command path, e.g. "relationship add" */
  fullPath: string;
  /** Minimum required positional arguments */
  minArgs: number;
  /** Maximum allowed positional arguments (Infinity if variadic) */
  maxArgs: number;
  options: ParsedOption[];
  subcommands: Map<string, CommandNode>;
}

interface ExtractedExample {
  /** Absolute path to the markdown file */
  file: string;
  /** 1-based line number of the last line of the command */
  lineNumber: number;
  /** Normalized command string ready for validation */
  normalized: string;
}

interface ValidationResult {
  example: ExtractedExample;
  valid: boolean;
  error?: string;
}

// ─── Help Runner ──────────────────────────────────────────────────────────────

/**
 * Run `dr [cmdPath] --help` and return stdout.
 * Commander exits 0 for --help; capture output whether it succeeds or not.
 */
function runHelp(cmdPath = ""): string {
  const parts = ["npx", "dr", ...(cmdPath ? cmdPath.split(" ") : []), "--help"];
  try {
    return execSync(parts.join(" "), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }) as string;
  } catch (err: any) {
    return String(err.stdout ?? err.stderr ?? "");
  }
}

// ─── Help Output Parsers ──────────────────────────────────────────────────────

/**
 * Collect the indented lines that belong to a named section in Commander help output.
 * Stops at the next non-indented, non-empty line (the start of the next section).
 */
function sectionLines(helpText: string, header: string): string[] {
  const lines = helpText.split("\n");
  const start = lines.findIndex(l => l === `${header}:`);
  if (start === -1) return [];
  const result: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].length > 0 && !/^\s/.test(lines[i])) break;
    result.push(lines[i]);
  }
  return result;
}

/**
 * Parse the Options section of a Commander help output into structured option objects.
 *
 * Handles all three forms:
 *   -v, --verbose           (flag, no value)
 *   --source-file <path>    (required value)
 *   --output [file]         (optional value)
 */
function parseOptions(helpText: string): ParsedOption[] {
  return sectionLines(helpText, "Options").flatMap(line => {
    // Match optional short flag, required long flag, optional value indicator
    const m = line.match(
      /^\s{2,4}(-\w,\s+)?(--[\w-]+)((?:[=\s]+)(?:<[^>]+>|\[[^\]]+\]))?/
    );
    if (!m) return [];
    return [{
      short: m[1]?.replace(/[,\s]/g, "") || undefined,
      long: m[2],
      takesValue: !!m[3],
    }];
  });
}

/**
 * Derive minimum and maximum positional argument counts from the Usage line.
 *
 * Rules:
 *   <name>    → required (minArgs++)
 *   [name]    → optional (maxArgs++) — excludes [options] and [command]
 *   [name...] → variadic (maxArgs = Infinity)
 */
function parseArgCounts(helpText: string): { minArgs: number; maxArgs: number } {
  const m = helpText.match(/^Usage:\s+dr\s+(.+)$/m);
  if (!m) return { minArgs: 0, maxArgs: Infinity };
  const usage = m[1];
  const required = (usage.match(/<[^>]+>/g) ?? [])
    .filter(t => t !== "<options>").length;
  const optional = (usage.match(/\[[^\]]+\]/g) ?? [])
    .filter(t => !["[options]", "[command]"].includes(t) && !t.startsWith("[--"))
    .length;
  return {
    minArgs: required,
    maxArgs: usage.includes("...") ? Infinity : required + optional,
  };
}

/**
 * Extract the names of subcommands listed in the Commands section of a help output.
 * Excludes the built-in "help" meta-command.
 */
function parseSubcommandNames(helpText: string): string[] {
  return sectionLines(helpText, "Commands").flatMap(line => {
    const m = line.match(/^\s{2}([\w:-]+)/);
    return m && m[1] !== "help" ? [m[1]] : [];
  });
}

// ─── Command Map Builder ──────────────────────────────────────────────────────

/**
 * Build a complete map of all registered CLI commands by recursively walking
 * the `dr --help` output of the installed binary.
 *
 * Returns a Map from full command path (e.g. "relationship add") to CommandNode.
 * The map is rebuilt fresh every test run — never hardcoded.
 */
function buildCommandMap(): Map<string, CommandNode> {
  const map = new Map<string, CommandNode>();
  const visited = new Set<string>();

  function build(cmdPath: string): void {
    if (visited.has(cmdPath)) return;
    visited.add(cmdPath);

    const help = runHelp(cmdPath);
    const options = parseOptions(help);
    const { minArgs, maxArgs } = parseArgCounts(help);
    const subNames = parseSubcommandNames(help);

    // Recurse depth-first so subcommand nodes are in the map when we need them
    for (const sub of subNames) {
      build(`${cmdPath} ${sub}`.trim());
    }

    const subcommands = new Map<string, CommandNode>(
      subNames.flatMap(sub => {
        const subPath = `${cmdPath} ${sub}`.trim();
        const node = map.get(subPath);
        return node ? [[sub, node] as [string, CommandNode]] : [];
      })
    );

    map.set(cmdPath, { fullPath: cmdPath, minArgs, maxArgs, options, subcommands });
  }

  for (const name of parseSubcommandNames(runHelp())) {
    build(name);
  }

  return map;
}

// ─── Markdown Command Extractor ───────────────────────────────────────────────

/**
 * Extract every `dr ...` command from fenced code blocks in a markdown file.
 *
 * Handles:
 *   - `$ dr ...` (strips the $ prefix)
 *   - Multi-line commands joined by trailing backslash
 *   - Trailing `2>&1`, pipes, and inline `#` comments (stripped)
 *   - All fenced code blocks regardless of language tag
 */
function extractDrExamples(filePath: string): ExtractedExample[] {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const examples: ExtractedExample[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Toggle code block state on fence open/close
    if (/^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!inCodeBlock) continue;
    if (!trimmed.startsWith("dr ") && !trimmed.startsWith("$ dr ")) continue;

    // Join backslash continuation lines
    let joined = trimmed.replace(/^\$\s+/, "");
    while (joined.endsWith("\\") && i + 1 < lines.length) {
      joined = joined.slice(0, -1).trimEnd() + " " + lines[++i].trim();
    }

    // Strip trailing noise that isn't part of the command syntax
    const normalized = joined
      .replace(/\s+2>[>&]?\d*.*$/, "")  // stderr/fd redirects (2>&1, 2>/dev/null, etc.)
      .replace(/\s+\|.*$/, "")          // pipeline tail
      .replace(/\s+#.*$/, "")           // inline comment
      .trim();

    if (normalized !== "dr") {
      examples.push({ file: filePath, lineNumber: i + 1, normalized });
    }
  }

  return examples;
}

/** Recursively find all .md files under a directory. */
function findMarkdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory()
      ? findMarkdownFiles(full)
      : entry.endsWith(".md") ? [full] : [];
  });
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/** Split a command string into tokens, respecting single and double quoted strings. */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (const ch of cmd) {
    if      (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; }
    else if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; }
    else if (ch === " " && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Returns true if a token is a template placeholder rather than a concrete value.
 * Placeholders are used in documentation to represent required substitutions.
 *
 * Examples: <id>, [layer], {name}, $VAR, <source-type>...
 */
function isPlaceholder(token: string): boolean {
  const t = token.replace(/^["']|["']$/g, ""); // strip surrounding quotes
  return (
    /^[<{$\[]/.test(t) || // starts with < { $ [
    /[>\]}]$/.test(t) ||  // ends with > } ]
    t.includes("...")      // variadic marker
  );
}

// ─── Validator ────────────────────────────────────────────────────────────────

function validateExample(
  example: ExtractedExample,
  commandMap: Map<string, CommandNode>
): ValidationResult {
  const tokens = tokenize(example.normalized);

  if (tokens.length < 2 || tokens[0] !== "dr") {
    return { example, valid: false, error: "Does not start with 'dr'" };
  }

  // Skip pure-template commands like "dr <command> [options]" — command name is a placeholder
  if (isPlaceholder(tokens[1])) return { example, valid: true };

  // Resolve top-level command
  let node = commandMap.get(tokens[1]);
  if (!node) {
    return { example, valid: false, error: `Unknown command: '${tokens[1]}'` };
  }
  let tokenIdx = 2;

  // Try subcommand resolution
  const nextToken = tokens[tokenIdx];
  if (nextToken && !nextToken.startsWith("-")) {
    // If the next token is a placeholder, we can't validate the subcommand — skip
    if (isPlaceholder(nextToken)) return { example, valid: true };

    const subNode = node.subcommands.get(nextToken);
    if (subNode) {
      node = subNode;
      tokenIdx++;
    } else if (node.subcommands.size > 0) {
      // This command requires a subcommand but the token doesn't match any
      const known = [...node.subcommands.keys()].join(", ");
      return {
        example,
        valid: false,
        error: `Unknown subcommand '${nextToken}' for '${node.fullPath}'. Valid: ${known}`,
      };
    }
    // else: leaf command — nextToken is a positional argument, handled below
  }

  // Partition remaining tokens into positional args and flags
  const positionals: string[] = [];
  const usedFlags: string[] = [];
  let skipNext = false;

  for (let j = tokenIdx; j < tokens.length; j++) {
    if (skipNext) { skipNext = false; continue; }

    const token = tokens[j];
    if (token.startsWith("-")) {
      const flagKey = token.split("=")[0]; // handle --flag=value inline form
      usedFlags.push(flagKey);

      // If this flag takes a value and it isn't inline, consume the next token
      const opt = node.options.find(o => o.long === flagKey || o.short === flagKey);
      if (
        opt?.takesValue &&
        !token.includes("=") &&
        j + 1 < tokens.length &&
        !tokens[j + 1].startsWith("-")
      ) {
        skipNext = true;
      }
    } else {
      positionals.push(token);
    }
  }

  // Check all flags are declared for this command
  const badFlags = usedFlags.filter(
    f => !node!.options.some(o => o.long === f || o.short === f)
  );
  if (badFlags.length > 0) {
    return {
      example,
      valid: false,
      error: `Unknown flag(s) for '${node.fullPath}': ${badFlags.join(", ")}`,
    };
  }

  // Check positional arg count — only when no placeholder is present,
  // because placeholders are template substitutions that may expand to multiple tokens.
  if (!positionals.some(isPlaceholder) && positionals.length > node.maxArgs) {
    return {
      example,
      valid: false,
      error: `Too many positional args for '${node.fullPath}': got ${positionals.length}, max is ${node.maxArgs}. Extra: ${positionals.slice(node.maxArgs).join(", ")}`,
    };
  }

  return { example, valid: true };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Claude Code integration doc examples", () => {
  let commandMap: Map<string, CommandNode>;

  beforeAll(() => {
    commandMap = buildCommandMap();
  }, 60_000); // buildCommandMap() runs dr --help recursively; allow up to 60s

  // ── Sanity-check the map itself ──────────────────────────────────────────────

  it("builds a non-empty live command map from the installed CLI", () => {
    expect(commandMap.size).toBeGreaterThan(10);
    // Spot-check a representative sample of command paths
    expect(commandMap.has("add")).toBe(true);
    expect(commandMap.has("update")).toBe(true);
    expect(commandMap.has("delete")).toBe(true);
    expect(commandMap.has("validate")).toBe(true);
    expect(commandMap.has("relationship")).toBe(true);
    expect(commandMap.has("relationship add")).toBe(true);
    expect(commandMap.has("relationship list")).toBe(true);
    expect(commandMap.has("relationship delete")).toBe(true);
    expect(commandMap.has("relationship show")).toBe(true);
    expect(commandMap.has("schema")).toBe(true);
    expect(commandMap.has("schema types")).toBe(true);
    expect(commandMap.has("schema relationship")).toBe(true);
    expect(commandMap.has("changeset")).toBe(true);
    expect(commandMap.has("changeset create")).toBe(true);
    expect(commandMap.has("catalog")).toBe(true);
    expect(commandMap.has("catalog types")).toBe(true);
  });

  it("correctly captures options for the add command", () => {
    const addNode = commandMap.get("add")!;
    const longFlags = addNode.options.map(o => o.long);
    expect(longFlags).toContain("--description");
    expect(longFlags).toContain("--source-file");
    expect(longFlags).toContain("--source-provenance");
  });

  it("correctly captures options for the relationship add command", () => {
    const node = commandMap.get("relationship add")!;
    const longFlags = node.options.map(o => o.long);
    expect(longFlags).toContain("--predicate");
  });

  // ── Markdown file discovery ───────────────────────────────────────────────────

  const markdownFiles = findMarkdownFiles(INTEGRATIONS_DIR);

  it("finds markdown integration files to validate", () => {
    expect(markdownFiles.length).toBeGreaterThan(0);
  });

  // ── Per-file example validation ───────────────────────────────────────────────
  // One test per markdown file gives clear, isolated failure reporting.

  for (const filePath of markdownFiles) {
    const relPath = path.relative(INTEGRATIONS_DIR, filePath);

    it(`${relPath}`, () => {
      const examples = extractDrExamples(filePath);
      if (examples.length === 0) return; // no dr commands in this file

      const results = examples.map(ex => validateExample(ex, commandMap));
      const failures = results.filter(r => !r.valid);
      if (failures.length === 0) return;

      const report = failures
        .map(r => `  line ${r.example.lineNumber}: ${r.example.normalized}\n  → ${r.error}`)
        .join("\n\n");

      expect(
        failures.length,
        `${failures.length} invalid example(s) in ${relPath}:\n\n${report}\n`
      ).toBe(0);
    });
  }
});
