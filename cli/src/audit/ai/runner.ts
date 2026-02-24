import { invokeClaudeStreaming } from "../../utils/claude-stream.js";

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
   * Fails fast after maxConsecutiveFailures consecutive failures with a helpful message.
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
        throw new Error(
          `AI evaluation aborted after ${this.maxConsecutiveFailures} consecutive failures. ` +
            `Is Claude CLI installed and authenticated? Run 'claude --version' to verify.`
        );
      }
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
