#!/usr/bin/env python3
"""Bundle documentation_robotics_viewer into CLI package."""

import argparse
import shutil
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen

VIEWER_REPO = "tinkermonkey/documentation_robotics_viewer"
DEFAULT_VERSION = "0.1.0"
BUNDLE_DIR = Path(__file__).parent.parent / "cli" / "src" / "documentation_robotics" / "viewer"


def bundle_viewer(version: str = DEFAULT_VERSION, force: bool = False) -> None:
    """Bundle viewer assets into CLI package."""
    dist_dir = BUNDLE_DIR / "dist"

    if dist_dir.exists() and not force:
        print(f"Viewer already bundled at {dist_dir}")
        return

    BUNDLE_DIR.mkdir(parents=True, exist_ok=True)

    # Construct download URL
    artifact_name = f"dr-viewer-bundle-{version}.zip"
    download_url = f"https://github.com/{VIEWER_REPO}/releases/download/v{version}/{artifact_name}"

    # Download and extract
    import tempfile

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        archive_path = temp_path / artifact_name

        print(f"Downloading {download_url}...")
        with urlopen(download_url) as response:
            with open(archive_path, "wb") as f:
                f.write(response.read())

        # Extract
        extract_dir = temp_path / "extracted"
        extract_dir.mkdir()
        with zipfile.ZipFile(archive_path, "r") as zip_ref:
            zip_ref.extractall(extract_dir)

        # Find the viewer bundle directory (dr-viewer-bundle/)
        bundle_candidates = list(extract_dir.glob("dr-viewer-bundle"))
        if not bundle_candidates:
            # Fallback: look for dist/ or build/
            bundle_candidates = list(extract_dir.glob("**/dist"))
            if not bundle_candidates:
                bundle_candidates = list(extract_dir.glob("**/build"))

        if not bundle_candidates:
            print("✗ Could not find viewer bundle directory")
            print("\nExtracted structure:")
            for item in extract_dir.rglob("*"):
                if item.is_file():
                    print(f"  {item.relative_to(extract_dir)}")
            sys.exit(1)

        # Copy to bundle directory
        if dist_dir.exists():
            shutil.rmtree(dist_dir)
        shutil.copytree(bundle_candidates[0], dist_dir)
        print(f"✓ Bundled viewer to {dist_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    bundle_viewer(version=args.version, force=args.force)
