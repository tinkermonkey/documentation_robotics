"""
JSON Schema exporter.
"""

import json
from pathlib import Path
from typing import Any, Dict

from .export_manager import BaseExporter


class JSONSchemaExporter(BaseExporter):
    """
    Exports data model layer to JSON Schema Draft 7 files.

    Creates one JSON Schema file per entity.
    """

    def export(self) -> Path:
        """
        Export to JSON Schema.

        Returns:
            Path to output directory
        """
        # Get data model layer
        data_layer = self.model.get_layer("data_model")
        if not data_layer:
            raise ValueError("Data model layer not found")

        # Ensure output directory exists
        self.options.output_path.mkdir(parents=True, exist_ok=True)

        # Export each entity
        for element in data_layer.elements.values():
            if element.type == "entity":
                schema = self._create_schema(element)

                # Write to file
                filename = f"{element.name.lower().replace(' ', '-')}.schema.json"
                output_file = self.options.output_path / filename

                with open(output_file, "w") as f:
                    json.dump(schema, f, indent=2)

        return self.options.output_path

    def _create_schema(self, element) -> Dict[str, Any]:
        """Create JSON Schema for entity."""
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "$id": f"{element.name.lower().replace(' ', '-')}.schema.json",
            "title": element.name,
            "description": element.description or "",
            "type": "object",
            "properties": {},
            "required": [],
        }

        # Add properties
        properties = element.get("properties", {})
        for prop_name, prop_def in properties.items():
            schema["properties"][prop_name] = self._convert_property(prop_def)

            # Add to required if needed
            if isinstance(prop_def, dict) and prop_def.get("required", False):
                schema["required"].append(prop_name)

        # Add additional properties
        schema["additionalProperties"] = element.get("additionalProperties", False)

        return schema

    def _convert_property(self, prop_def: Any) -> Dict[str, Any]:
        """Convert property definition to JSON Schema."""
        if isinstance(prop_def, str):
            # Simple type
            return {"type": prop_def}

        if isinstance(prop_def, dict):
            # Already in JSON Schema format
            return prop_def

        # Default
        return {"type": "string"}

    def validate_output(self, output_path: Path) -> bool:
        """Validate exported JSON schemas."""
        # Check that directory exists and has .json files
        if not output_path.exists() or not output_path.is_dir():
            return False

        json_files = list(output_path.glob("*.schema.json"))
        if not json_files:
            return False

        # Basic validation of each file
        for json_file in json_files:
            try:
                with open(json_file, "r") as f:
                    schema = json.load(f)

                # Check required JSON Schema fields
                if "$schema" not in schema or "type" not in schema:
                    return False

            except Exception:
                return False

        return True
