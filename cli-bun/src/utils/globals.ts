/**
 * Global CLI option management
 */

export interface GlobalOptions {
  verbose?: boolean;
  debug?: boolean;
}

// Global state for CLI options
let globalOptions: GlobalOptions = {};

/**
 * Set global CLI options
 */
export function setGlobalOptions(options: GlobalOptions): void {
  globalOptions = { ...globalOptions, ...options };
}

/**
 * Get current global options
 */
export function getGlobalOptions(): GlobalOptions {
  return { ...globalOptions };
}

/**
 * Check if verbose mode is enabled
 */
export function isVerbose(): boolean {
  return globalOptions.verbose === true;
}

/**
 * Check if debug mode is enabled
 */
export function isDebug(): boolean {
  return globalOptions.debug === true;
}

/**
 * Log verbose messages
 */
export function logVerbose(message: string): void {
  if (isVerbose()) {
    console.log(message);
  }
}

/**
 * Log debug messages
 */
export function logDebug(message: string): void {
  if (isDebug()) {
    console.debug(`[DEBUG] ${message}`);
  }
}
