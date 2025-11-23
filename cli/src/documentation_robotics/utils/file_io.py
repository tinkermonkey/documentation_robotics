"""
File I/O utilities for model management.
"""

import shutil
from pathlib import Path
from typing import Any, Dict

import yaml


def update_yaml_element(file_path: Path, element_id: str, data: Dict[str, Any]) -> None:
    """
    Update a specific element in a YAML file.

    Args:
        file_path: Path to YAML file
        element_id: Element ID
        data: Updated element data
    """
    # Load existing data
    if file_path.exists():
        with open(file_path, "r") as f:
            file_data = yaml.safe_load(f) or {}
    else:
        file_data = {}

    # Find element by ID and update
    for key, value in file_data.items():
        if isinstance(value, dict) and value.get("id") == element_id:
            file_data[key] = data
            break
    else:
        # Element not found, add with name as key
        name = data.get("name", element_id)
        file_data[name] = data

    # Save updated data
    with open(file_path, "w") as f:
        yaml.dump(file_data, f, default_flow_style=False, sort_keys=False)


def copy_schemas(source: Path, destination: Path) -> None:
    """
    Copy schema files from source to destination.

    Args:
        source: Source directory
        destination: Destination directory
    """
    if not source.exists():
        return

    destination.mkdir(parents=True, exist_ok=True)

    for item in source.iterdir():
        if item.is_file() and item.suffix in [".json", ".yaml"]:
            shutil.copy2(item, destination / item.name)


def create_directory_structure(root: Path, directories: list[str]) -> None:
    """
    Create directory structure.

    Args:
        root: Root directory
        directories: List of directory paths to create
    """
    for dir_path in directories:
        (root / dir_path).mkdir(parents=True, exist_ok=True)
