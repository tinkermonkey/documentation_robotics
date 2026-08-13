import { createTempWorkdir, runDr } from "./tests/helpers/cli-runner.js";

async function test() {
  const tempDir = await createTempWorkdir();
  console.log("Test directory:", tempDir.path);
  
  const initResult = await runDr(
    ["init", "--name", "Test Model"],
    { cwd: tempDir.path }
  );
  console.log("Init result:", initResult);
  
  const addResult = await runDr(
    [
      "add",
      "security",
      "securitypolicy",
      "auth-validate",
      "--name",
      "Auth Validation",
      "--source-file",
      "src/auth/validator.ts",
      "--source-provenance",
      "extracted"
    ],
    { cwd: tempDir.path }
  );
  console.log("Add result:", addResult);
  console.log("Stdout:", addResult.stdout);
  console.log("Stderr:", addResult.stderr);
  
  await tempDir.cleanup();
}

test().catch(console.error);
