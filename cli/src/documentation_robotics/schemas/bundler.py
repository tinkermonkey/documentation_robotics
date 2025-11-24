"""
Schema bundling and management for Documentation Robotics CLI.

This module handles:
- Bundled schema paths (schemas packaged with the CLI)
- Copying schemas to new projects
- Fetching schemas from GitHub releases for updates
"""

import json
import logging
import shutil
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Layer schema filenames
LAYER_SCHEMAS = [
    "01-motivation-layer.schema.json",
    "02-business-layer.schema.json",
    "03-security-layer.schema.json",
    "04-application-layer.schema.json",
    "05-technology-layer.schema.json",
    "06-api-layer.schema.json",
    "07-data-model-layer.schema.json",
    "08-datastore-layer.schema.json",
    "09-ux-layer.schema.json",
    "10-navigation-layer.schema.json",
    "11-apm-observability-layer.schema.json",
]

# Master schema
MASTER_SCHEMA = "federated-architecture.schema.json"

# GitHub repository information
GITHUB_REPO = "anthropics/claude-code"  # This should be updated to the actual repo
GITHUB_API_BASE = "https://api.github.com"


def get_bundled_schemas_dir() -> Path:
    """
    Get the path to bundled schemas directory.

    Returns:
        Path to the bundled schemas directory
    """
    return Path(__file__).parent / "bundled"


def get_bundled_schema_path(schema_filename: str) -> Path:
    """
    Get the path to a specific bundled schema file.

    Args:
        schema_filename: Name of the schema file (e.g., "01-motivation-layer.schema.json")

    Returns:
        Path to the schema file

    Raises:
        FileNotFoundError: If the schema file doesn't exist
    """
    schema_path = get_bundled_schemas_dir() / schema_filename

    if not schema_path.exists():
        raise FileNotFoundError(
            f"Schema file not found: {schema_filename}\n" f"Expected at: {schema_path}"
        )

    return schema_path


def copy_schemas_to_project(project_schemas_dir: Path, overwrite: bool = False) -> int:
    """
    Copy bundled schemas to a project's .dr/schemas directory.

    Args:
        project_schemas_dir: Path to the project's schemas directory
        overwrite: Whether to overwrite existing schemas

    Returns:
        Number of schemas copied

    Raises:
        FileNotFoundError: If bundled schemas directory doesn't exist
    """
    bundled_dir = get_bundled_schemas_dir()

    if not bundled_dir.exists():
        raise FileNotFoundError(
            f"Bundled schemas directory not found: {bundled_dir}\n"
            "This may indicate a corrupted installation."
        )

    # Create project schemas directory if it doesn't exist
    project_schemas_dir.mkdir(parents=True, exist_ok=True)

    copied_count = 0

    # Copy all layer schemas
    for schema_filename in LAYER_SCHEMAS + [MASTER_SCHEMA]:
        source_path = bundled_dir / schema_filename
        dest_path = project_schemas_dir / schema_filename

        if not source_path.exists():
            logger.warning(f"Bundled schema missing: {schema_filename}")
            continue

        # Skip if exists and not overwriting
        if dest_path.exists() and not overwrite:
            logger.debug(f"Schema already exists, skipping: {schema_filename}")
            continue

        try:
            shutil.copy2(source_path, dest_path)
            copied_count += 1
            logger.info(f"Copied schema: {schema_filename}")
        except Exception as e:
            logger.error(f"Failed to copy schema {schema_filename}: {e}")

    return copied_count


def fetch_schemas_from_release(
    version: str, output_dir: Path, overwrite: bool = False
) -> Dict[str, bool]:
    """
    Fetch schemas from a specific GitHub release.

    This function downloads schema files from a GitHub release and saves them
    to the specified directory. Useful for updating to a new spec version.

    Args:
        version: Spec version to fetch (e.g., "0.1.0")
        output_dir: Directory to save schemas to
        overwrite: Whether to overwrite existing schemas

    Returns:
        Dictionary mapping schema filenames to success status

    Raises:
        urllib.error.HTTPError: If the release doesn't exist or network error
        ValueError: If the version format is invalid
    """
    # Validate version format (basic check)
    if not version or not version[0].isdigit():
        raise ValueError(f"Invalid version format: {version}")

    output_dir.mkdir(parents=True, exist_ok=True)
    results = {}

    # GitHub releases API URL
    # Format: https://github.com/{owner}/{repo}/releases/download/v{version}/{file}
    base_url = f"https://github.com/{GITHUB_REPO}/releases/download/v{version}"

    for schema_filename in LAYER_SCHEMAS + [MASTER_SCHEMA]:
        dest_path = output_dir / schema_filename

        # Skip if exists and not overwriting
        if dest_path.exists() and not overwrite:
            logger.debug(f"Schema already exists, skipping: {schema_filename}")
            results[schema_filename] = True
            continue

        schema_url = f"{base_url}/{schema_filename}"

        try:
            logger.info(f"Fetching {schema_filename} from {schema_url}")

            # Download schema
            with urllib.request.urlopen(schema_url) as response:
                schema_content = response.read()

            # Validate JSON
            try:
                json.loads(schema_content)
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON in {schema_filename}: {e}")
                results[schema_filename] = False
                continue

            # Save to file
            dest_path.write_bytes(schema_content)
            logger.info(f"Successfully downloaded: {schema_filename}")
            results[schema_filename] = True

        except urllib.error.HTTPError as e:
            logger.error(f"HTTP error downloading {schema_filename}: {e.code} {e.reason}")
            results[schema_filename] = False
        except urllib.error.URLError as e:
            logger.error(f"URL error downloading {schema_filename}: {e.reason}")
            results[schema_filename] = False
        except Exception as e:
            logger.error(f"Unexpected error downloading {schema_filename}: {e}")
            results[schema_filename] = False

    return results


def list_available_releases() -> List[str]:
    """
    List available spec releases from GitHub.

    Returns:
        List of available version tags

    Raises:
        urllib.error.HTTPError: If API request fails
    """
    releases_url = f"{GITHUB_API_BASE}/repos/{GITHUB_REPO}/releases"

    try:
        with urllib.request.urlopen(releases_url) as response:
            releases_data = json.loads(response.read())

        # Extract version tags (remove 'v' prefix if present)
        versions = [
            release["tag_name"].lstrip("v")
            for release in releases_data
            if not release.get("draft", False)
        ]

        return versions

    except urllib.error.HTTPError as e:
        logger.error(f"Failed to fetch releases: {e.code} {e.reason}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error fetching releases: {e}")
        raise


def get_schema_version(schema_path: Path) -> Optional[str]:
    """
    Extract version information from a schema file.

    Args:
        schema_path: Path to the schema file

    Returns:
        Schema version if found, None otherwise
    """
    try:
        with open(schema_path, "r") as f:
            schema = json.load(f)

        # Look for version in common places
        version = schema.get("version") or schema.get("$version")

        return version

    except Exception as e:
        logger.error(f"Failed to read schema version from {schema_path}: {e}")
        return None
