/**
 * Initialize a new Documentation Robotics model
 */

import { intro, text, outro } from '@clack/prompts';
import ansis from 'ansis';
import { Model } from '../core/model.js';
import { fileExists } from '../utils/file-io.js';
import { logVerbose, logDebug } from '../utils/globals.js';
import { installSpecReference } from '../utils/spec-installer.js';

export interface InitOptions {
  name?: string;
  author?: string;
  description?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  intro(ansis.bold(ansis.blue('⚙️  Initialize Documentation Robotics Model')));

  try {
    const rootPath = process.cwd();
    // Use Python CLI structure: documentation-robotics/model/
    const modelPath = `${rootPath}/documentation-robotics/model`;
    const manifestPath = `${modelPath}/manifest.yaml`;

    // Check if model already exists
    if (await fileExists(manifestPath)) {
      console.error(ansis.red('Error: Model already initialized in this directory'));
      process.exit(1);
    }

    // Gather model metadata
    // Check if stdin is a TTY to determine if we should prompt
    const isInteractive = process.stdin.isTTY;

    const name =
      options.name ||
      (isInteractive
        ? await text({
            message: 'Model name:',
            validate: (value) => (value.length === 0 ? 'Name is required' : undefined),
          })
        : (() => {
            console.error(ansis.red('Error: Model name is required (use --name option)'));
            process.exit(1);
          })());

    const description =
      options.description ||
      (isInteractive
        ? await text({
            message: 'Description (optional):',
            defaultValue: '',
          })
        : '');

    const author =
      options.author ||
      (isInteractive
        ? await text({
            message: 'Author (optional):',
            defaultValue: '',
          })
        : '');

    // Initialize model
    logDebug(`Creating model directory at ${rootPath}/documentation-robotics/model`);
    const model = await Model.init(
      rootPath,
      {
        name: name as string,
        version: '0.1.0',
        description: (description as string) || undefined,
        author: (author as string) || undefined,
        specVersion: '0.6.0',
        created: new Date().toISOString(),
      },
      { lazyLoad: false }
    );

    logVerbose(`Model saved with:
  - Version: 0.1.0
  - Spec Version: 0.6.0
  - Location: ${rootPath}/documentation-robotics/model`);

    // Install spec reference (.dr/ folder)
    logDebug('Installing spec reference (.dr/ folder)...');
    await installSpecReference(rootPath, false);
    logVerbose('Spec reference installed');

    outro(ansis.green(`✓ Model initialized: ${ansis.bold(model.manifest.name)}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
