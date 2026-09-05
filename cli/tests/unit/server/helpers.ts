/** Minimal stand-in for HonoWSContext that just records what would've been sent. */
export function createFakeWs() {
  const sent: any[] = [];
  return {
    sent,
    send: (data: string) => {
      sent.push(JSON.parse(data));
    },
    close: () => {},
  };
}

/** Poll until `check()` returns a truthy value, or fail after `timeoutMs`. */
export async function waitFor<T>(
  check: () => T | undefined | null | false,
  timeoutMs = 5000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}
