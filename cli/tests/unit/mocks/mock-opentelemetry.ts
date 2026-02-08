/**
 * Mock OpenTelemetry implementations for testing.
 *
 * Provides lightweight mock implementations of Span and SpanProcessor
 * for testing span behavior without requiring actual telemetry initialization.
 */

/**
 * Mock Span for testing span attribute setting and lifecycle.
 */
export class MockSpan {
  private attributes: Record<string, string | number | boolean> = {};
  private recordedException: Error | null = null;
  private traceId: string;
  private spanName: string;

  constructor(spanName: string = "test.span", traceId?: string) {
    this.spanName = spanName;
    this.traceId = traceId || this.generateTraceId();
  }

  /**
   * Set an attribute on the span.
   */
  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  /**
   * Get all attributes set on this span.
   */
  getAttributes(): Record<string, string | number | boolean> {
    return { ...this.attributes };
  }

  /**
   * Record an exception on the span.
   */
  recordException(error: Error): void {
    this.recordedException = error;
  }

  /**
   * Get the recorded exception, if any.
   */
  getRecordedException(): Error | null {
    return this.recordedException;
  }

  /**
   * Get the trace ID for this span.
   */
  getTraceId(): string {
    return this.traceId;
  }

  /**
   * Get the span name.
   */
  getSpanName(): string {
    return this.spanName;
  }

  /**
   * Generate a random trace ID for testing.
   */
  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

/**
 * Mock SpanProcessor for testing span processing.
 */
export class MockSpanProcessor {
  private processedSpans: MockSpan[] = [];
  private startedSpans: MockSpan[] = [];
  private endedSpans: MockSpan[] = [];

  /**
   * Called when a span is started.
   */
  onStart(span: MockSpan): void {
    this.startedSpans.push(span);
  }

  /**
   * Called when a span is ended.
   */
  onEnd(span: MockSpan): void {
    this.endedSpans.push(span);
    this.processedSpans.push(span);
  }

  /**
   * Get all spans that have been processed (started and ended).
   */
  getProcessedSpans(): MockSpan[] {
    return [...this.processedSpans];
  }

  /**
   * Get all spans that have been started.
   */
  getStartedSpans(): MockSpan[] {
    return [...this.startedSpans];
  }

  /**
   * Get all spans that have been ended.
   */
  getEndedSpans(): MockSpan[] {
    return [...this.endedSpans];
  }

  /**
   * Clear all recorded spans.
   */
  clear(): void {
    this.processedSpans = [];
    this.startedSpans = [];
    this.endedSpans = [];
  }
}

/**
 * Mock Tracer for testing tracer behavior.
 */
export class MockTracer {
  private spans: MockSpan[] = [];
  private activeSpan: MockSpan | null = null;

  /**
   * Start a new span.
   */
  startSpan(name: string, options?: { traceId?: string }): MockSpan {
    const traceId = options?.traceId || this.activeSpan?.getTraceId();
    const span = new MockSpan(name, traceId);
    this.spans.push(span);
    return span;
  }

  /**
   * Get the active span context.
   */
  getActiveSpan(): MockSpan | null {
    return this.activeSpan;
  }

  /**
   * Set the active span.
   */
  setActiveSpan(span: MockSpan | null): void {
    this.activeSpan = span;
  }

  /**
   * Get all spans created by this tracer.
   */
  getSpans(): MockSpan[] {
    return [...this.spans];
  }

  /**
   * Clear all recorded spans.
   */
  clear(): void {
    this.spans = [];
    this.activeSpan = null;
  }
}
