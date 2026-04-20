import { createTempWorkdir, runDr } from "./tests/helpers/cli-runner.js";
import { mkdir } from "fs/promises";
import { join } from "path";

async function main() {
  const tempDir = await createTempWorkdir();
  console.log("Test dir:", tempDir.path);

  // Initialize project
  const init = await runDr(["init", "--name", "Test Project"], { cwd: tempDir.path });
  console.log("Init exit code:", init.exitCode);

  // First discover without --json
  const discover1 = await runDr(["analyzer", "discover"], {
    cwd: tempDir.path,
    env: { CI: "true" }
  });
  console.log("\n=== First discover (no --json) ===");
  console.log("Exit code:", discover1.exitCode);
  console.log("Stdout:", discover1.stdout);
  console.log("Stderr:", discover1.stderr);

  // Second discover with --json
  const discover2 = await runDr(["analyzer", "discover", "--json"], {
    cwd: tempDir.path,
    env: { CI: "true" }
  });
  console.log("\n=== Second discover (--json) ===");
  console.log("Exit code:", discover2.exitCode);
  console.log("Stdout:", discover2.stdout);
  console.log("Stderr:", discover2.stderr);
  
  try {
    const result = JSON.parse(discover2.stdout);
    console.log("\n=== Parsed JSON ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("Has 'selected':", "selected" in result);
  } catch (e) {
    console.log("Failed to parse JSON:", e);
  }

  await tempDir.cleanup();
}

main().catch(console.error);
