import * as esbuild from 'esbuild';
import { globSync } from 'glob';
import { renameSync, rmSync, cpSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const isDebug = process.env.DR_TELEMETRY === 'true';

// Capture git hash at build time
let gitHash = 'unknown';
try {
  gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch (error) {
  console.warn('Warning: Could not determine git hash. Build may not be in a git repository.');
}

// Find all compiled JS files to process with esbuild
// This processes all dist/**/*.js files but keeps module structure
const entryPoints = globSync('dist/**/*.js');

// Validate that TypeScript compilation produced output
if (entryPoints.length === 0) {
  console.error('Error: No JavaScript files found in dist/. Did tsc compilation succeed?');
  process.exit(1);
}

// Clean up previous temp directory if it exists
rmSync('dist.tmp', { recursive: true, force: true });

await esbuild.build({
  entryPoints,
  outdir: 'dist.tmp',
  bundle: false, // Don't bundle - keep module structure
  platform: 'node',
  target: 'node18',
  format: 'esm',
  define: {
    'TELEMETRY_ENABLED': isDebug ? 'true' : 'false',
    'GIT_HASH': JSON.stringify(gitHash),
  },
  minifySyntax: true, // Enables dead branch elimination for if(TELEMETRY_ENABLED)
  sourcemap: true,
});

// Replace dist with processed version
rmSync('dist', { recursive: true, force: true });
renameSync('dist.tmp', 'dist');

// Copy integration directories to dist/integrations/
// These are bundled with the CLI so they're available in production
const integrationDirs = ['claude_code', 'github_copilot'];
for (const dir of integrationDirs) {
  const srcPath = join('..', 'integrations', dir);
  const destPath = join('dist', 'integrations', dir);
  try {
    cpSync(srcPath, destPath, { recursive: true, force: true });
  } catch (error) {
    // Silently ignore if integration directory doesn't exist yet
  }
}

console.log(
  `✓ Build complete (${isDebug ? 'debug with telemetry' : 'production without telemetry'})`
);
