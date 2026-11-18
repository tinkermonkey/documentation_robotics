/**
 * Child process fixture for the EPIPE regression test.
 * Installs the ANSI suppressor, then simulates the broken-pipe 'error' event
 * that Node/Bun emit on stdout when a downstream reader (e.g. `| head`) closes.
 */
import { installAnsiSuppressor } from "../../src/utils/ansi-suppressor.ts";

installAnsiSuppressor();

const err: NodeJS.ErrnoException = new Error("write EPIPE");
err.code = "EPIPE";
process.stdout.emit("error", err);

// Reaching here means the error was handled without terminating the process.
process.stderr.write("EPIPE_HANDLED_WITHOUT_EXIT\n");
