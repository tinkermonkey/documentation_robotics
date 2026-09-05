/**
 * Markdown table formatting utilities
 */

/**
 * Format a markdown table with proper column alignment and padding
 * @param headers Array of header strings
 * @param rows Array of row arrays (each row is an array of cell strings)
 * @returns Formatted markdown table string with pipe delimiters
 */
export function formatMarkdownTable(headers: string[], rows: string[][]): string {
  // Calculate column widths based on content
  const colWidths = headers.map((h, i) => {
    let width = h.length;
    for (const row of rows) {
      width = Math.max(width, (row[i] || "").length);
    }
    return width;
  });

  // Build header row
  const headerRow = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join(" | ");

  // Build separator row
  const sepRow = colWidths.map((w) => "-".repeat(w)).join(" | ");

  // Build data rows
  const dataRows = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ")
  );

  return `| ${headerRow} |\n| ${sepRow} |\n${dataRows.map((r) => `| ${r} |`).join("\n")}\n`;
}
