"""
Specification loading and serialization for visualization.

Loads the Documentation Robotics specification from the spec directory
and serializes it for transmission to the browser client.
"""

import json
from pathlib import Path
from typing import Any, Dict, List


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
            except Exception as e:
                # Log error but continue loading other schemas
                print(f"Warning: Failed to load schema {schema_file}: {e}")
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
                except Exception as e:
                    print(f"Warning: Failed to load shared schema {filename}: {e}")

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
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def serialize_specification(spec_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Serialize specification data for WebSocket transmission.

    This function can be extended to filter or transform the specification
    data before sending to the client.

    Args:
        spec_data: Raw specification data

    Returns:
        Serialized specification ready for transmission
    """
    # For now, return as-is. Future enhancements could include:
    # - Removing internal metadata
    # - Compressing schema definitions
    # - Filtering based on client capabilities
    return spec_data
