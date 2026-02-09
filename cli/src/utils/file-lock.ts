/**
 * FileLock - Simple file-based locking mechanism for concurrent operations
 *
 * Uses atomic file creation to implement exclusive locks with timeout and retry.
 * Prevents race conditions in read-modify-write operations on changeset files.
 */

import { mkdir, rm, stat } from "fs/promises";
import { existsSync } from "fs";

const DEFAULT_STALE_LOCK_THRESHOLD = 30000; // 30 seconds

export interface LockOptions {
  timeout?: number; // Max time to wait for lock (ms)
  retryInterval?: number; // Time between retry attempts (ms)
  staleLockThreshold?: number; // Threshold in ms for detecting stale locks (default: 30000ms)
  detectStaleLocks?: boolean; // Whether to automatically detect and cleanup stale locks (default: true)
}

/**
 * FileLock provides exclusive access to a resource using lockfiles
 */
export class FileLock {
  private lockPath: string;
  private acquired: boolean = false;

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
        return;
      } catch (error: any) {
        if (error.code === "EEXIST") {
          // Lock is held by another process
          if (Date.now() - startTime >= timeout) {
            throw new Error(
              `Failed to acquire lock on ${this.lockPath} within ${timeout}ms. ` +
                `Resource may be locked by another process or operation.`
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
        console.log(
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
