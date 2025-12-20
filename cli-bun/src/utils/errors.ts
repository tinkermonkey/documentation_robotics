/**
 * Error handling utilities with formatted output
 * Matches Python CLI error message formatting
 */

import ansis from 'ansis';

export class CLIError extends Error {
  constructor(
    message: string,
    public exitCode: number = 1,
    public suggestions?: string[]
  ) {
    super(message);
    this.name = 'CLIError';
  }

  format(): string {
    const lines: string[] = [];

    lines.push(ansis.red(`Error: ${this.message}`));

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
    suggestions?: string[]
  ) {
    super(message, 1, suggestions);
    this.name = 'ValidationError';
  }

  format(): string {
    const lines: string[] = [];

    lines.push(ansis.red(`Error: ${this.message}`));

    if (this.errors.length > 0) {
      lines.push('');
      lines.push(ansis.dim('Details:'));
      for (const error of this.errors) {
        let detail = '';
        if (error.layer && error.elementId) {
          detail = `  [${error.layer}:${error.elementId}] ${error.message}`;
        } else if (error.layer) {
          detail = `  [${error.layer}] ${error.message}`;
        } else {
          detail = `  ${error.message}`;
        }
        lines.push(ansis.dim(detail));
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
    super(message, 2, [
      `Check that the path is correct: ${path}`,
      'Use "dr init" to create a new model',
      'Use "dr list <layer>" to see available elements',
    ]);
    this.name = 'FileNotFoundError';
  }
}

export class ElementNotFoundError extends CLIError {
  constructor(elementId: string) {
    super(
      `Element not found: ${elementId}`,
      2,
      [
        `Use "dr search ${elementId}" to find similar elements`,
        'Use "dr list <layer>" to list all elements in a layer',
        'Check the element ID format: {layer}-{type}-{kebab-case-name}',
      ]
    );
    this.name = 'ElementNotFoundError';
  }
}

export class ModelNotFoundError extends CLIError {
  constructor(rootPath: string = '.') {
    super(
      `No model found at ${rootPath}`,
      2,
      [`Run "dr init" to initialize a new model`, 'Check that you are in the correct directory']
    );
    this.name = 'ModelNotFoundError';
  }
}

export class InvalidJSONError extends CLIError {
  constructor(input: string, context?: string) {
    const message = context ? `Invalid JSON in ${context}` : 'Invalid JSON format';
    super(message, 1, [
      `Check your JSON syntax: ${input}`,
      'Use single quotes to wrap JSON: --properties \'{"key":"value"}\'',
      'Escape special characters properly',
    ]);
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
    process.exit(1);
  } else {
    console.error(ansis.red('An unexpected error occurred'));
    if (process.env.DEBUG) {
      console.error(ansis.dim(String(error)));
    }
    process.exit(1);
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
