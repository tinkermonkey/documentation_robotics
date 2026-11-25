/**
 * FileLock - Simple file-based locking mechanism for concurrent operations
 *
 * Uses atomic file creation to implement exclusive locks with timeout and retry.
 * Prevents race conditions in read-modify-write operations on changeset files.
 */

import { mkdir, readFile, rm, stat, utimes, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DEFAULT_STALE_LOCK_THRESHOLD = 30000; // 30 seconds

export interface LockOptions {
  timeout?: number; // Max time to wait for lock (ms)
  retryInterval?: number; // Time between retry attempts (ms)
  staleLockThreshold?: number; // Threshold in ms for detecting stale locks (default: 30000ms)
  detectStaleLocks?: boolean; // Whether to automatically detect and cleanup stale locks (default: true)
  /**
   * Who holds the lock and why, written into the lock (owner.json) once it is acquired, so a
   * waiter can say what it waits for (a landing, #1437). Any JSON object; `purpose` names it.
   */
  owner?: LockOwner;
  /**
   * Keep the lock fresh while it is held, touching it every this many ms (default: a third of
   * the stale threshold when set to true). A hold longer than the stale threshold (a large
   * landing) is otherwise taken for a crashed process's lock and removed by the next waiter.
   */
  heartbeat?: boolean | number;
  /**
   * Called when the lock is found held, with its holder's owner (null when it recorded none). An
   * error it returns is thrown at once instead of waiting: a write refuses a changeset that is
   * being landed rather than wait for a landing that will close it to writes.
   */
  refuseWhenHeldBy?: (owner: LockOwner | null) => Error | null | undefined;
}

/** What a lock's holder recorded about itself (LockOptions.owner), with the time it took the lock. */
export interface LockOwner {
  purpose?: string;
  pid?: number;
  since?: string;
  [key: string]: unknown;
}

const OWNER_FILE = "owner.json";

/**
 * FileLock provides exclusive access to a resource using lockfiles
 */
export class FileLock {
  private lockPath: string;
  private acquired: boolean = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(resourcePath: string) {
    // Create lock file path by appending .lock
    this.lockPath = `${resourcePath}.lock`;
  }

  /**
   * Acquire exclusive lock with timeout and retry
   *
   * Uses atomic directory creation (mkdir with recursive: false) to ensure
   * only one process can acquire the lock at a time.
   *
   * Before attempting lock acquisition, automatically checks for stale locks
   * (locks older than the configured threshold) and removes them if detected.
   * This prevents the CLI from becoming unusable after process crashes.
   */
  async acquire(options: LockOptions = {}): Promise<void> {
    const timeout = options.timeout || 5000; // 5 second default
    const retryInterval = options.retryInterval || 50; // 50ms default
    const staleLockThreshold = options.staleLockThreshold || DEFAULT_STALE_LOCK_THRESHOLD;
    const detectStaleLocks = options.detectStaleLocks !== false; // true by default

    // Attempt to clean up stale locks before acquiring
    if (detectStaleLocks) {
      try {
        await FileLock.cleanupStaleLocks(this.lockPath.replace(/\.lock$/, ""), staleLockThreshold);
      } catch {
        // Silently ignore cleanup errors - we'll still attempt to acquire the lock
      }
    }

    const startTime = Date.now();

    while (true) {
      try {
        // Atomic operation: mkdir fails if directory exists
        await mkdir(this.lockPath, { recursive: false });
        this.acquired = true;
        if (options.owner) {
          const owner: LockOwner = { pid: process.pid, since: new Date().toISOString(), ...options.owner };
          await writeFile(path.join(this.lockPath, OWNER_FILE), JSON.stringify(owner), "utf-8").catch(() => undefined);
        }
        this.startHeartbeat(options, staleLockThreshold);
        return;
      } catch (error: any) {
        if (error.code === "EEXIST") {
          // Lock is held by another process
          if (options.refuseWhenHeldBy) {
            const refusal = options.refuseWhenHeldBy(await FileLock.readOwner(this.lockPath.replace(/\.lock$/, "")));
            if (refusal) throw refusal;
          }
          if (Date.now() - startTime >= timeout) {
            const owner = await FileLock.readOwner(this.lockPath.replace(/\.lock$/, ""));
            throw new Error(
              `Failed to acquire lock on ${this.lockPath} within ${timeout}ms. ` +
                (owner?.purpose
                  ? `It is held for ${owner.purpose}${owner.since ? ` since ${owner.since}` : ""}${owner.pid ? ` (process ${owner.pid})` : ""}.`
                  : `Resource may be locked by another process or operation.`)
            );
          }

          // Wait before retrying
          await this.sleep(retryInterval);
        } else {
          // Unexpected error
          throw new Error(`Failed to acquire lock on ${this.lockPath}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Release the lock
   *
   * Removes the lock directory. Should always be called in a finally block.
   * Throws errors on filesystem failures to propagate critical issues.
   *
   * @throws {Error} If lock removal fails (permission denied, disk full, etc)
   */
  async release(): Promise<void> {
    if (!this.acquired) {
      return;
    }
    this.stopHeartbeat();

    try {
      await rm(this.lockPath, { recursive: true, force: true });
      this.acquired = false;
    } catch (error: any) {
      // Construct detailed error message with lock state
      const errorMsg = `Failed to release lock on ${this.lockPath} (acquired: ${this.acquired}): ${error.message}`;

      // Log the error for visibility
      console.error(`ERROR: ${errorMsg}`);

      // Throw to propagate to callers - they may attempt force removal
      throw new Error(errorMsg);
    }
  }

  /**
   * Check if lock is currently held by this instance
   */
  isAcquired(): boolean {
    return this.acquired;
  }

  /**
   * Execute function with lock protection
   *
   * Acquires lock, executes function, and releases lock in finally block.
   * Ensures lock is always released even if function throws.
   *
   * Propagates both function errors and lock release errors to the caller.
   * If the function throws and lock release also fails, the lock release error
   * is thrown (with original error logged).
   *
   * @throws {Error} If function throws or if lock release fails
   */
  async withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T> {
    await this.acquire(options);
    let fnError: unknown;

    try {
      return await fn();
    } catch (error) {
      // Capture function error to re-throw after attempting lock release
      fnError = error;
      throw error;
    } finally {
      try {
        await this.release();
      } catch (releaseError) {
        // If function already threw, log both errors
        // Release error takes precedence since it indicates filesystem corruption
        if (fnError) {
          console.error(
            `Function error suppressed due to lock release failure. ` +
              `Function error: ${fnError instanceof Error ? fnError.message : String(fnError)}`
          );
        }
        throw releaseError;
      }
    }
  }

  /** Touch the lock every interval while it is held, so a long hold is never taken for a stale one. */
  private startHeartbeat(options: LockOptions, staleLockThreshold: number): void {
    if (!options.heartbeat) return;
    const every = typeof options.heartbeat === "number" ? options.heartbeat : Math.max(1000, Math.floor(staleLockThreshold / 3));
    this.heartbeatTimer = setInterval(() => {
      const now = new Date();
      utimes(this.lockPath, now, now).catch(() => undefined);
    }, every);
    // A held lock never keeps the process alive on its own.
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  /**
   * What the holder of a resource's lock recorded about itself (LockOptions.owner), or null when
   * the lock is free or its holder recorded nothing.
   */
  static async readOwner(resourcePath: string): Promise<LockOwner | null> {
    try {
      const parsed = JSON.parse(await readFile(path.join(`${resourcePath}.lock`, OWNER_FILE), "utf-8"));
      return parsed && typeof parsed === "object" ? (parsed as LockOwner) : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if a lock file exists (static utility)
   */
  static exists(resourcePath: string): boolean {
    return existsSync(`${resourcePath}.lock`);
  }

  /**
   * Check if a lock is stale based on age
   *
   * A lock is considered stale if its modification time exceeds the threshold.
   * This helps detect locks from crashed processes.
   *
   * @param resourcePath - Path to the locked resource
   * @param threshold - Max age in ms before lock is considered stale (default: 30s)
   * @returns true if lock exists and is stale, false otherwise
   */
  static async isLockStale(
    resourcePath: string,
    threshold: number = DEFAULT_STALE_LOCK_THRESHOLD
  ): Promise<boolean> {
    const lockPath = `${resourcePath}.lock`;

    try {
      if (!existsSync(lockPath)) {
        return false;
      }

      const stats = await stat(lockPath);
      const lockAge = Date.now() - stats.mtime.getTime();
      return lockAge > threshold;
    } catch {
      // If we can't determine lock age, treat as valid (not stale)
      // This ensures we don't accidentally remove locks we're unsure about
      return false;
    }
  }

  /**
   * Cleanup stale locks automatically
   *
   * Removes lock directories that are older than the specified threshold.
   * Logs the cleanup action for diagnostics. Safe to call repeatedly.
   *
   * @param resourcePath - Path to the locked resource
   * @param threshold - Max age in ms before lock is considered stale (default: 30s)
   */
  static async cleanupStaleLocks(
    resourcePath: string,
    threshold: number = DEFAULT_STALE_LOCK_THRESHOLD
  ): Promise<void> {
    const isStale = await this.isLockStale(resourcePath, threshold);

    if (isStale) {
      const lockPath = `${resourcePath}.lock`;
      try {
        const stats = await stat(lockPath);
        const lockAge = Date.now() - stats.mtime.getTime();
        await rm(lockPath, { recursive: true, force: true });
        // stderr: stdout is the protocol channel when this runs inside the MCP stdio server
        console.error(
          `Cleaned up stale lock at ${lockPath} (age: ${lockAge}ms, threshold: ${threshold}ms)`
        );
      } catch (error) {
        // Silently ignore cleanup errors - lock may have been removed by another process
        // or other temporary filesystem issues
      }
    }
  }

  /**
   * Force remove a stale lock (static utility)
   *
   * Use with caution - only for cleaning up locks from crashed processes.
   */
  static async forceRemove(resourcePath: string): Promise<void> {
    const lockPath = `${resourcePath}.lock`;
    await rm(lockPath, { recursive: true, force: true });
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
