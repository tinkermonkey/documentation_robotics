const { execSync } = require('child_process');

try {
  const output = execSync('node dist/cli.js list motivation', {
    stdio: 'pipe',
    cwd: '/tmp'
  });
  console.log('Success:', output.toString());
} catch (error) {
  console.log('Exit code:', error.status);
  console.log('Stdout:', error.stdout?.toString());
  console.log('Stderr:', error.stderr?.toString());
}
