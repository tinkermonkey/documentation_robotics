/**
 * Error handling utilities for consistent error message extraction and formatting
 */

/**
 * Extracts a readable error message from an unknown error object
 * @param error - The error object (can be Error instance or any value)
 * @returns A string representation of the error message
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Gets the full error details including stack trace if available
 * @param error - The error object
 * @returns Error message with optional stack trace
 */
export function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ? error.stack : error.message;
  }
  return String(error);
}
