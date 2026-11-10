/**
 * dr visualize's free-port probe. Another viewer listening on every interface (`::` or
 * `0.0.0.0`) holds the port even though, on macOS, a bind on 127.0.0.1 alone would succeed.
 * The probe used to check 127.0.0.1 only, so it called the port free and the server then failed
 * to bind ("Port 8080 is already in use").
 *
 * tests/unit/server runs with --concurrent: each test holds and closes its own servers.
 */

import { describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import { findAvailablePort, isPortFree } from "../../../src/commands/visualize.js";

/** Listens on host (any free port), or null when the host has no such address. */
async function hold(host: string): Promise<{ server: Server; port: number } | null> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
  } catch (error) {
    if (["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
  const address = server.address();
  return { server, port: typeof address === "object" && address ? address.port : 0 };
}

function release(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("findAvailablePort", () => {
  for (const host of ["::", "0.0.0.0", "127.0.0.1", "::1"]) {
    it(`skips a port another server holds on ${host}`, async () => {
      const held = await hold(host);
      if (held === null) return; // No IPv6 on this machine.
      try {
        expect(await isPortFree(held.port)).toBe(false);
        const found = await findAvailablePort(held.port);
        expect(found).toBeGreaterThan(held.port);
      } finally {
        await release(held.server);
      }
    });
  }

  it("calls a port nothing holds free", async () => {
    const held = await hold("127.0.0.1");
    expect(held).not.toBeNull();
    await release(held!.server);

    expect(await isPortFree(held!.port)).toBe(true);
  });
});
