/**
 * The `file` argument of the batch write tools (model_add, relationship_add, model_update).
 *
 * A large batch written inline costs the agent its size twice: once to write the arguments and
 * once more when a harness echoes them. With `file` the agent's script writes the batch to disk
 * and the tool reads it from there.
 *
 * The format is the same for every tool that takes `file`: one JSON object holding the tool's own
 * list arguments under their own names.
 *
 *   model_add          {"elements": [...], "relationships": [...]}
 *   relationship_add   {"relationships": [...]}
 *   model_update       {"updates": [...]}
 *
 * The items are validated exactly as the inline lists are (the same schemas), a key the tool has
 * no list for is refused, and `file` cannot be combined with an inline list. A relative path is
 * read from the project root the call addresses (`rootPath` when it is sent), not from the
 * server's working directory.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z, type ZodRawShape } from "zod";
import { CLIError, ErrorCategory, getErrorMessage } from "../utils/errors.js";
import { unknownArgumentsMessage } from "./strict-schema.js";

/** The largest batch file read. A batch near this size is better sent as several. */
export const MAX_BATCH_FILE_BYTES = 64 * 1024 * 1024;

export const BATCH_FILE_DESCRIPTION =
  "Path to a JSON file holding the batch, instead of sending the lists inline: absolute, or relative to the " +
  "project root (rootPath's project when that is sent). Use it for a large batch written by a script, so the " +
  "items are not copied into the call.";

/** Where the first JSON syntax error is, for a message an agent can act on without the file's text. */
export interface JsonErrorPosition {
  offset: number;
  line: number;
  column: number;
  /** What was found there, e.g. `'}'` or `the end of the file`. */
  found: string;
  /** What JSON allows there. */
  expected: string;
}

/**
 * Finds the first syntax error in `text` read as JSON, or null when it is valid. JSON.parse says
 * what is wrong but not reliably where (and one runtime quotes the document back), so this walks
 * the text itself.
 */
export function locateJsonError(text: string): JsonErrorPosition | null {
  let i = 0;
  const fail = (offset: number, expected: string): JsonErrorPosition => {
    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - (before.lastIndexOf("\n") + 1) + 1;
    const found = offset >= text.length ? "the end of the file" : `'${text[offset]}'`;
    return { offset, line, column, found, expected };
  };
  const skip = () => {
    while (i < text.length && (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t")) i++;
  };
  const string = (): JsonErrorPosition | null => {
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return null;
      }
      if (ch === "\\") {
        const next = text[i + 1];
        if (next === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) return fail(i, "a \\u escape with four hex digits");
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
          i += 2;
        } else {
          return fail(i, "a valid escape (\\\", \\\\, \\/, \\b, \\f, \\n, \\r, \\t or \\uXXXX)");
        }
        continue;
      }
      if (ch < " ") return fail(i, "no raw control character inside a string (escape a line break as \\n)");
      i++;
    }
    return fail(i, "a closing '\"'");
  };
  const value = (): JsonErrorPosition | null => {
    skip();
    const ch = text[i];
    if (ch === "{") {
      i++;
      skip();
      if (text[i] === "}") {
        i++;
        return null;
      }
      for (;;) {
        skip();
        if (text[i] !== '"') return fail(i, "a property name in double quotes");
        const key = string();
        if (key) return key;
        skip();
        if (text[i] !== ":") return fail(i, "':' after the property name");
        i++;
        const member = value();
        if (member) return member;
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return null;
        }
        return fail(i, "',' or '}'");
      }
    }
    if (ch === "[") {
      i++;
      skip();
      if (text[i] === "]") {
        i++;
        return null;
      }
      for (;;) {
        const item = value();
        if (item) return item;
        skip();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return null;
        }
        return fail(i, "',' or ']'");
      }
    }
    if (ch === '"') return string();
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 400));
    if (literal) {
      i += literal[0].length;
      return null;
    }
    return fail(i, "a value (an object, a list, a string in double quotes, a number, true, false or null)");
  };

  const error = value();
  if (error) return error;
  skip();
  return i < text.length ? fail(i, "the end of the file (one JSON value only)") : null;
}

/**
 * Reads a batch file and returns its lists, validated with the tool's own item schemas.
 *
 * @param tool the tool's name, for the messages
 * @param file the `file` argument as sent
 * @param projectRoot the root of the project the call addresses; a relative `file` is read from it
 * @param lists the tool's list arguments (name → the same zod schema the inline argument has)
 */
export async function readBatchFile<Shape extends ZodRawShape>(
  tool: string,
  file: string,
  projectRoot: string,
  lists: Shape
): Promise<z.infer<z.ZodObject<Shape>>> {
  const resolved = path.isAbsolute(file) ? file : path.resolve(projectRoot, file);
  const names = Object.keys(lists);
  const shapeHint = `The file is one JSON object: {${names.map((name) => `"${name}": [...]`).join(", ")}}`;

  let size: number;
  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      throw new CLIError(`${tool}: ${resolved} is not a file`, ErrorCategory.USER, ["Pass the path of a JSON file"]);
    }
    size = info.size;
  } catch (error) {
    if (error instanceof CLIError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CLIError(`${tool}: no file at ${resolved}`, ErrorCategory.USER, [
        path.isAbsolute(file)
          ? "Check the path, or write the file first"
          : `A relative path is read from the project root (${projectRoot}); pass an absolute path for a file elsewhere`,
      ]);
    }
    throw new CLIError(`${tool}: cannot read ${resolved}: ${getErrorMessage(error)}`, ErrorCategory.USER);
  }
  if (size > MAX_BATCH_FILE_BYTES) {
    throw new CLIError(
      `${tool}: ${resolved} is ${Math.round(size / (1024 * 1024))} MB; a batch file can be at most ${MAX_BATCH_FILE_BYTES / (1024 * 1024)} MB`,
      ErrorCategory.USER,
      ["Split the batch into several files and call the tool once for each"]
    );
  }

  let text: string;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    throw new CLIError(`${tool}: cannot read ${resolved}: ${getErrorMessage(error)}`, ErrorCategory.USER);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // The locator recurses with the nesting: a file of nothing but "[" would overflow it.
    let at: JsonErrorPosition | null = null;
    try {
      at = locateJsonError(text);
    } catch {
      at = null;
    }
    throw new CLIError(
      at
        ? `${tool}: ${resolved} is not valid JSON: at line ${at.line}, column ${at.column}, found ${at.found} where JSON needs ${at.expected}`
        : `${tool}: ${resolved} is not valid JSON`,
      ErrorCategory.USER,
      [shapeHint]
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const what = Array.isArray(parsed) ? "a list" : parsed === null ? "null" : `a ${typeof parsed}`;
    throw new CLIError(`${tool}: ${resolved} holds ${what}, not a JSON object`, ErrorCategory.USER, [
      Array.isArray(parsed) && names.length > 0 ? `Wrap the list: {"${names[0]}": [...]}` : shapeHint,
    ]);
  }

  const unknown = Object.keys(parsed).filter((key) => !names.includes(key));
  if (unknown.length > 0) {
    throw new CLIError(
      unknownArgumentsMessage(`${tool}'s file`, names, unknown),
      ErrorCategory.USER,
      [shapeHint, "Other arguments (rootPath, verbose) go in the call, not the file"]
    );
  }
  if (names.every((name) => (parsed as Record<string, unknown>)[name] === undefined)) {
    throw new CLIError(`${tool}: ${resolved} has none of ${names.map((name) => `"${name}"`).join(", ")}`, ErrorCategory.USER, [
      shapeHint,
    ]);
  }

  const optional = Object.fromEntries(
    Object.entries(lists).map(([name, schema]) => [name, (schema as z.ZodType).optional()])
  ) as ZodRawShape;
  const checked = z.strictObject(optional).safeParse(parsed);
  if (!checked.success) {
    const issues = checked.error.issues;
    const shown = issues.slice(0, MAX_FILE_ISSUES).map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
    throw new CLIError(
      `${tool}: ${resolved} has ${issues.length} item${issues.length === 1 ? "" : "s"} the tool can't read; nothing was staged`,
      ErrorCategory.USER,
      [...shown, ...(issues.length > shown.length ? [`and ${issues.length - shown.length} more`] : [])]
    );
  }
  return checked.data as z.infer<z.ZodObject<Shape>>;
}

/** How many of a file's malformed items a refusal lists. */
const MAX_FILE_ISSUES = 20;

/** `elements[3].name` for a zod issue path. */
function formatIssuePath(issuePath: PropertyKey[]): string {
  return issuePath.reduce<string>(
    (out, part) => (typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part)),
    ""
  );
}
