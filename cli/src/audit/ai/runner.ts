import { invokeClaudeStreaming } from "../../utils/claude-stream.js";

/**
 * Thrown by AuditAIRunner when consecutive failure limit is reached.
 * Use `instanceof AIEvaluationAbortError` in catch blocks to distinguish
 * this hard abort from transient per-item failures.
 */
export class AIEvaluationAbortError extends Error {
  constructor(maxFailures: number, cause: unknown) {
    super(
      `AI evaluation aborted after ${maxFailures} consecutive failures. ` +
        `Is Claude CLI installed and authenticated? Run 'claude --version' to verify.`,
      { cause }
    );
    this.name = "AIEvaluationAbortError";
  }
}

/**
 * Shared AI invocation runner for audit evaluators.
 * Wraps invokeClaudeStreaming with rate limiting and fail-fast on consecutive failures.
 */
export class AuditAIRunner {
  private consecutiveFailures = 0;

  constructor(
    private readonly rateLimitMs: number = 1500,
    private readonly maxConsecutiveFailures: number = 3
  ) {}

  /**
   * Invoke Claude with a prompt, streaming output and returning the response text.
   * Adds a rate-limiting delay after each successful invocation.
   * Throws AIEvaluationAbortError after maxConsecutiveFailures consecutive failures.
   */
  async invoke(prompt: string, label: string, timeoutMs?: number): Promise<string> {
    try {
      const result =
        timeoutMs !== undefined
          ? await invokeClaudeStreaming(prompt, label, timeoutMs)
          : await invokeClaudeStreaming(prompt, label);
      this.consecutiveFailures = 0;
      await this.delay(this.rateLimitMs);
      return result;
    } catch (error: unknown) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        throw new AIEvaluationAbortError(this.maxConsecutiveFailures, error);
      }
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
