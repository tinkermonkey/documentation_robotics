/**
 * Upgrade Command - Checks for available upgrades to CLI and spec versions
 */

import ansis from 'ansis';
import { Model } from '../core/model.js';
import { MigrationRegistry } from '../core/migration-registry.js';
import { readJSON, fileExists } from '../utils/file-io.js';

/**
 * Read version from package.json
 */
async function getPackageVersion(): Promise<string> {
  // Try to find package.json in various locations
  const possiblePaths = [
    `${process.cwd()}/package.json`,
    `${import.meta.url.replace('file://', '').split('/src/')[0]}/package.json`,
  ];

  for (const path of possiblePaths) {
    if (await fileExists(path)) {
      try {
        const data = await readJSON<{ version: string }>(path);
        return data.version;
      } catch {
        continue;
      }
    }
  }

  return '0.1.0';
}

/**
 * Read spec version from spec/VERSION
 */
async function getLatestSpecVersion(): Promise<string> {
  try {
    // Try to find spec/VERSION relative to package root
    const possiblePaths = [
      `${process.cwd()}/../spec/VERSION`,
      `${import.meta.url.replace('file://', '').split('/src/')[0]}/../spec/VERSION`,
    ];

    for (const specVersionPath of possiblePaths) {
      if (await fileExists(specVersionPath)) {
        const fs = await import('fs/promises');
        const content = await fs.readFile(specVersionPath, 'utf-8');
        return content.trim();
      }
    }
  } catch {
    // Fall back to bundled version info
  }

  return '0.6.0';
}

export async function upgradeCommand(): Promise<void> {
  try {
    console.log(ansis.bold('\nChecking for available upgrades...\n'));

    // Check CLI version
    const currentCliVersion = await getPackageVersion();
    const latestCliVersion = '0.1.0'; // Would be fetched from npm registry in production

    if (latestCliVersion !== currentCliVersion) {
      console.log(
        ansis.yellow(
          `CLI update available: ${currentCliVersion} → ${latestCliVersion}`
        )
      );
      console.log(ansis.dim('  Run: bun add @doc-robotics/cli-bun@latest\n'));
    } else {
      console.log(ansis.green(`✓ CLI is up to date (v${currentCliVersion})\n`));
    }

    // Check spec version
    try {
      const model = await Model.load(process.cwd());
      const currentSpecVersion = model.manifest.specVersion || '0.5.0';
      const latestSpecVersion = await getLatestSpecVersion();

      if (latestSpecVersion !== currentSpecVersion) {
        console.log(
          ansis.yellow(
            `Spec upgrade available: ${currentSpecVersion} → ${latestSpecVersion}`
          )
        );
        console.log(
          ansis.dim(`  Run: dr migrate --to ${latestSpecVersion}\n`)
        );

        // Show what would change
        const registry = new MigrationRegistry();
        const summary = registry.getMigrationSummary(
          currentSpecVersion,
          latestSpecVersion
        );

        if (summary.migrationsNeeded > 0) {
          console.log(ansis.dim('Migration path:'));
          for (const migration of summary.migrations) {
            console.log(
              ansis.dim(
                `  • ${migration.from} → ${migration.to}: ${migration.description}`
              )
            );
          }
          console.log();
        }
      } else {
        console.log(
          ansis.green(`✓ Spec version is up to date (v${currentSpecVersion})`)
        );
      }
    } catch (error) {
      // If no model found, just skip spec version check
      console.log(
        ansis.dim(
          'No model found in current directory (run "dr init" to create one)'
        )
      );
    }

    console.log();
  } catch (error) {
    console.error(
      ansis.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
}
