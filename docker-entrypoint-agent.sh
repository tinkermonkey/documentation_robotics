#!/bin/sh
set -e

PROJECT_DIR="/workspace/documentation_robotics"
CLI_DIR="$PROJECT_DIR/cli"

# ============================================================================
# GitHub CLI authentication (early setup)
# ============================================================================
# Set up gh auth BEFORE any npm/build commands that may need GitHub access.
# The base-image entrypoint also handles this, but we need it earlier because
# npm install/build steps below may require GitHub API access (e.g., for
# private packages, git+https dependencies, or GitHub-hosted registries).
#
# Supports both GITHUB_TOKEN and GH_TOKEN environment variables.
# GITHUB_TOKEN is the standard CI/CD convention; GH_TOKEN is gh CLI's native var.
if [ -n "$GITHUB_TOKEN" ] || [ -n "$GH_TOKEN" ]; then
  AUTH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"
  echo "[agent-entrypoint] Configuring GitHub CLI authentication..."
  echo "$AUTH_TOKEN" | gh auth login --with-token 2>/dev/null || true
fi

# ============================================================================
# Build CLI if dist/cli.js is missing (required for integration tests)
# ============================================================================
# Integration tests depend on the compiled CLI binary at cli/dist/cli.js.
# The test setup (tests/setup.ts) imports from dist/core/golden-copy-cache.js
# and the CLI runner (tests/helpers/cli-runner.ts) spawns node dist/cli.js.
# Since source code is bind-mounted at runtime, the dist/ directory must be
# built after the mount is in place.
if [ -d "$CLI_DIR/src" ] && [ ! -f "$CLI_DIR/dist/cli.js" ]; then
  echo "[agent-entrypoint] CLI dist/cli.js not found — building CLI..."

  # Install root dependencies (needed for build:spec via tsx)
  if [ -f "$PROJECT_DIR/package.json" ] && [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo "[agent-entrypoint] Installing root dependencies..."
    cd "$PROJECT_DIR" && npm install --ignore-scripts 2>&1 | tail -1
  fi

  # Install CLI dependencies
  if [ -f "$CLI_DIR/package.json" ] && [ ! -d "$CLI_DIR/node_modules" ]; then
    echo "[agent-entrypoint] Installing CLI dependencies..."
    cd "$CLI_DIR" && npm install 2>&1 | tail -1
  fi

  # Build the CLI (syncs spec schemas, generates registry, compiles TypeScript, bundles)
  echo "[agent-entrypoint] Running npm run build in cli/..."
  cd "$CLI_DIR" && npm run build 2>&1 | tail -5

  if [ -f "$CLI_DIR/dist/cli.js" ]; then
    echo "[agent-entrypoint] CLI build complete — dist/cli.js is ready"
  else
    echo "[agent-entrypoint] WARNING: CLI build did not produce dist/cli.js"
  fi
fi

# Delegate to the base-image entrypoint (which handles SSH, gh auth, etc.)
exec /usr/local/bin/docker-entrypoint.sh "$@"
