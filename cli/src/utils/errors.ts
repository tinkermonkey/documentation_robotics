/**
 * Error handling utilities with formatted output
 * Matches Python CLI error message formatting
 *
 * Error Categories:
 * - User Error (exit code 1): Invalid input, wrong format, element exists
 * - Not Found (exit code 2): File/element/model not found
 * - System Error (exit code 3): Permission denied, I/O failure
 * - Validation Error (exit code 4): Schema/reference/semantic validation failed
 * - Breaking Change (exit code 5): Version migration required
 */

import ansis from 'ansis';

const MAX_SUGGESTIONS = 5;

export enum ErrorCategory {
  USER = 1,
  NOT_FOUND = 2,
  SYSTEM = 3,
  VALIDATION = 4,
  BREAKING_CHANGE = 5,
}

export interface ErrorContext {
  operation?: string;
  context?: string;
  relatedElements?: string[];
  partialProgress?: { completed: number; total: number };
}

export class CLIError extends Error {
  constructor(
    message: string,
    public exitCode: number = ErrorCategory.USER,
    public suggestions?: string[],
    public context?: ErrorContext
  ) {
    super(message);
    this.name = 'CLIError';
  }

  format(): string {
    const lines: string[] = [];

    lines.push(ansis.red(`Error: ${this.message}`));

    if (this.context?.operation) {
      lines.push(ansis.dim(`During: ${this.context.operation}`));
    }

    if (this.context?.partialProgress) {
      const { completed, total } = this.context.partialProgress;
      lines.push(
        ansis.yellow(
          `⚠ Partial progress: ${completed}/${total} completed (operation rolled back)`
        )
      );
    }

    if (this.context?.relatedElements && this.context.relatedElements.length > 0) {
      lines.push(ansis.dim('Related elements:'));
      for (const elem of this.context.relatedElements.slice(0, MAX_SUGGESTIONS)) {
        lines.push(ansis.dim(`  • ${elem}`));
      }
      if (this.context.relatedElements.length > MAX_SUGGESTIONS) {
        lines.push(ansis.dim(`  ... and ${this.context.relatedElements.length - MAX_SUGGESTIONS} more`));
      }
    }

    if (this.suggestions && this.suggestions.length > 0) {
      lines.push('');
      lines.push(ansis.dim('Suggestions:'));
      for (const suggestion of this.suggestions) {
        lines.push(ansis.dim(`  • ${suggestion}`));
      }
    }

    return lines.join('\n');
  }
}

export class ValidationError extends CLIError {
  constructor(
    message: string,
    public errors: Array<{ layer?: string; elementId?: string; message: string }> = [],
    suggestions?: string[],
    context?: ErrorContext
  ) {
    super(message, ErrorCategory.VALIDATION, suggestions, context);
    this.name = 'ValidationError';
  }

  format(): string {
    const lines: string[] = [];

    lines.push(ansis.red(`Error: ${this.message}`));

    if (this.errors.length > 0) {
      // Show error count and grouping
      const errorsByLayer: Record<string, Array<{ elementId?: string; message: string }>> = {};
      for (const error of this.errors) {
        const layer = error.layer || 'general';
        if (!errorsByLayer[layer]) {
          errorsByLayer[layer] = [];
        }
        errorsByLayer[layer].push({ elementId: error.elementId, message: error.message });
      }

      lines.push('');
      lines.push(ansis.dim(`Validation errors: ${this.errors.length} found`));
      lines.push('');

      const layerNames = Object.keys(errorsByLayer).sort();

      for (const layer of layerNames) {
        const layerErrors = errorsByLayer[layer];
        lines.push(ansis.dim(`  [${layer}] ${layerErrors.length} error(s):`));

        for (let i = 0; i < Math.min(layerErrors.length, MAX_SUGGESTIONS); i++) {
          const error = layerErrors[i];
          let detail = '';
          if (error.elementId) {
            detail = `    ${error.elementId}: ${error.message}`;
          } else {
            detail = `    ${error.message}`;
          }
          lines.push(ansis.dim(detail));
        }

        if (layerErrors.length > MAX_SUGGESTIONS) {
          lines.push(
            ansis.dim(`    ... and ${layerErrors.length - MAX_SUGGESTIONS} more in this layer`)
          );
        }
      }
    }

    if (this.suggestions && this.suggestions.length > 0) {
      lines.push('');
      lines.push(ansis.dim('Suggestions:'));
      for (const suggestion of this.suggestions) {
        lines.push(ansis.dim(`  • ${suggestion}`));
      }
    }

    return lines.join('\n');
  }
}

export class FileNotFoundError extends CLIError {
  constructor(path: string, context?: string) {
    const message = context ? `${context}: ${path}` : `File not found: ${path}`;
    super(
      message,
      ErrorCategory.NOT_FOUND,
      [
        `Check that the path is correct: ${path}`,
        'Use "dr init" to create a new model',
        'Use "dr list <layer>" to see available elements',
      ]
    );
    this.name = 'FileNotFoundError';
  }
}

export class ElementNotFoundError extends CLIError {
  constructor(elementId: string) {
    super(
      `Element not found: ${elementId}`,
      ErrorCategory.NOT_FOUND,
      [
        `Use "dr search ${elementId}" to find similar elements`,
        'Use "dr list <layer>" to list all elements in a layer',
        'Check the element ID format: {layer}.{type}.{kebab-case-name}',
      ]
    );
    this.name = 'ElementNotFoundError';
  }
}

export class ModelNotFoundError extends CLIError {
  constructor(rootPath: string = '.') {
    super(
      `No model found at ${rootPath}`,
      ErrorCategory.NOT_FOUND,
      [`Run "dr init" to initialize a new model`, 'Check that you are in the correct directory']
    );
    this.name = 'ModelNotFoundError';
  }
}

export class InvalidJSONError extends CLIError {
  constructor(input: string, context?: string) {
    const message = context ? `Invalid JSON in ${context}` : 'Invalid JSON format';
    super(
      message,
      ErrorCategory.USER,
      [
        `Check your JSON syntax: ${input}`,
        'Use single quotes to wrap JSON: --properties \'{"key":"value"}\'',
        'Escape special characters properly',
      ]
    );
    this.name = 'InvalidJSONError';
  }
}

export function handleError(error: unknown): never {
  if (error instanceof CLIError) {
    console.error(error.format());
    process.exit(error.exitCode);
  } else if (error instanceof Error) {
    console.error(ansis.red(`Error: ${error.message}`));
    if (process.env.DEBUG) {
      console.error(ansis.dim(error.stack));
    }
    process.exit(ErrorCategory.USER);
  } else {
    console.error(ansis.red('An unexpected error occurred'));
    if (process.env.DEBUG) {
      console.error(ansis.dim(String(error)));
    }
    process.exit(ErrorCategory.SYSTEM);
  }
}

export function handleWarning(message: string, suggestions?: string[]): void {
  const lines: string[] = [];
  lines.push(ansis.yellow(`Warning: ${message}`));
  if (suggestions && suggestions.length > 0) {
    lines.push('');
    lines.push(ansis.dim('Suggestions:'));
    for (const suggestion of suggestions) {
      lines.push(ansis.dim(`  • ${suggestion}`));
    }
  }
  console.warn(lines.join('\n'));
}

export function handleSuccess(message: string, details?: Record<string, string>): void {
  console.log(ansis.green(`✓ ${message}`));
  if (details) {
    for (const [key, value] of Object.entries(details)) {
      console.log(ansis.dim(`  ${key}: ${value}`));
    }
  }
}

/**
 * Utility to extract common valid options for better error suggestions
 */
export function formatValidOptions(options: string[], heading: string = 'Valid options'): string {
  if (options.length === 0) return '';
  if (options.length === 1) return `${heading}: ${options[0]}`;
  return `${heading}: ${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`;
}

/**
 * Simple fuzzy match to find similar strings (for typo suggestions)
 */
export function findSimilar(input: string, options: string[], maxDistance: number = 2): string[] {
  return options
    .map((option) => ({
      option,
      distance: levenshteinDistance(input.toLowerCase(), option.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(({ option }) => option);
}

/**
 * Calculate Levenshtein distance for typo detection
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
