import { createTempWorkdir, runDr as runDrHelper } from './cli/tests/helpers/cli-runner.js';

let tempDir = await createTempWorkdir();

async function runDr(...args) {
  return runDrHelper(args, { cwd: tempDir.path });
}

// Run the test scenario: no init, model doesn't exist
const result = await runDr('list', 'api');
console.log('Exit code:', result.exitCode);
console.log('Stdout:', result.stdout);
console.log('Stderr:', result.stderr);

await tempDir.cleanup();
