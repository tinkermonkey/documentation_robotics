# Graceful Shutdown of the DR Process

## Overview

One DR process per farm serves the viewer, `/mcp` and DrBot for every project and checkout
(issue 1279). `dr serve` runs it, in the background or with `--foreground`; `dr visualize` and
`dr mcp` start it in the background when none runs. The process is `cli/src/serve-entry.ts`,
which runs `runCentralProcess` (`cli/src/server/central-lifetime.ts`) with the central server
(`cli/src/server/central-server.ts`).

`dr visualize` no longer runs a server of its own. It returns once the process is up, so there is
no parent process forwarding signals to a child any more.

## What ends the process

- **SIGINT or SIGTERM.** Ctrl-C in a `dr serve --foreground` terminal, `dr serve --stop`, or
  `dr visualize --stop`. The two stop commands signal only a pid confirmed to be the DR process:
  its own `/health` names it (with the token), or its command line runs `serve-entry`. They wait
  for it to exit and send SIGKILL if it outlasts `DR_VIEWER_STOP_TIMEOUT_MS` (8 s).
- **Idle exit.** After `DR_VIEWER_IDLE_HOURS` (24; `0` means never) with no browser tab, no MCP
  session, no DrBot turn and no request other than `/health`. It checks every
  `DR_VIEWER_LIFETIME_CHECK_MS` (30 s).
- **A fatal error.** An uncaught exception or unhandled rejection stops it with exit code 1.

## What a stop does

`serve-entry.ts` calls `shutdown()` once, whatever ended it:

1. **Stop the server** (`stopCentral` in `server.ts`):
   - stop listening, and close the MCP sessions (their `dr mcp` bridges start or find the next
     process);
   - send SIGTERM to every running DrBot turn, in every checkout;
   - send each websocket subscriber `server.stopping` for its checkout, then close every socket;
   - close every checkout context (staging and annotation stores; file watchers are left to the
     process exit that follows, #1235), then the listener.
2. **Remove the server record** (`servers/<farm-hash>.json` and its token file) in the state
   directory. A process killed outright leaves its record, and the next reader sweeps it once
   the pid is gone.
3. **Flush telemetry**, when the CLI was built with it.
4. **Exit**, with 0 (or 1 after a fatal error).

## Checking it

```bash
dr serve --foreground           # Ctrl-C stops it
dr serve --status               # the running process and its health
dr visualize --list             # the process, plus any per-project viewers older CLIs left
dr visualize --stop             # stops it and waits
```

## Old per-project viewers

CLI 0.7.x and earlier ran one viewer per project (`dr visualize` with a `server-entry.js` child).
The DR process stops the unused ones that `review_open` started when it starts.
`dr visualize --stop --all` stops the rest whose pids are confirmed.
