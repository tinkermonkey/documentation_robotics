#!/bin/bash
# Extended test suite - runs low-value tests excluded from default regression
# These tests have limited regression value but should still be maintained:
# - Test instrumentation meta-tests (~7 files)
# - Generated code validation tests (~7 files)
# - Fully-mocked external dependency tests (~10 files)

set -e

# Test instrumentation meta-tests
bun test --concurrent \
  ./tests/unit/cli-execute-instrumentation.test.ts \
  ./tests/unit/console-interceptor.test.ts \
  ./tests/unit/file-lock.test.ts \
  ./tests/unit/golden-copy-cache.test.ts \
  ./tests/unit/test-instrumentation-integration.test.ts \
  ./tests/unit/test-instrumentation.example.test.ts \
  ./tests/unit/test-instrumentation.test.ts && \

# Generated code validation tests
bun test --concurrent \
  ./tests/unit/generators/generate-registry.test.ts \
  ./tests/unit/generators/generate-validators.test.ts \
  ./tests/unit/generation/extract-layers.test.ts \
  ./tests/unit/generation/extract-predicates.test.ts \
  ./tests/unit/generation/extract-nodes.test.ts \
  ./tests/unit/scripts/generate-openapi.test.ts \
  ./tests/unit/scripts/generate-validators.test.ts && \

# Fully-mocked external dependency tests (unit)
bun test --concurrent \
  ./tests/unit/audit/ai/claude-invoker.test.ts \
  ./tests/unit/audit/ai/response-parser.test.ts \
  ./tests/unit/audit/ai/prompt-templates.test.ts \
  ./tests/unit/chat/copilot-parser.test.ts \
  ./tests/unit/chat/copilot-client.test.ts \
  ./tests/unit/chat/base-chat-client.test.ts \
  ./tests/unit/chat/claude-code-client.test.ts \
  ./tests/unit/chat/client-communication.test.ts \
  ./tests/unit/coding-agents/claude-code-agent.test.ts \
  ./tests/unit/scan/mcp-client.test.ts && \

# Fully-mocked external dependency tests (integration)
bun test \
  ./tests/integration/claude-code-client-session.test.ts \
  ./tests/integration/mcp-client-connection.test.ts
