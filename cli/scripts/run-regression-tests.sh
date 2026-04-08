#!/bin/bash
# Regression test suite - excludes low-value tests
# Low-value tests are:
# - Test instrumentation meta-tests (~7 files)
# - Generated code validation tests (~7 files)
# - Fully-mocked external dependency tests (~10 files)

set -e

# Phase 1: Core unit tests (parallel)
bun test --concurrent \
  ./tests/unit/core/ \
  ./tests/unit/validators/ \
  ./tests/unit/telemetry/ \
  ./tests/unit/utils/ \
  ./tests/unit/server/ \
  ./tests/unit/integrations/hash-utils.test.ts \
  ./tests/unit/coding-agents/agent-interface.test.ts \
  ./tests/unit/scan/command.test.ts \
  ./tests/unit/scan/config.test.ts \
  ./tests/unit/scan/is-transport-error.test.ts \
  ./tests/unit/scan/layer-constants.test.ts \
  ./tests/unit/scan/relationship-direction.test.ts \
  ./tests/unit/scan/pattern-loader.test.ts \
  ./tests/unit/analysis/*.test.ts \
  ./tests/unit/reports/*.test.ts \
  ./tests/unit/export/*.test.ts \
  ./tests/unit/migration-registry.test.ts \
  ./tests/unit/archimate-importer.test.ts \
  ./tests/unit/openapi-importer.test.ts \
  ./tests/unit/project-paths.test.ts \
  ./tests/unit/source-reference.test.ts \
  ./tests/unit/validation-formatter.test.ts \
  ./tests/unit/search-source-file.test.ts \
  ./tests/unit/server-chat-streaming.test.ts \
  ./tests/unit/staging-area-cleanup.test.ts \
  ./tests/unit/telemetry.test.ts \
  ./tests/unit/virtual-projection.test.ts \
  ./tests/unit/graph-model.test.ts \
  ./tests/unit/node-types.test.ts \
  ./tests/unit/chat/chat-logger.test.ts \
  ./tests/compatibility/ \
  --test-name-pattern '^(?!BaseIntegrationManager)' && \

# Phase 2: Audit tests excluding AI (parallel)
bun test --concurrent \
  ./tests/unit/audit/*.test.ts \
  ./tests/unit/audit/graph/*.test.ts \
  --test-name-pattern '^(?!BaseIntegrationManager)' && \

# Phase 3: Chat client sessions and integration tests (excluding mocked external dependency tests)
INTEGRATION_TESTS=$(find ./tests/integration -name "*.test.ts" \
  -not -name "claude-code-client-session.test.ts" \
  -not -name "mcp-client-connection.test.ts" \
  -not -path "*/audit/*" \
  -not -path "*/reports/*" | sort)
bun test ./tests/unit/chat.test.ts $INTEGRATION_TESTS tests/unit/integrations/base-manager.test.ts ./tests/integration/audit/*.test.ts ./tests/integration/reports/*.test.ts
