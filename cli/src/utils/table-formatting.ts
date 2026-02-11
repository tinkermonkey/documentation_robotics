/**
 * Table formatting constants for consistent column widths
 * Used across list, search, and info commands for uniform output
 */

export const TABLE_COLUMN_WIDTHS = {
  // Single element display (list command)
  LIST_ID_WIDTH: 30,
  LIST_TYPE_WIDTH: 15,
  LIST_NAME_WIDTH: 35,

  // Search results display
  SEARCH_LAYER_WIDTH: 12,
  SEARCH_ID_WIDTH: 28,
  SEARCH_TYPE_WIDTH: 12,
  SEARCH_NAME_WIDTH: 28,

  // Info/summary display
  INFO_ID_WIDTH: 20,
  INFO_COUNT_WIDTH: 10,
} as const;

export const TABLE_SEPARATOR = "─".repeat(80);
