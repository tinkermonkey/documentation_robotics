/**
 * What the HTTP adapters share: the injected `fetch` type, `Retry-After` parsing, reading a body
 * under a signal, and a retry wait the caller's signal cuts short. No adapter state lives here.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Milliseconds from a Retry-After header (seconds or an HTTP date), or undefined. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The body as text; rejects if the signal fires while it is read. */
export function readBody(res: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    res.text().then(
      (t) => {
        signal.removeEventListener("abort", onAbort);
        resolve(t);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

/** `sleep(ms)`, rejected with `cancelled()` as soon as `signal` aborts. */
export function abortableWait(sleep: (ms: number) => Promise<void>, ms: number, signal: AbortSignal | undefined, cancelled: () => Error): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    sleep(ms).then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}
