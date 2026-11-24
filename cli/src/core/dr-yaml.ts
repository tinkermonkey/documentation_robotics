/**
 * The layout dr writes its YAML files in: the model (element files, relationships.yaml, the
 * manifest) and the changesets.
 *
 * It is a layout prettier leaves alone at its default settings (#1246), so a project that runs
 * prettier on these files (a pre-commit hook, format-on-save, a project where `dr init` found no
 * sign of prettier and wrote no `.prettierignore` entry) does not rewrite what dr wrote, and the
 * next dr write does not rewrite it back:
 *
 * - **No folding.** A long string stays on its key's line, whatever its length. yaml's default
 *   folds it at 80 columns starting on the key's line, while prettier moves a folded scalar to the
 *   next line, so each undid the other. With `proseWrap: "preserve"` (prettier's default) prettier
 *   leaves a one-line scalar as it is. A one-word edit is also a one-line diff.
 * - **prettier's quotes.** A string that has to be quoted is single-quoted when it holds a double
 *   quote, else double-quoted, as prettier's YAML printer picks it (a double-quoted string whose
 *   only escapes are `\"` becomes single-quoted, whatever its count of `'`). yaml picks by its own
 *   rule (`"it's: \"x\""`), which prettier then rewrites. A string with a line break or another
 *   control character keeps yaml's choice: its escapes make prettier keep it as it is.
 *
 * Which strings are quoted, and block scalars for multi-line strings, are yaml's choices, and
 * prettier keeps both.
 */

import yaml from "yaml";

/** Plain scalars a YAML 1.1 reader takes for booleans (PyYAML, Ruby, older tooling). */
const YAML_1_1_BOOLEAN = /^(y|n|yes|no|on|off)$/i;

/** yaml's options for every file dr writes in its layout. */
const LAYOUT = { lineWidth: 0 } as const;

export interface DrYamlOptions {
  /**
   * Quote the string values a YAML 1.1 reader would take for booleans (`on`, `off`, `yes`, `no`,
   * `y`, `n`), so an enum value such as `off` stays a string for every reader, not only for YAML
   * 1.2 ones. Keys are left as they are. Used for changeset files.
   */
  quoteYaml11Booleans?: boolean;
}

/** Characters a quoted YAML string can only hold escaped (or folded): line breaks, tabs, controls. */
const NEEDS_ESCAPE = /[\u0000-\u001f\u007f]/;

/** How prettier quotes a string that has to be quoted, or null to keep yaml's choice. */
function prettierQuote(value: string): "QUOTE_DOUBLE" | "QUOTE_SINGLE" | null {
  if (NEEDS_ESCAPE.test(value)) return null;
  return value.includes('"') ? "QUOTE_SINGLE" : "QUOTE_DOUBLE";
}

/** Whether yaml, left to itself, writes this string quoted (not plain, not a block scalar). */
function yamlQuotes(value: string): boolean {
  const first = yaml.stringify(value, LAYOUT).charAt(0);
  return first === '"' || first === "'";
}

/** A value as the text of a YAML file in dr's layout (see the module doc). */
export function stringifyDrYaml(value: unknown, options: DrYamlOptions = {}): string {
  const document = new yaml.Document(value);
  yaml.visit(document, {
    Scalar(key, node) {
      if (typeof node.value !== "string") return;
      if (options.quoteYaml11Booleans && key !== "key" && YAML_1_1_BOOLEAN.test(node.value)) {
        node.type = "QUOTE_DOUBLE";
        return;
      }
      // Only a string holding a quote can get a different quote from prettier than from yaml
      if ((node.value.includes('"') || node.value.includes("'")) && yamlQuotes(node.value)) {
        const quote = prettierQuote(node.value);
        if (quote) node.type = quote;
      }
    },
  });
  return document.toString(LAYOUT);
}
