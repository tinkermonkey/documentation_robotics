/**
 * Model File Structure Diagnostic Test
 * Helps identify specific differences between Python and Bun CLIs
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { CLIHarness, checkPythonCLIAvailable } from './harness.js';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';

const TEMP_DIR = '/tmp/dr-diagnostic-test';
let harness: CLIHarness;
let pythonTestDir: string;
let bunTestDir: string;
let pythonCLIAvailable = false;

// Helper to conditionally run tests based on Python CLI availability
function compatTest(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (!pythonCLIAvailable) {
      console.log(`⏭️  Skipping: ${name}`);
      return;
    }
    await fn();
  });
}

describe('Model File Structure Diagnostic', () => {
  beforeAll(async () => {
    pythonCLIAvailable = await checkPythonCLIAvailable();
  });

  beforeAll(async () => {
    if (!pythonCLIAvailable) return;

    harness = new CLIHarness();

    // Create test directories
    pythonTestDir = join(TEMP_DIR, 'python');
    bunTestDir = join(TEMP_DIR, 'bun');

    await mkdir(pythonTestDir, { recursive: true });
    await mkdir(bunTestDir, { recursive: true });
  });

  afterAll(async () => {
    if (!pythonCLIAvailable) return;

    // Cleanup
    try {
      await rm(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  compatTest('should show manifest differences after init', async () => {
    // Initialize models
    await harness.runPython(['init', '--name', 'DiagnosticModel'], pythonTestDir);
    await harness.runBun(['init', '--name', 'DiagnosticModel'], bunTestDir);

    // Read manifests
    const pythonManifest = JSON.parse(
      await readFile(join(pythonTestDir, '.dr', 'manifest.json'), 'utf-8')
    );
    const bunManifest = JSON.parse(
      await readFile(join(bunTestDir, '.dr', 'manifest.json'), 'utf-8')
    );

    console.log('\n=== PYTHON MANIFEST ===');
    console.log(JSON.stringify(pythonManifest, null, 2));

    console.log('\n=== BUN MANIFEST ===');
    console.log(JSON.stringify(bunManifest, null, 2));

    console.log('\n=== DIFFERENCES ===');
    const pythonKeys = Object.keys(pythonManifest).sort();
    const bunKeys = Object.keys(bunManifest).sort();

    console.log('Python keys:', pythonKeys);
    console.log('Bun keys:', bunKeys);

    const pythonOnlyKeys = pythonKeys.filter(k => !bunKeys.includes(k));
    const bunOnlyKeys = bunKeys.filter(k => !pythonKeys.includes(k));

    if (pythonOnlyKeys.length > 0) {
      console.log('Keys only in Python:', pythonOnlyKeys);
    }
    if (bunOnlyKeys.length > 0) {
      console.log('Keys only in Bun:', bunOnlyKeys);
    }

    const commonKeys = pythonKeys.filter(k => bunKeys.includes(k));
    for (const key of commonKeys) {
      if (JSON.stringify(pythonManifest[key]) !== JSON.stringify(bunManifest[key])) {
        console.log(`\nKey '${key}' differs:`);
        console.log('  Python:', JSON.stringify(pythonManifest[key]));
        console.log('  Bun:', JSON.stringify(bunManifest[key]));
      }
    }

    // This test always passes - it's just for diagnostics
    expect(true).toBe(true);
  });

  compatTest('should show business layer differences after adding element', async () => {
    // Add business service to both
    await harness.runPython(
      ['add', 'business', 'service', 'test-service', '--name', 'Test Service'],
      pythonTestDir
    );
    await harness.runBun(
      ['add', 'business', 'service', 'test-service', '--name', 'Test Service'],
      bunTestDir
    );

    // Read business layers
    const pythonLayer = JSON.parse(
      await readFile(join(pythonTestDir, '.dr', 'layers', 'business.json'), 'utf-8')
    );
    const bunLayer = JSON.parse(
      await readFile(join(bunTestDir, '.dr', 'layers', 'business.json'), 'utf-8')
    );

    console.log('\n=== PYTHON BUSINESS LAYER ===');
    console.log(JSON.stringify(pythonLayer, null, 2));

    console.log('\n=== BUN BUSINESS LAYER ===');
    console.log(JSON.stringify(bunLayer, null, 2));

    console.log('\n=== LAYER STRUCTURE DIFFERENCES ===');
    const pythonKeys = Object.keys(pythonLayer).sort();
    const bunKeys = Object.keys(bunLayer).sort();

    console.log('Python keys:', pythonKeys);
    console.log('Bun keys:', bunKeys);

    if (pythonLayer.elements && bunLayer.elements) {
      console.log('\n=== ELEMENT COMPARISON ===');
      console.log('Python elements count:', pythonLayer.elements.length);
      console.log('Bun elements count:', bunLayer.elements.length);

      if (pythonLayer.elements.length > 0 && bunLayer.elements.length > 0) {
        const pythonElement = pythonLayer.elements[0];
        const bunElement = bunLayer.elements[0];

        console.log('\nPython element keys:', Object.keys(pythonElement).sort());
        console.log('Bun element keys:', Object.keys(bunElement).sort());

        for (const key of Object.keys(pythonElement)) {
          if (JSON.stringify(pythonElement[key]) !== JSON.stringify(bunElement[key])) {
            console.log(`\nElement field '${key}' differs:`);
            console.log('  Python:', JSON.stringify(pythonElement[key]));
            console.log('  Bun:', JSON.stringify(bunElement[key]));
          }
        }
      }
    }

    // This test always passes - it's just for diagnostics
    expect(true).toBe(true);
  });
});
