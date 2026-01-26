import { Model } from './src/core/model.js';
import { StagingAreaManager } from './src/core/staging-area.js';
import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = '/tmp/test-backup-manifest';
const BASELINE_DIR = fileURLToPath(new URL('../cli-validation/test-project/baseline', import.meta.url));

try {
  await mkdir(TEST_DIR, { recursive: true });
  const model = await Model.load(TEST_DIR, { lazyLoad: false });
  const manager = new StagingAreaManager(TEST_DIR, model);
  
  // Create a backup
  const backupDir = await (manager as any).backupModel(model);
  console.log('Backup created at:', backupDir);
  
  // Read the manifest
  const manifestPath = path.join(backupDir, '.backup-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  
  console.log('Manifest:', JSON.stringify(manifest, null, 2));
  console.log('Number of files:', manifest.files.length);
  
  // List layers
  const layersDir = path.join(backupDir, 'layers');
  const { readdir } = await import('fs/promises');
  const layers = await readdir(layersDir);
  console.log('Layers in backup:', layers);
  
  for (const layer of layers) {
    const files = await readdir(path.join(layersDir, layer));
    console.log(`  ${layer}: ${files.length} files`);
  }
  
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
