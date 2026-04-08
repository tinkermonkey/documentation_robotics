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
  # No token: best-effort cleanup of corrupted config
  if [ -d "$GH_CONFIG_DIR" ] && [ -f "$GH_CONFIG_DIR/hosts.yml" ]; then
    if ! gh auth status >/dev/null 2>&1; then
      echo "[agent-entrypoint] Cleaning stale gh CLI config to avoid migration errors"
      rm -f "$GH_CONFIG_DIR/hosts.yml"
    fi
  fi
fi

if [ -n "$GH_TOKEN" ]; then
  echo "[agent-entrypoint] GitHub CLI authentication configured via environment token"
else
  echo "[agent-entrypoint] WARNING: No GITHUB_TOKEN or GH_TOKEN set — gh commands requiring auth will fail"
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

  # Clean stale build artifacts to prevent type definition mismatches.
  # Stale .tsbuildinfo or cached .d.ts files in dist/ can cause TypeScript
  # to see outdated function signatures (e.g., isValidLayerName expecting
  # CanonicalLayerName instead of string). Removing dist/ and tsbuildinfo
  # forces a clean compilation from source.
  if [ -d "$CLI_DIR/dist" ]; then
    echo "[agent-entrypoint] Removing stale dist/ to prevent type cache issues..."
    rm -rf "$CLI_DIR/dist"
  fi
  if [ -f "$CLI_DIR/tsconfig.tsbuildinfo" ]; then
    rm -f "$CLI_DIR/tsconfig.tsbuildinfo"
  fi

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
