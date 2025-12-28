/**
 * Version Command - Display CLI and embedded spec versions
 */

import ansis from 'ansis';
import { readJSON, fileExists } from '../utils/file-io.js';

/**
 * Read CLI version from package.json
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
 * Read embedded spec version from spec/VERSION
 */
async function getEmbeddedSpecVersion(): Promise<string> {
  try {
    // Try to find spec/VERSION relative to package root
    const possiblePaths = [
      `${process.cwd()}/../spec/VERSION`,
      `${import.meta.url.replace('file://', '').split('/src/')[0]}/../spec/VERSION`,
      `${import.meta.url.replace('file://', '').split('/cli/')[0]}/spec/VERSION`,
    ];

    for (const specVersionPath of possiblePaths) {
      if (await fileExists(specVersionPath)) {
        const fs = await import('fs/promises');
        const content = await fs.readFile(specVersionPath, 'utf-8');
        return content.trim();
      }
    }
  } catch {
    // Fall back to default version
  }

  return '0.6.0';
}

export async function versionCommand(): Promise<void> {
  const cliVersion = await getPackageVersion();
  const specVersion = await getEmbeddedSpecVersion();

  console.log(ansis.bold('Documentation Robotics CLI'));
  console.log(`CLI Version:  ${ansis.cyan(cliVersion)}`);
  console.log(`Spec Version: ${ansis.cyan(specVersion)}`);
}
