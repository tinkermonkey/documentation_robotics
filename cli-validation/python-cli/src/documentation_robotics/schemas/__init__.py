"""
Schema management for the Documentation Robotics CLI.

This package handles bundling, fetching, and managing JSON schemas for all 12 layers,
plus relationship catalog and common schema files.
"""

from .bundler import (
    copy_schemas_to_project,
    fetch_schemas_from_release,
    get_bundled_schema_path,
    get_bundled_schemas_dir,
    get_relationship_catalog_path,
    load_relationship_catalog,
)

__all__ = [
    "get_bundled_schema_path",
    "get_bundled_schemas_dir",
    "get_relationship_catalog_path",
    "load_relationship_catalog",
    "copy_schemas_to_project",
    "fetch_schemas_from_release",
]
