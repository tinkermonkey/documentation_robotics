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
# gh CLI automatically uses GITHUB_TOKEN and GH_TOKEN environment variables
# for authentication — no explicit `gh auth login` is needed when these are set.
# GH_TOKEN takes precedence over GITHUB_TOKEN per gh CLI conventions.
#
# We normalize to GH_TOKEN so gh uses a single, predictable source.
if [ -n "$GITHUB_TOKEN" ] && [ -z "$GH_TOKEN" ]; then
  export GH_TOKEN="$GITHUB_TOKEN"
fi

# Clean up stale gh CLI config to prevent multi-account migration errors.
# gh CLI 2.40+ introduced multi-account support with a new config format.
# If a previous run or bind mount left an old-format hosts.yml, gh may fail
# with "multi-account migration" errors. When a token is provided via the
# environment, gh doesn't need file-based config at all — remove any stale
# config unconditionally to avoid the migration prompt (which hangs in
# non-interactive containers). We avoid calling `gh auth status` here
# because that command itself can trigger the migration error.
GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}"
if [ -n "$GH_TOKEN" ] || [ -n "$GITHUB_TOKEN" ]; then
  # Token-based auth: gh reads GH_TOKEN directly, no hosts.yml needed.
  # Remove any file-based config that could trigger migration prompts.
  if [ -f "$GH_CONFIG_DIR/hosts.yml" ]; then
    echo "[agent-entrypoint] Removing hosts.yml — using environment token instead"
    rm -f "$GH_CONFIG_DIR/hosts.yml"
  fi
  mkdir -p "$GH_CONFIG_DIR"
else
  # No token: unconditionally remove stale hosts.yml to avoid migration errors.
  # We previously called `gh auth status` here to check validity, but that
  # command itself can trigger the migration prompt and hang in non-interactive
  # containers. Since there's no token anyway, file-based config is useless.
  if [ -d "$GH_CONFIG_DIR" ] && [ -f "$GH_CONFIG_DIR/hosts.yml" ]; then
    echo "[agent-entrypoint] Cleaning stale gh CLI config to avoid migration errors"
    rm -f "$GH_CONFIG_DIR/hosts.yml"
  fi
  mkdir -p "$GH_CONFIG_DIR"
fi

if [ -n "$GH_TOKEN" ]; then
  echo "[agent-entrypoint] GitHub CLI authentication configured via environment token"
else
  echo "[agent-entrypoint] WARNING: No GITHUB_TOKEN or GH_TOKEN set — gh commands requiring auth will fail"
fi

# ============================================================================
# Force-rebuild CLI (required for integration tests)
# ============================================================================
# Integration tests depend on the compiled CLI binary at cli/dist/cli.js.
# The test setup (tests/setup.ts) imports from dist/core/golden-copy-cache.js
# and the CLI runner (tests/helpers/cli-runner.ts) spawns node dist/cli.js.
# Since source code is bind-mounted at runtime, the dist/ directory must be
# built after the mount is in place.
#
# IMPORTANT: Always force-rebuild — never rely on dist/cli.js existence.
# A stale dist/cli.js from a prior repair cycle will silently pass an
# existence check but test against outdated code, producing false failures
# (e.g., dependency counts of 0, direct/transitive count mismatches).
if [ -d "$CLI_DIR/src" ]; then
  echo "[agent-entrypoint] Force-rebuilding CLI to ensure dist/ matches current source..."

  # Remove stale build artifacts unconditionally.
  rm -rf "$CLI_DIR/dist" "$CLI_DIR/tsconfig.tsbuildinfo"

  # Install root dependencies (needed for build:spec via tsx)
  if [ -f "$PROJECT_DIR/package.json" ]; then
    echo "[agent-entrypoint] Installing root dependencies..."
    cd "$PROJECT_DIR" && npm install --ignore-scripts 2>&1 | tail -1
  fi

  # Install CLI dependencies
  # Always run npm install (not conditional on node_modules existence) because
  # the bind-mounted node_modules may be incomplete — e.g., missing
  # @modelcontextprotocol/sdk which is needed by 27 files in cli/src/mcp/.
  if [ -f "$CLI_DIR/package.json" ]; then
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
