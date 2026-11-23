/**
 * Whether a process a test watches has ended: the product's own liveness check
 * (`src/utils/process-liveness.ts`, issue 1275), under the name the tests have used since the
 * release gate's container left orphaned viewers as unreaped zombies. An exited process counts as
 * gone even while it is a zombie its parent has not reaped.
 */

export { isProcessAlive as isProcessRunning } from "../../src/utils/process-liveness.js";
