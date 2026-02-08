/**
 * Validation result types and classes
 */

/**
 * A single validation issue
 */
export interface ValidationIssue {
  layer: string;
  elementId?: string;
  message: string;
  severity: "error" | "warning";
  location?: string;
  fixSuggestion?: string;
}

/**
 * Result of a validation operation
 */
export class ValidationResult {
  errors: ValidationIssue[] = [];
  warnings: ValidationIssue[] = [];

  /**
   * Check if validation passed (no errors)
   */
  isValid(): boolean {
    return this.errors.length === 0;
  }

  /**
   * Add an error to the result
   */
  addError(issue: Omit<ValidationIssue, "severity">): void {
    this.errors.push({ ...issue, severity: "error" });
  }

  /**
   * Add a warning to the result
   */
  addWarning(issue: Omit<ValidationIssue, "severity">): void {
    this.warnings.push({ ...issue, severity: "warning" });
  }

  /**
   * Merge another validation result into this one
   */
  merge(other: ValidationResult, prefix?: string): void {
    const addPrefix = (issue: ValidationIssue): ValidationIssue => ({
      ...issue,
      message: prefix ? `${prefix}: ${issue.message}` : issue.message,
    });

    this.errors.push(...other.errors.map(addPrefix));
    this.warnings.push(...other.warnings.map(addPrefix));
  }

  /**
   * Convert to dictionary representation
   */
  toDict(): Record<string, unknown> {
    return {
      valid: this.isValid(),
      errors: this.errors,
      warnings: this.warnings,
      errorCount: this.errors.length,
      warningCount: this.warnings.length,
    };
  }
}
