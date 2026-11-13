#!/usr/bin/env bash
# Run a CLI test suite in a Linux container set up like the release workflow's test gate
# (.github/workflows/release.yml, job `test-cli`), so a Linux-only failure shows up before a
# `cli-v*` tag is pushed rather than in the tag's release run.
#
# Usage (from cli/):
#   npm run test:linux                 # npm run test:integration in the container
#   npm run test:linux -- test         # npm test: the release gate's full suite
#   npm run test:linux -- test:smoke   # any other npm script in cli/package.json
#
# What it tests: the committed HEAD, exported with `git archive` and copied into the container.
# Nothing on the host is mounted, so the container never writes to the checkout: the host's
# node_modules (macOS binaries), dist/ and generated files are left alone. Uncommitted changes are
# not part of the run; commit them first.
#
# Environment it mirrors from the release workflow:
#   - Node: the release workflow's `node-version` (read from release.yml), image node:<v>-bookworm
#   - Bun: `latest`, as the workflow's `bun-version`. Pin one with BUN_VERSION=1.3.4.
#   - codebase-memory-mcp: the version the workflow installs (read from release.yml)
#   - npm install, npm run build:ci, then the suite, with CI=true and GITHUB_ACTIONS=true (which
#     turn colour on, as on the runner) and no TTY
#   - a non-root user (the image's `node`), as the runner's `runner` user: as root, tests that
#     expect a permission error would pass here and fail there, or the reverse
#
# The container runs the host's architecture (arm64 on Apple Silicon); the runner is x86_64. Set
# DOCKER_DEFAULT_PLATFORM=linux/amd64 to emulate it (much slower).
#
# Exit codes: the suite's own (0 passed, non-zero failed), or 2 when the run couldn't start
# (no Docker, an unknown script, release.yml unreadable).
set -euo pipefail

SUITE="${1:-test:integration}"
CLI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(git -C "$CLI_DIR" rev-parse --show-toplevel)"
WORKFLOW="$REPO_ROOT/.github/workflows/release.yml"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "test:linux: Docker is not available (no docker CLI, or the daemon isn't running)." >&2
  echo "test:linux: the Linux run was NOT done." >&2
  exit 2
fi

if ! grep -q "\"$SUITE\":" "$CLI_DIR/package.json"; then
  echo "test:linux: cli/package.json has no script named '$SUITE'." >&2
  exit 2
fi

NODE_VERSION="$(grep -m1 'node-version:' "$WORKFLOW" | grep -oE '[0-9]+(\.[0-9]+)*' || true)"
CBM_PACKAGE="$(grep -m1 -oE 'codebase-memory-mcp@[0-9][0-9.]*' "$WORKFLOW" || true)"
if [ -z "$NODE_VERSION" ] || [ -z "$CBM_PACKAGE" ]; then
  echo "test:linux: could not read the Node version or the codebase-memory-mcp version from $WORKFLOW." >&2
  exit 2
fi
BUN_VERSION="${BUN_VERSION:-latest}"
IMAGE="node:${NODE_VERSION}-bookworm"

COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  echo "test:linux: warning: the working tree has uncommitted changes; they are not part of this run." >&2
fi

echo "test:linux: npm run $SUITE at $COMMIT in $IMAGE (bun@$BUN_VERSION, $CBM_PACKAGE)"

# The container script. Single-quoted: it expands inside the container, from the -e variables.
CONTAINER_SCRIPT='
set -eu
W="$HOME/w"
mkdir -p "$W"
tar -xf - -C "$W"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
npm install -g --loglevel=warn "bun@$BUN_VERSION" "$CBM_PACKAGE"
echo "test:linux: node $(node --version), bun $(bun --version), $(uname -sm), user $(id -un)"
cd "$W/cli"
npm install --loglevel=warn
npm run build:ci
npm run "$SUITE"
'

set +e
git -C "$REPO_ROOT" archive --format=tar HEAD |
  docker run --rm -i \
    -e CI=true \
    -e GITHUB_ACTIONS=true \
    -e BUN_VERSION="$BUN_VERSION" \
    -e CBM_PACKAGE="$CBM_PACKAGE" \
    -e SUITE="$SUITE" \
    --user node \
    -e HOME=/home/node \
    "$IMAGE" bash -c "$CONTAINER_SCRIPT"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "test:linux: PASSED (npm run $SUITE at $COMMIT on Linux)"
else
  echo "test:linux: FAILED with exit code $STATUS (npm run $SUITE at $COMMIT on Linux)" >&2
fi
exit "$STATUS"
