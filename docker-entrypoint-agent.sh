#!/bin/sh
set -e

PROJECT_DIR="/workspace/documentation_robotics"
CLI_DIR="$PROJECT_DIR/cli"

# ============================================================================
# PATH and environment setup
# ============================================================================
# Ensure node, bun, and other tools are in PATH for all spawned child processes.
# Tests use bun's spawnSync to run "node dist/cli.js" — if node isn't in PATH,
# those spawns fail with ENOENT: posix_spawn 'node'.
# Only prepend if not already present (Dockerfile ENV sets these, but
# defend against environments that override PATH at container start).
case ":${PATH}:" in
  *:/usr/local/bin:*) ;;
  *) export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}" ;;
esac

# Ensure /tmp is available and writable for test tmpdir operations.
# Tests create temporary directories under /tmp (golden copy cloning, test
# workdirs). If /tmp doesn't exist or isn't writable, tests fail with
# ENOENT: chdir or file open errors.
if [ ! -d /tmp ] || [ ! -w /tmp ]; then
  echo "[agent-entrypoint] WARNING: /tmp is not writable — test tmpdir operations may fail"
fi

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
# with "multi-account migration" errors. Removing stale config ensures gh
# starts fresh and uses the environment token directly.
GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh}"
if [ -d "$GH_CONFIG_DIR" ]; then
  if [ -f "$GH_CONFIG_DIR/hosts.yml" ]; then
    # Check for corrupted or old-format config that triggers migration errors
    if gh auth status >/dev/null 2>&1; then
      : # Config is valid, leave it alone
    else
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
  # Check for node_modules/.package-lock.json as a staleness indicator —
  # if node_modules/ exists but is empty or incomplete (e.g., stale mount),
  # npm install won't run without this check.
  if [ -f "$PROJECT_DIR/package.json" ]; then
    if [ ! -d "$PROJECT_DIR/node_modules" ] || [ ! -f "$PROJECT_DIR/node_modules/.package-lock.json" ]; then
      echo "[agent-entrypoint] Installing root dependencies..."
      cd "$PROJECT_DIR" && npm install --ignore-scripts 2>&1 | tail -1
    fi
  fi

  # Install CLI dependencies
  # Same staleness check — ensures node_modules is complete, not just present.
  if [ -f "$CLI_DIR/package.json" ]; then
    if [ ! -d "$CLI_DIR/node_modules" ] || [ ! -f "$CLI_DIR/node_modules/.package-lock.json" ]; then
      echo "[agent-entrypoint] Installing CLI dependencies..."
      cd "$CLI_DIR" && npm install 2>&1 | tail -1
    fi
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
