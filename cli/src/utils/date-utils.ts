/**
 * Date utility functions
 */

/**
 * Formats a timestamp as a human-readable date string
 * @param timestamp ISO 8601 timestamp string
 * @returns Formatted date string in format "YYYY-MM-DD HH:MM:SS"
 */
export function formatDate(timestamp: string): string {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
}
