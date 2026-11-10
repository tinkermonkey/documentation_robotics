/**
 * dr visualize's free-port probe. Another viewer listening on every interface (`::` or
 * `0.0.0.0`) holds the port even though, on macOS, a bind on 127.0.0.1 alone would succeed.
 * The probe used to check 127.0.0.1 only, so it called the port free and the server then failed
 * to bind ("Port 8080 is already in use").
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import { findAvailablePort, isPortFree } from "../../../src/commands/visualize.js";

const held: Server[] = [];

/** Listens on host (any free port) and returns the port, or null when the host has no such address. */
async function hold(host: string): Promise<number | null> {
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
  held.push(server);
  const address = server.address();
  return typeof address === "object" && address ? address.port : null;
}

afterEach(async () => {
  await Promise.all(held.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("findAvailablePort", () => {
  for (const host of ["::", "0.0.0.0", "127.0.0.1", "::1"]) {
    it(`skips a port another server holds on ${host}`, async () => {
      const port = await hold(host);
      if (port === null) return; // No IPv6 on this machine.

      expect(await isPortFree(port)).toBe(false);
      const found = await findAvailablePort(port);
      expect(found).toBeGreaterThan(port);
      expect(await isPortFree(found)).toBe(true);
    });
  }

  it("returns the start port when nothing holds it", async () => {
    const port = await hold("127.0.0.1");
    expect(port).not.toBeNull();
    await new Promise((resolve) => held.pop()!.close(resolve));

    expect(await findAvailablePort(port!)).toBe(port!);
  });
});
