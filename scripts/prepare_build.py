#!/usr/bin/env python3
"""
Prepare build by fetching integration files and schemas from GitHub releases.

This script should be run before building the CLI package to ensure
integration files and schemas are up to date.

IMPORTANT: Bundled schemas should NEVER be manually edited. See RELEASING.md
for the correct release workflow.

Usage:
    # Default: fetch schemas from GitHub release
    python scripts/prepare_build.py

    # Use local schemas (fallback or development)
    python scripts/prepare_build.py --local

    # Specify a different spec version
    python scripts/prepare_build.py --spec-version 0.5.0

    # Dry run (show what would be done)
    python scripts/prepare_build.py --dry-run

    # Verbose output
    python scripts/prepare_build.py --verbose

    # Verify integrity of existing bundled schemas (detect manual edits)
    python scripts/prepare_build.py --verify

Environment Variables:
    GITHUB_TOKEN: Optional GitHub token for higher rate limits

Exit Codes:
    0: Success
    1: GitHub fetch failed (with --local fallback if available)
    2: Both GitHub fetch and local fallback failed
    3: Configuration error
    4: Integrity verification failed (bundled schemas were manually modified)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import Optional

# Add cli/src to path for importing spec_version
SCRIPT_DIR = Path(__file__).parent
ROOT_DIR = SCRIPT_DIR.parent
CLI_SRC = ROOT_DIR / "cli" / "src"
sys.path.insert(0, str(CLI_SRC))


class BuildError(Exception):
    """Base exception for build errors."""

    pass


class GitHubFetchError(BuildError):
    """Error fetching from GitHub."""

    pass


class ConfigurationError(BuildError):
    """Configuration error."""

    pass


class IntegrityError(BuildError):
    """Bundled schema integrity error - files may have been manually modified."""

    pass


class SchemaBundler:
    """Handles fetching and bundling schemas for CLI package."""

    # Schema files to bundle (all layer schemas)
    SCHEMA_PATTERNS = [
        "*-layer.schema.json",
    ]

    # Additional files to copy
    ADDITIONAL_FILES = [
        "link-registry.json",
    ]

    def __init__(
        self,
        root_dir: Optional[Path] = None,
        verbose: bool = False,
        dry_run: bool = False,
    ):
        """Initialize the bundler.

        Args:
            root_dir: Root directory of the project (auto-detected if None)
            verbose: Enable verbose output
            dry_run: Show what would be done without making changes
        """
        self.root_dir = root_dir or ROOT_DIR
        self.verbose = verbose
        self.dry_run = dry_run

        # Directory paths
        self.cli_root = self.root_dir / "cli"
        self.src_root = self.cli_root / "src" / "documentation_robotics"
        self.integrations_root = self.root_dir / "integrations"
        self.spec_root = self.root_dir / "spec"
        self.local_schemas_dir = self.spec_root / "schemas"
        self.bundled_schemas_dir = self.src_root / "schemas" / "bundled"

        # Load configuration from spec_version.py
        self._load_config()

    def _load_config(self):
        """Load configuration from versions module (via spec_version for compatibility)."""
        try:
            from documentation_robotics.spec_version import GITHUB_CONFIG, SPEC_VERSION

            self.spec_version = SPEC_VERSION
            self.github_owner = GITHUB_CONFIG["owner"]
            self.github_repo = GITHUB_CONFIG["repo"]
            self.release_tag_prefix = GITHUB_CONFIG["release_tag_prefix"]
        except ImportError as e:
            raise ConfigurationError(
                f"Failed to import version configuration: {e}\n"
                "Make sure cli/src/documentation_robotics/versions.py exists."
            )

    def _log(self, message: str, level: str = "info"):
        """Log a message.

        Args:
            message: Message to log
            level: Log level (info, warning, error, verbose)
        """
        if level == "verbose" and not self.verbose:
            return

        prefix = {
            "info": "",
            "warning": "WARNING: ",
            "error": "ERROR: ",
            "verbose": "  ",
            "success": "",
        }.get(level, "")

        print(f"{prefix}{message}")

    def _get_github_release_url(self, version: str) -> str:
        """Get the GitHub release download URL for schemas.

        Args:
            version: Spec version (e.g., "0.5.0")

        Returns:
            URL to the schemas tarball
        """
        tag = f"{self.release_tag_prefix}{version}"
        return (
            f"https://github.com/{self.github_owner}/{self.github_repo}/"
            f"releases/download/{tag}/schemas-{version}.tar.gz"
        )

    def _get_github_release_page_url(self, version: str) -> str:
        """Get the GitHub release page URL.

        Args:
            version: Spec version

        Returns:
            URL to the release page
        """
        tag = f"{self.release_tag_prefix}{version}"
        return f"https://github.com/{self.github_owner}/{self.github_repo}/releases/tag/{tag}"

    def _fetch_from_github(self, version: str, target_dir: Path) -> bool:
        """Fetch schemas from GitHub release.

        Args:
            version: Spec version to fetch
            target_dir: Directory to extract schemas to

        Returns:
            True if successful, False otherwise

        Raises:
            GitHubFetchError: If fetch fails
        """
        url = self._get_github_release_url(version)
        release_page = self._get_github_release_page_url(version)

        self._log("Fetching schemas from GitHub release...")
        self._log(f"Release: {release_page}", "verbose")
        self._log(f"URL: {url}", "verbose")

        # Create request with optional auth header
        request = urllib.request.Request(url)
        request.add_header("User-Agent", "documentation-robotics-build")

        github_token = os.environ.get("GITHUB_TOKEN")
        if github_token:
            request.add_header("Authorization", f"token {github_token}")
            self._log("Using GITHUB_TOKEN for authentication", "verbose")

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                tmpdir_path = Path(tmpdir)
                tarball_path = tmpdir_path / f"schemas-{version}.tar.gz"

                # Download the tarball
                self._log(f"Downloading schemas-{version}.tar.gz...", "verbose")
                with urllib.request.urlopen(request, timeout=30) as response:
                    with open(tarball_path, "wb") as f:
                        shutil.copyfileobj(response, f)

                # Verify download
                file_size = tarball_path.stat().st_size
                self._log(f"Downloaded {file_size:,} bytes", "verbose")

                if file_size < 1000:  # Sanity check
                    raise GitHubFetchError(
                        f"Downloaded file too small ({file_size} bytes), "
                        "possibly an error response"
                    )

                # Extract tarball
                self._log("Extracting schemas...", "verbose")
                with tarfile.open(tarball_path, "r:gz") as tar:
                    # Security: validate paths before extraction
                    for member in tar.getmembers():
                        if member.name.startswith("/") or ".." in member.name:
                            raise GitHubFetchError(
                                f"Unsafe path in tarball: {member.name}"
                            )
                    tar.extractall(tmpdir_path)

                # Find the schemas directory in extracted content
                schemas_dir = tmpdir_path / "schemas"
                if not schemas_dir.exists():
                    # Try alternative structure
                    for item in tmpdir_path.iterdir():
                        if item.is_dir() and (item / "link-registry.json").exists():
                            schemas_dir = item
                            break

                if not schemas_dir.exists():
                    raise GitHubFetchError(
                        "Could not find schemas directory in extracted content"
                    )

                # Copy schema files to target
                schema_count = 0
                for pattern in self.SCHEMA_PATTERNS:
                    for schema_file in schemas_dir.glob(pattern):
                        target_file = target_dir / schema_file.name
                        if not self.dry_run:
                            shutil.copy2(schema_file, target_file)
                        self._log(f"  Copied {schema_file.name}", "verbose")
                        schema_count += 1

                # Copy additional files
                for filename in self.ADDITIONAL_FILES:
                    source_file = schemas_dir / filename
                    if source_file.exists():
                        target_file = self.src_root / "schemas" / filename
                        if not self.dry_run:
                            shutil.copy2(source_file, target_file)
                        self._log(f"  Copied {filename}", "verbose")

                self._log(f"Fetched {schema_count} schemas from GitHub release v{version}")
                return True

        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise GitHubFetchError(
                    f"Release not found: {release_page}\n"
                    f"Make sure spec-v{version} release exists and has schemas-{version}.tar.gz asset."
                )
            elif e.code == 403:
                raise GitHubFetchError(
                    "GitHub API rate limit exceeded. "
                    "Set GITHUB_TOKEN environment variable for higher limits."
                )
            else:
                raise GitHubFetchError(f"HTTP error {e.code}: {e.reason}")

        except urllib.error.URLError as e:
            raise GitHubFetchError(f"Network error: {e.reason}")

        except tarfile.TarError as e:
            raise GitHubFetchError(f"Error extracting tarball: {e}")

        except Exception as e:
            raise GitHubFetchError(f"Unexpected error: {e}")

    def _copy_local_schemas(self, target_dir: Path) -> bool:
        """Copy schemas from local spec directory.

        Args:
            target_dir: Directory to copy schemas to

        Returns:
            True if successful, False otherwise
        """
        if not self.local_schemas_dir.exists():
            self._log(f"Local schemas directory not found: {self.local_schemas_dir}", "warning")
            return False

        self._log("Copying schemas from local spec directory...")
        self._log(f"Source: {self.local_schemas_dir}", "verbose")

        schema_count = 0
        for pattern in self.SCHEMA_PATTERNS:
            for schema_file in sorted(self.local_schemas_dir.glob(pattern)):
                target_file = target_dir / schema_file.name
                if not self.dry_run:
                    shutil.copy2(schema_file, target_file)
                self._log(f"  Copied {schema_file.name}", "verbose")
                schema_count += 1

        # Copy additional files
        for filename in self.ADDITIONAL_FILES:
            source_file = self.local_schemas_dir / filename
            if source_file.exists():
                target_file = self.src_root / "schemas" / filename
                if not self.dry_run:
                    shutil.copy2(source_file, target_file)
                self._log(f"  Copied {filename}", "verbose")

        if schema_count == 0:
            self._log("No schema files found in local directory", "warning")
            return False

        self._log(f"Copied {schema_count} schemas from local spec directory")
        return True

    def _verify_local_spec_version(self) -> bool:
        """Verify local spec VERSION matches expected version.

        Returns:
            True if versions match, False otherwise
        """
        version_file = self.spec_root / "VERSION"
        if not version_file.exists():
            self._log("spec/VERSION file not found", "warning")
            return False

        local_version = version_file.read_text().strip()
        if local_version != self.spec_version:
            self._log(
                f"Local spec version mismatch: expected {self.spec_version}, "
                f"found {local_version}",
                "warning",
            )
            return False

        self._log(f"Local spec version verified: {local_version}", "verbose")
        return True

    def _compute_file_hash(self, file_path: Path) -> str:
        """Compute SHA256 hash of a file.

        Args:
            file_path: Path to file

        Returns:
            Hex digest of SHA256 hash
        """
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()

    def _create_manifest(self, version: str, source: str) -> dict:
        """Create a manifest of bundled schemas with checksums.

        Args:
            version: Spec version
            source: Source of schemas ("github" or "local")

        Returns:
            Manifest dictionary
        """
        manifest = {
            "spec_version": version,
            "source": source,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": "prepare_build.py",
            "warning": "DO NOT EDIT - These files are generated from spec releases",
            "files": {},
        }

        for schema_file in sorted(self.bundled_schemas_dir.glob("*.json")):
            manifest["files"][schema_file.name] = {
                "sha256": self._compute_file_hash(schema_file),
                "size": schema_file.stat().st_size,
            }

        return manifest

    def _write_manifest(self, version: str, source: str) -> None:
        """Write manifest file after bundling schemas.

        Args:
            version: Spec version
            source: Source of schemas ("github" or "local")
        """
        if self.dry_run:
            return

        manifest = self._create_manifest(version, source)
        manifest_path = self.bundled_schemas_dir / ".manifest.json"
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        self._log(f"Created manifest with {len(manifest['files'])} files", "verbose")

    def verify_integrity(self) -> tuple[bool, list[str]]:
        """Verify integrity of bundled schemas against manifest.

        Returns:
            Tuple of (is_valid, list of issues)
        """
        issues = []
        manifest_path = self.bundled_schemas_dir / ".manifest.json"

        if not manifest_path.exists():
            issues.append("No manifest found - bundled schemas may not have been created by prepare_build.py")
            return False, issues

        try:
            with open(manifest_path) as f:
                manifest = json.load(f)
        except json.JSONDecodeError as e:
            issues.append(f"Manifest is corrupted: {e}")
            return False, issues

        # Check each file in manifest
        for filename, expected in manifest.get("files", {}).items():
            file_path = self.bundled_schemas_dir / filename
            if not file_path.exists():
                issues.append(f"Missing file: {filename}")
                continue

            actual_hash = self._compute_file_hash(file_path)
            if actual_hash != expected["sha256"]:
                issues.append(
                    f"MODIFIED: {filename} - hash mismatch "
                    f"(expected {expected['sha256'][:12]}..., "
                    f"got {actual_hash[:12]}...)"
                )

            actual_size = file_path.stat().st_size
            if actual_size != expected["size"]:
                issues.append(
                    f"MODIFIED: {filename} - size mismatch "
                    f"(expected {expected['size']}, got {actual_size})"
                )

        # Check for unexpected files
        expected_files = set(manifest.get("files", {}).keys())
        expected_files.add(".manifest.json")
        for file_path in self.bundled_schemas_dir.glob("*"):
            if file_path.name not in expected_files:
                issues.append(f"Unexpected file: {file_path.name}")

        return len(issues) == 0, issues

    def _copy_integrations(self):
        """Copy integration files to package source."""
        mappings = [
            {
                "source": self.integrations_root / "claude_code",
                "target": self.src_root / "claude_integration",
                "name": "Claude Integration",
            },
            {
                "source": self.integrations_root / "github_copilot",
                "target": self.src_root / "copilot_integration",
                "name": "GitHub Copilot Integration",
            },
        ]

        for mapping in mappings:
            source = mapping["source"]
            target = mapping["target"]
            name = mapping["name"]

            self._log(f"Processing {name}...")

            if not source.exists():
                self._log(f"Source not found: {source}", "warning")
                continue

            if self.dry_run:
                self._log(f"  Would copy {source} to {target}", "verbose")
                continue

            if target.exists():
                self._log(f"  Removing existing {target.name}...", "verbose")
                shutil.rmtree(target)

            self._log(f"  Copying {source.name}...", "verbose")
            shutil.copytree(source, target)
            self._log("  Done.")

    def prepare_build(
        self,
        use_local: bool = False,
        spec_version: Optional[str] = None,
    ) -> int:
        """Prepare the build by fetching/copying all required files.

        Args:
            use_local: If True, use local schemas instead of fetching from GitHub
            spec_version: Override spec version (default: from spec_version.py)

        Returns:
            Exit code (0 for success, non-zero for failure)
        """
        version = spec_version or self.spec_version

        self._log("Build Preparation")
        self._log("=" * 50)
        self._log(f"Spec Version: {version}")
        self._log(f"Project Root: {self.root_dir}")
        self._log(f"CLI Source: {self.src_root}")
        if self.dry_run:
            self._log("DRY RUN MODE - no files will be modified")
        self._log("")

        # Ensure bundled schemas directory exists
        if not self.dry_run:
            self.bundled_schemas_dir.mkdir(parents=True, exist_ok=True)

        # Step 1: Fetch or copy schemas
        self._log("Step 1: Bundling Schemas")
        self._log("-" * 30)

        schemas_success = False

        if use_local:
            # Use local schemas directly
            self._log("Using local schemas (--local flag)")
            if not self._verify_local_spec_version():
                self._log(
                    "Local spec version does not match expected version. "
                    "Proceeding anyway with --local flag.",
                    "warning",
                )
            schemas_success = self._copy_local_schemas(self.bundled_schemas_dir)

        else:
            # Try GitHub first, fall back to local
            try:
                schemas_success = self._fetch_from_github(version, self.bundled_schemas_dir)
            except GitHubFetchError as e:
                self._log(f"GitHub fetch failed: {e}", "warning")
                self._log("")
                self._log("Falling back to local schemas...")

                if self._verify_local_spec_version():
                    schemas_success = self._copy_local_schemas(self.bundled_schemas_dir)
                else:
                    self._log(
                        "Local fallback not available: version mismatch or missing files",
                        "error",
                    )
                    return 2

        if not schemas_success:
            self._log("Failed to bundle schemas", "error")
            return 1

        # Write manifest for integrity tracking
        source = "local" if use_local else "github"
        self._write_manifest(version, source)

        self._log("")

        # Step 2: Copy integrations
        self._log("Step 2: Copying Integrations")
        self._log("-" * 30)
        self._copy_integrations()
        self._log("")

        # Success summary
        self._log("=" * 50)
        if self.dry_run:
            self._log("DRY RUN COMPLETE - no files were modified")
        else:
            self._log("Build preparation complete!")
            self._log("")
            self._log("Next steps:")
            self._log("  cd cli")
            self._log("  python -m build")

        return 0


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Prepare build by fetching schemas from GitHub releases",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    parser.add_argument(
        "--local",
        action="store_true",
        help="Use local schemas instead of fetching from GitHub",
    )
    parser.add_argument(
        "--spec-version",
        type=str,
        help="Override spec version (default: from spec_version.py)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose output",
    )
    parser.add_argument(
        "--root-dir",
        type=Path,
        help="Project root directory (auto-detected)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify integrity of existing bundled schemas (detect manual edits)",
    )

    args = parser.parse_args()

    try:
        bundler = SchemaBundler(
            root_dir=args.root_dir,
            verbose=args.verbose,
            dry_run=args.dry_run,
        )

        # Handle verify-only mode
        if args.verify:
            print("Verifying bundled schema integrity...")
            print(f"Bundled schemas: {bundler.bundled_schemas_dir}")
            print("")

            is_valid, issues = bundler.verify_integrity()

            if is_valid:
                print("Integrity check PASSED - no modifications detected")
                sys.exit(0)
            else:
                print("Integrity check FAILED - issues detected:")
                for issue in issues:
                    print(f"  - {issue}")
                print("")
                print("To fix: Run 'python scripts/prepare_build.py' to refresh from GitHub release")
                print("See RELEASING.md for the correct release workflow")
                sys.exit(4)

        exit_code = bundler.prepare_build(
            use_local=args.local,
            spec_version=args.spec_version,
        )
        sys.exit(exit_code)

    except ConfigurationError as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        sys.exit(3)

    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        if args.verbose:
            import traceback

            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
