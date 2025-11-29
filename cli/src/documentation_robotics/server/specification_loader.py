"""
Specification loading and serialization for visualization.

Loads the Documentation Robotics specification from the spec directory
and serializes it for transmission to the browser client.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from rich.console import Console

console = Console()


class SpecificationLoader:
    """Loads and serializes the DR specification."""

    def __init__(self, spec_path: Path):
        """
        Initialize specification loader.

        Args:
            spec_path: Path to the spec directory (e.g., /workspace/spec)
        """
        self.spec_path = spec_path
        self.schemas_path = spec_path / "schemas"
        self.layers_path = spec_path / "layers"
        self.version_file = spec_path / "VERSION"

    def load_specification(self) -> Dict[str, Any]:
        """
        Load complete specification data.

        Returns:
            Dictionary containing:
                - version: Specification version
                - layers: Layer schema definitions
                - shared_schemas: Shared reference schemas
                - metadata: Additional metadata
        """
        version = self._load_version()
        layer_schemas = self._load_layer_schemas()
        shared_schemas = self._load_shared_schemas()

        return {
            "version": version,
            "layers": layer_schemas,
            "shared_schemas": shared_schemas,
            "metadata": {
                "spec_path": str(self.spec_path),
                "loaded_at": self._get_timestamp(),
            },
        }

    def _load_version(self) -> str:
        """Load specification version from VERSION file."""
        if not self.version_file.exists():
            return "unknown"

        return self.version_file.read_text().strip()

    def _load_layer_schemas(self) -> List[Dict[str, Any]]:
        """
        Load all layer schema definitions.

        Returns:
            List of layer schema objects with metadata
        """
        layer_schemas = []

        # Load each layer schema file
        schema_files = sorted(self.schemas_path.glob("*-layer.schema.json"))

        for schema_file in schema_files:
            try:
                with open(schema_file, "r") as f:
                    schema_data = json.load(f)

                # Extract layer metadata from schema
                layer_name = self._extract_layer_name(schema_file.name)
                layer_order = self._extract_layer_order(schema_file.name)

                layer_schemas.append(
                    {
                        "name": layer_name,
                        "order": layer_order,
                        "schema_file": schema_file.name,
                        "title": schema_data.get("title", ""),
                        "description": schema_data.get("description", ""),
                        "schema": schema_data,
                    }
                )
            except (FileNotFoundError, json.JSONDecodeError, KeyError, OSError) as e:
                # Log error but continue loading other schemas
                console.print(f"[yellow]Warning: Failed to load schema {schema_file}: {e}[/yellow]")
                continue

        return sorted(layer_schemas, key=lambda x: x["order"])

    def _load_shared_schemas(self) -> Dict[str, Any]:
        """
        Load shared reference schemas.

        Returns:
            Dictionary of shared schema definitions
        """
        shared_schemas = {}

        shared_files = [
            "shared-references.schema.json",
            "link-registry.json",
            "federated-architecture.schema.json",
        ]

        for filename in shared_files:
            file_path = self.schemas_path / filename
            if file_path.exists():
                try:
                    with open(file_path, "r") as f:
                        schema_data = json.load(f)

                    # Use filename without extension as key
                    key = filename.replace(".schema.json", "").replace(".json", "")
                    shared_schemas[key] = schema_data
                except (FileNotFoundError, json.JSONDecodeError, OSError) as e:
                    console.print(f"[yellow]Warning: Failed to load shared schema {filename}: {e}[/yellow]")

        return shared_schemas

    def _extract_layer_name(self, filename: str) -> str:
        """
        Extract layer name from schema filename.

        Args:
            filename: Schema filename (e.g., "01-motivation-layer.schema.json")

        Returns:
            Layer name (e.g., "motivation")
        """
        # Remove order prefix and suffix
        name = filename.replace("-layer.schema.json", "")
        # Remove leading digits and hyphen
        parts = name.split("-", 1)
        if len(parts) > 1 and parts[0].isdigit():
            return parts[1]
        return name

    def _extract_layer_order(self, filename: str) -> int:
        """
        Extract layer order from schema filename.

        Args:
            filename: Schema filename (e.g., "01-motivation-layer.schema.json")

        Returns:
            Layer order number
        """
        # Extract leading digits
        parts = filename.split("-", 1)
        if parts[0].isdigit():
            return int(parts[0])
        return 0

    def _get_timestamp(self) -> str:
        """Get current timestamp in ISO format."""
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def serialize_specification(spec_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Serialize specification data for WebSocket transmission.

    This function provides a hook for future transformations of specification
    data before it is sent to the browser client. Currently returns data as-is,
    but exists as a separate function to enable future enhancements such as
    filtering internal metadata, compressing schema definitions, or adapting
    to client capabilities without modifying the core loader logic.

    Args:
        spec_data: Raw specification data from SpecificationLoader

    Returns:
        Serialized specification ready for WebSocket transmission

    Future Enhancements:
        - Remove internal metadata not needed by clients
        - Compress or minify schema definitions
        - Filter based on client capabilities or permissions
        - Apply versioning transformations for backward compatibility
    """
    return spec_data
