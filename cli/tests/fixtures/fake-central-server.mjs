/**
 * A fake `startCentralServer` for `serve-entry` (DR_SERVE_TEST_STARTER): listens on the port it is
 * given, answers /health as `CentralHealth` (pid and serverId only with the token) and reports no
 * activity, so the process's record, its /health and its idle exit can be tested without the real
 * server.
 */

import { createServer } from "node:http";

export async function startCentralServer(options) {
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  const server = createServer((req, res) => {
    if (req.url !== "/health") lastActivityAt = Date.now();
    if (req.url === "/health") {
      const authorized = req.headers.authorization === `Bearer ${options.token}`;
      const body = authorized
        ? {
            status: "ok",
            cliVersion: "fake",
            serverId: options.serverId,
            pid: process.pid,
            launcherPid: options.launcherPid,
            farmRoot: options.farm.root,
            clients: 0,
            loadedCheckouts: 0,
          }
        : { status: "ok", cliVersion: "fake" };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", resolve);
  });
  return {
    port: options.port,
    activity: () => ({ clients: 0, mcpSessions: 0, drBotTurns: 0, lastActivityAt }),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
