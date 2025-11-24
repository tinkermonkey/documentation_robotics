"""
Schema management for the Documentation Robotics CLI.

This package handles bundling, fetching, and managing JSON schemas for all 11 layers.
"""

from .bundler import (
    copy_schemas_to_project,
    fetch_schemas_from_release,
    get_bundled_schema_path,
    get_bundled_schemas_dir,
)

__all__ = [
    "get_bundled_schema_path",
    "get_bundled_schemas_dir",
    "copy_schemas_to_project",
    "fetch_schemas_from_release",
]
