"""
Source map exporter for IDE integration.

Generates a JSON file mapping source files to DR model entities,
enabling IDE plugins to provide "jump to architecture" features.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from .export_manager import BaseExporter


class SourceMapExporter(BaseExporter):
    """
    Exports model to source map JSON format for IDE integration.

    Creates a mapping between source code locations and architecture model entities,
    supporting bidirectional navigation between code and architecture.
    """

    def export(self) -> Path:
        """
        Export to source map JSON.

        Returns:
            Path to exported JSON file
        """
        # Ensure output directory exists
        self.options.output_path.mkdir(parents=True, exist_ok=True)

        # Generate source map
        source_map = self._generate_source_map()

        # Write to file
        output_file = self.options.output_path / "source-map.json"
        with open(output_file, "w") as f:
            json.dump(source_map, f, indent=2)

        return output_file

    def _generate_source_map(self) -> Dict[str, Any]:
        """
        Generate source map from model.

        Returns:
            Source map dictionary with version, timestamp, and mappings
        """
        source_map = {
            "version": self.model.manifest.version,
            "generated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sourceMap": [],
        }

        # Iterate through all layers
        for layer_name, layer in self.model.layers.items():
            # Skip if filtering by layer
            if self.options.layer_filter and layer_name != self.options.layer_filter:
                continue

            # Process all elements in the layer
            for element_id, element in layer.elements.items():
                # Extract source references
                source_entries = self._extract_source_references(element, layer_name)
                source_map["sourceMap"].extend(source_entries)

        return source_map

    def _extract_source_references(self, element: Any, layer_name: str) -> List[Dict[str, Any]]:
        """
        Extract source references from an element.

        Args:
            element: The architecture element
            layer_name: Name of the layer containing the element

        Returns:
            List of source map entries for this element
        """
        entries = []

        # Check for source reference in properties
        source_ref = element.data.get("properties", {}).get("source", {}).get("reference")

        # Fall back to x-source-reference (OpenAPI-style)
        if not source_ref:
            source_ref = element.data.get("x-source-reference")

        if not source_ref:
            return entries

        # Process each location in the source reference
        locations = source_ref.get("locations", [])
        for location in locations:
            entry = {
                "file": location.get("file"),
                "symbol": location.get("symbol"),
                "entity": {
                    "id": element.id,
                    "layer": layer_name,
                    "type": element.type,
                    "name": element.data.get("name"),
                },
                "provenance": source_ref.get("provenance"),
            }

            # Add commit hash if available
            repository = source_ref.get("repository", {})
            if repository.get("commit"):
                entry["commit"] = repository["commit"]

            entries.append(entry)

        return entries
