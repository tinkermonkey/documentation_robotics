#!/usr/bin/env bash
# Downloads and extracts the dr-viewer bundle for the CLI build.
# Skips the download if the correct version is already present.
set -euo pipefail

VIEWER_VERSION="0.3.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VIEWER_DIR="$SCRIPT_DIR/../src/viewer"
VERSION_FILE="$VIEWER_DIR/version.json"
DOWNLOAD_URL="https://github.com/tinkermonkey/documentation_robotics_viewer/releases/download/v${VIEWER_VERSION}/dr-viewer-bundle-${VIEWER_VERSION}.zip"
TMP_ZIP="/tmp/dr-viewer-bundle-${VIEWER_VERSION}.zip"
TMP_EXTRACT="/tmp/dr-viewer-extract-${VIEWER_VERSION}"

# Check if correct version already downloaded
if [ -f "$VERSION_FILE" ]; then
  installed=$(python3 -c "import json; print(json.load(open('$VERSION_FILE')).get('version',''))" 2>/dev/null || echo "")
  if [ "$installed" = "$VIEWER_VERSION" ]; then
    echo "  Viewer bundle v${VIEWER_VERSION} already present, skipping download"
    exit 0
  fi
fi

echo "  Downloading dr-viewer-bundle v${VIEWER_VERSION}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_ZIP"

echo "  Extracting..."
rm -rf "$TMP_EXTRACT"
mkdir -p "$TMP_EXTRACT"
unzip -q "$TMP_ZIP" -d "$TMP_EXTRACT"
rm -f "$TMP_ZIP"

# The zip contains a top-level dr-viewer-bundle/ directory — flatten it
rm -rf "$VIEWER_DIR"
mv "$TMP_EXTRACT/dr-viewer-bundle" "$VIEWER_DIR"
rmdir "$TMP_EXTRACT"

# Write version marker
echo "{\"version\":\"${VIEWER_VERSION}\"}" > "$VERSION_FILE"
echo "  Viewer bundle v${VIEWER_VERSION} ready"
