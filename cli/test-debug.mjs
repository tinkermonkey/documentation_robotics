import { createTempWorkdir, runDr } from './tests/helpers/cli-runner.js';

const tempDir = await createTempWorkdir();

async function runDrHelper(...args) {
  return runDr(args, { cwd: tempDir.path });
}

// Initialize a model for testing
await runDrHelper('init', '--name', 'Test Model');

// Create an element to update
await runDrHelper('add', 'security', 'policy', 'auth-policy', '--name', 'Auth Policy');

// Try to update with source reference
const result = await runDrHelper('update', 'security.policy.auth-policy',
  '--source-file', 'src/auth/policy.ts',
  '--source-provenance', 'extracted'
);

console.log('Exit Code:', result.exitCode);
console.log('Stdout:', result.stdout);
console.log('Stderr:', result.stderr);

await tempDir.cleanup();
