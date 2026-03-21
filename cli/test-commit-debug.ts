import { createTestWorkdir } from "./tests/helpers/golden-copy.js";
import { Model } from "./src/core/model.js";
import { StagingAreaManager } from "./src/core/staging-area.js";
import { runDr } from "./tests/helpers/cli-runner.js";

const workdir = await createTestWorkdir();
const TEST_DIR = workdir.path;

const model = await Model.load(TEST_DIR, { lazyLoad: false });
const manager = new StagingAreaManager(TEST_DIR, model);

const changeset = await manager.create("test", "Test");
await manager.setActive(changeset.id!);

await manager.stage(changeset.id!, {
  type: "add",
  elementId: "apm-alert-test",
  layerName: "apm",
  timestamp: new Date().toISOString(),
  after: {
    type: "alert",
    name: "Test Alert",
    description: "Test",
  },
});

const result = await runDr(["changeset", "commit"], { cwd: TEST_DIR });
console.log("Exit code:", result.exitCode);
console.log("stdout:", result.stdout);
console.log("stderr:", result.stderr);

await workdir.cleanup();
