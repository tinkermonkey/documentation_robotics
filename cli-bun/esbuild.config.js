import * as esbuild from 'esbuild';
import { globSync } from 'glob';
import { renameSync, rmSync } from 'fs';

const isDebug = process.env.DR_TELEMETRY === 'true';

// Find all compiled JS files to process with esbuild
// This processes all dist/**/*.js files but keeps module structure
const entryPoints = globSync('dist/**/*.js');

// Clean up previous temp directory if it exists
try {
  rmSync('dist.tmp', { recursive: true, force: true });
} catch {}

await esbuild.build({
  entryPoints,
  outdir: 'dist.tmp',
  bundle: false, // Don't bundle - keep module structure
  platform: 'node',
  target: 'node18',
  format: 'esm',
  define: {
    'TELEMETRY_ENABLED': isDebug ? 'true' : 'false',
  },
  minifySyntax: true, // Enables dead branch elimination for if(TELEMETRY_ENABLED)
  sourcemap: true,
});

// Replace dist with processed version
rmSync('dist', { recursive: true, force: true });
renameSync('dist.tmp', 'dist');

console.log(
  `✓ Build complete (${isDebug ? 'debug with telemetry' : 'production without telemetry'})`
);
