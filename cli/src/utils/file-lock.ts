/**
 * FileLock - Simple file-based locking mechanism for concurrent operations
 *
 * Uses atomic file creation to implement exclusive locks with timeout and retry.
 * Prevents race conditions in read-modify-write operations on changeset files.
 */

import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';

export interface LockOptions {
  timeout?: number;      // Max time to wait for lock (ms)
  retryInterval?: number; // Time between retry attempts (ms)
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
   */
  async acquire(options: LockOptions = {}): Promise<void> {
    const timeout = options.timeout || 5000;      // 5 second default
    const retryInterval = options.retryInterval || 50; // 50ms default

    const startTime = Date.now();

    while (true) {
      try {
        // Atomic operation: mkdir fails if directory exists
        await mkdir(this.lockPath, { recursive: false });
        this.acquired = true;
        return;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
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
          throw new Error(
            `Failed to acquire lock on ${this.lockPath}: ${error.message}`
          );
        }
      }
    }
  }

  /**
   * Release the lock
   *
   * Removes the lock directory. Should always be called in a finally block.
   */
  async release(): Promise<void> {
    if (!this.acquired) {
      return;
    }

    try {
      await rm(this.lockPath, { recursive: true, force: true });
      this.acquired = false;
    } catch (error: any) {
      // Log but don't throw - best effort cleanup
      console.warn(`Warning: Failed to release lock ${this.lockPath}: ${error.message}`);
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
   */
  async withLock<T>(fn: () => Promise<T>, options?: LockOptions): Promise<T> {
    await this.acquire(options);
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }

  /**
   * Check if a lock file exists (static utility)
   */
  static exists(resourcePath: string): boolean {
    return existsSync(`${resourcePath}.lock`);
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
