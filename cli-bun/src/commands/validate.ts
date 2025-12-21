/**
 * Validate the architecture model
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { Validator } from '../validators/validator.js';
import { fileExists } from '../utils/file-io.js';

export interface ValidateOptions {
  layers?: string[];
  strict?: boolean;
  verbose?: boolean;
  debug?: boolean;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  try {
    const rootPath = process.cwd();

    // Check if model exists
    if (!(await fileExists(`${rootPath}/.dr/manifest.json`))) {
      console.error(ansis.red('Error: No model found. Run "dr init" first.'));
      process.exit(1);
    }

    // Load model
    const model = await Model.load(rootPath, { lazyLoad: false });

    // Validate
    const validator = new Validator();

    console.log('');
    console.log(ansis.bold('Validating model...'));
    console.log('');

    const result = await validator.validateModel(model);

    // Display errors
    if (result.errors.length > 0) {
      console.log(ansis.bold(ansis.red(`✗ ${result.errors.length} error(s):`)));
      console.log('');
      for (const error of result.errors) {
        console.log(ansis.red(`  [${error.layer}] ${error.message}`));
        if (error.elementId) {
          console.log(ansis.dim(`    Element: ${error.elementId}`));
        }
        if (error.fixSuggestion) {
          console.log(ansis.dim(`    → Suggestion: ${error.fixSuggestion}`));
        }
      }
      console.log('');
    }

    // Display warnings
    if (result.warnings.length > 0) {
      console.log(ansis.bold(ansis.yellow(`⚠ ${result.warnings.length} warning(s):`)));
      console.log('');
      for (const warning of result.warnings) {
        console.log(ansis.yellow(`  [${warning.layer}] ${warning.message}`));
        if (warning.elementId) {
          console.log(ansis.dim(`    Element: ${warning.elementId}`));
        }
        if (warning.fixSuggestion) {
          console.log(ansis.dim(`    → Suggestion: ${warning.fixSuggestion}`));
        }
      }
      console.log('');
    }

    // Display summary
    if (result.isValid()) {
      if (result.warnings.length === 0) {
        console.log(ansis.green('✓ Validation passed'));
        console.log('');
        process.exit(0);
      } else {
        console.log(
          ansis.yellow(
            `✓ Validation passed with ${result.warnings.length} warning(s)`
          )
        );
        console.log('');
        if (options.strict) {
          console.log(ansis.red('Strict mode enabled: treating warnings as errors'));
          process.exit(1);
        } else {
          process.exit(0);
        }
      }
    } else {
      console.log(
        ansis.red(`✗ Validation failed with ${result.errors.length} error(s)`)
      );
      console.log('');
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    if (process.env.DEBUG) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}
