# Periodic Telemetry Flushing for Long-Running Sessions

## Problem

Long-running interactive sessions (like `dr chat`) create many spans over time. If the session crashes or is interrupted before normal shutdown, unflushed spans may be lost.

## Solution: Safe Periodic Flushing

We flush telemetry spans periodically **during idle time** to prevent data loss without destabilizing the chat experience.

### Design Principles

1. **Never block the critical path** - Flush only during user input (idle time)
2. **Fail silently** - Telemetry failures must never break the app
3. **Non-blocking** - Use `void promise.catch()` to fire-and-forget
4. **Minimize overhead** - Only flush at message boundaries (natural checkpoints)

### Implementation

#### New Function: `flushTelemetry()`

```typescript
export async function flushTelemetry(): Promise<void> {
  if (isTelemetryEnabled && spanProcessor) {
    try {
      await spanProcessor.forceFlush();
    } catch (error) {
      // Silently ignore - telemetry should never break the app
    }
  }
}
```

**Safety features:**

- Only active when telemetry enabled
- Catches all errors
- No-op if span processor not initialized
- Returns immediately if telemetry disabled

#### Chat Loop Integration

```typescript
while (true) {
  // Flush at start of loop (before user input prompt)
  if (isTelemetryEnabled && messageCount > 0) {
    const { flushTelemetry } = await import("../telemetry/index.js");
    void flushTelemetry().catch(() => {
      /* ignore */
    });
  }

  // Get user input (this is idle time - user is typing)
  userInput = await text({ message: "You:" });

  // Process message...
}
```

**Why this is safe:**

1. **Timing:** Flush happens BEFORE prompting user for input
   - User hasn't started typing yet
   - No risk of blocking streaming responses
   - Network latency hidden during user thinking/typing time

2. **Error handling:** Double-wrapped for safety
   - Inner `try/catch` in `flushTelemetry()`
   - Outer `.catch(() => {})` in case of unexpected errors
   - `void` keyword explicitly marks as fire-and-forget

3. **Frequency:** Only after first message (`messageCount > 0`)
   - Skips first iteration (no spans to flush yet)
   - Flushes once per message (not too frequent)
   - Natural checkpoint that doesn't add overhead

4. **Non-blocking:** Promise not awaited
   - Flush happens in background
   - User can start typing immediately
   - Won't delay prompt appearance

### Benefits

✅ **Data preservation** - Spans exported every message, not just at end
✅ **Crash resilience** - Only lose current message's span, not entire session
✅ **Zero risk** - Happens during idle time, fails silently
✅ **No performance impact** - Hidden during user input time
✅ **Simple** - Single flush call at natural checkpoint

### Trade-offs Considered

#### ❌ Background timers (setInterval)

```typescript
// DON'T DO THIS
setInterval(() => flushTelemetry(), 5000);
```

**Problems:**

- Runs during message streaming (could block)
- Interferes with Node.js event loop
- Timer overhead even when idle
- Harder to clean up on exit

#### ❌ Flush after every message

```typescript
// DON'T DO THIS
await sendMessage(input);
await flushTelemetry(); // Blocks before next prompt
```

**Problems:**

- Blocks between message and next prompt
- User perceives delay
- Network latency becomes visible

#### ❌ BatchSpanProcessor

```typescript
// DON'T DO THIS
new BatchSpanProcessor(exporter, {
  scheduledDelayMillis: 5000,
});
```

**Problems:**

- More complex than SimpleSpanProcessor
- Background scheduling overhead
- Delays span exports (defeats immediate export benefit)
- Still need forceFlush at shutdown anyway

#### ✅ Current approach (flush at message start)

```typescript
// DO THIS
if (messageCount > 0) {
  void flushTelemetry().catch(() => {});
}
userInput = await prompt();
```

**Advantages:**

- Runs during guaranteed idle time
- No blocking, no timers, no complexity
- Natural checkpoint (message boundary)
- Fail-safe error handling

### Performance Characteristics

**Network characteristics:**

- forceFlush() waits for pending HTTP requests
- Typical OTLP export: 10-50ms locally, 100-200ms remote
- Hidden during user input time (seconds to minutes)

**CPU/Memory:**

- Negligible - just HTTP client overhead
- No additional span creation
- No data copying (spans already in memory)

**Frequency:**

- Once per message in chat session
- Typical chat: 5-20 messages = 5-20 flushes
- Low frequency compared to span creation rate

### Testing

Test that flush doesn't interfere with chat:

```bash
# Start long chat session with telemetry
DR_TELEMETRY_DEBUG=1 dr chat

# Send multiple messages
> Tell me about the architecture
> What are the layers?
> How do they interact?
> exit

# Verify: All spans exported (check OTLP collector)
# Verify: No delays between messages
# Verify: No error messages about flush failures
```

Test crash resilience:

```bash
# Start chat with telemetry
DR_TELEMETRY_DEBUG=1 dr chat

# Send a message
> Test message

# Kill process: Ctrl+C (interrupt)
# Check OTLP collector: First message's span should be exported
```

### When to Use This Pattern

**Good use cases:**

- ✅ Long-running interactive sessions (chat, REPL)
- ✅ Commands with natural idle points (waiting for user input)
- ✅ Batch operations with loop iterations

**Bad use cases:**

- ❌ Short-lived commands (already flush at exit)
- ❌ Streaming operations with no idle time
- ❌ High-frequency loops (adds overhead)

### Future Enhancements

Possible improvements (not implemented):

1. **Adaptive flushing** - Flush less frequently if session is inactive
2. **Metrics** - Track flush timing and success rate
3. **Batch hints** - Pass flush frequency hint to span processor
4. **Smart scheduling** - Only flush if pending spans exist

These are not needed now but could be added if telemetry volume becomes an issue.

## Summary

**Core idea:** Flush spans during user input time (idle periods) in long-running interactive sessions.

**Safety guarantees:**

- Never blocks the critical path
- Fails silently if errors occur
- Zero risk to chat experience
- No performance impact

**Implementation:** Single `void flushTelemetry().catch()` call at message loop start.

**Result:** Spans exported every message instead of only at session end, with zero risk of destabilization.
