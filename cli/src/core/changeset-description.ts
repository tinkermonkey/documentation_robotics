/**
 * A changeset's description is its intent, written as markdown: CommonMark, GitHub flavoured
 * (lists, code spans, emphasis, links, short headings), without raw HTML, which readers may strip.
 * Plain text is valid markdown, so older descriptions need nothing. It is stored and returned as
 * written (metadata.yaml keeps its line breaks in a block scalar); these helpers only print it in
 * a terminal, where it stays raw with its line breaks kept (#1210).
 */

/** What every changeset description is, in the words the tools, the CLI and the API docs use. */
export const DESCRIPTION_IS_MARKDOWN =
  "markdown (CommonMark, GitHub flavoured: lists, code spans, emphasis, links, short headings; no raw HTML)";

/**
 * A description as terminal lines: as written, each line indented, blank lines kept, so a list or
 * a heading reads as it does in the file. Trailing blank lines are dropped. Empty for none.
 */
export function descriptionLines(description: string | undefined, indent = "  "): string[] {
  if (!description || description.trim() === "") return [];
  const lines = description.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((line) => (line.trim() === "" ? "" : `${indent}${line}`));
}

/**
 * The first line of a description with text, cut to `width` characters, with " …" when the line
 * was cut or more lines follow: what `dr changeset list` shows. Empty for none.
 */
export function descriptionExcerpt(description: string | undefined, width = 100): string {
  if (!description) return "";
  const lines = description
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return "";
  const first = lines[0];
  if (first.length > width) return `${first.slice(0, width).trimEnd()} …`;
  return lines.length > 1 ? `${first} …` : first;
}
