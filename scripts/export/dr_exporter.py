#!/usr/bin/env python3
"""
CSV Exporter for Documentation Robotics

Exports DR specification ontology and model data to Context Studio CSV format.

Usage:
    python scripts/export/dr_exporter.py --mode ontology --output ontology.csv
    python scripts/export/dr_exporter.py --mode model --model-path spec/examples/minimal
"""

import argparse
import csv
import json
import sys
import uuid
import yaml
from pathlib import Path
from typing import Dict, List, Optional, IO, Any

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class CSVExporter:
    """Base class for CSV export functionality."""

    def __init__(self, output_path: Optional[str] = None, include_ids: bool = True):
        """
        Initialize CSV exporter.

        Args:
            output_path: File path or None for stdout
            include_ids: Whether to include ID column
        """
        self.output_path = output_path
        self.include_ids = include_ids
        self.rows: List[Dict[str, str]] = []

    def add_row(self, depth: int, title: str, definition: str = "", id: str = ""):
        """
        Add a CSV row to the internal buffer.

        Args:
            depth: Hierarchy level (0=Layer, 1=Domain, 2+=Term)
            title: Display name of the entity
            definition: Descriptive text
            id: Unique identifier (optional)
        """
        row = {
            "Depth": str(depth),
            "Title": title[:255] if title else "",  # Truncate to 255 chars
            "Definition": definition[:5000] if definition else "",  # Truncate long defs
            "ID": id if self.include_ids else ""
        }
        self.rows.append(row)

    def write_csv(self, file_handle: IO):
        """
        Write CSV rows with proper UTF-8 encoding and quoting.

        Args:
            file_handle: File handle to write to
        """
        writer = csv.DictWriter(
            file_handle,
            fieldnames=["Depth", "Title", "Definition", "ID"],
            delimiter=",",
            quoting=csv.QUOTE_MINIMAL,
            lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(self.rows)

    def generate_uuid(self) -> str:
        """Generate UUID v4 for IDs."""
        return str(uuid.uuid4())

    def validate_output_path(self) -> Optional[Path]:
        """
        Ensure output directory exists.

        Returns:
            Path object or None for stdout
        """
        if not self.output_path:
            return None

        path = Path(self.output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def export(self):
        """Export data to CSV. Override in subclasses."""
        raise NotImplementedError("Subclasses must implement export()")


class OntologyExporter(CSVExporter):
    """Export DR specification ontology (layers + entity types)."""

    def __init__(
        self,
        schemas_path: Path,
        output_path: Optional[str] = None,
        include_ids: bool = True
    ):
        """
        Initialize ontology exporter.

        Args:
            schemas_path: Path to schema files
            output_path: Output file path or None for stdout
            include_ids: Whether to include ID column
        """
        super().__init__(output_path, include_ids)
        self.schemas_path = schemas_path

    def load_layer_schemas(self) -> List[Dict[str, Any]]:
        """
        Load all *-layer.schema.json files.

        Returns:
            List of schema data with layer info and entity types
        """
        if not self.schemas_path.exists():
            print(f"ERROR: Schemas path not found: {self.schemas_path}", file=sys.stderr)
            sys.exit(1)

        # Find all layer schema files
        schema_files = sorted(self.schemas_path.glob("*-layer.schema.json"))
        if not schema_files:
            print(f"ERROR: No layer schema files found in {self.schemas_path}", file=sys.stderr)
            sys.exit(1)

        schemas = []
        for schema_file in schema_files:
            try:
                with open(schema_file, 'r', encoding='utf-8') as f:
                    schema = json.load(f)

                # Extract layer info
                layer_data = {
                    "file": schema_file.name,
                    "title": schema.get("title", schema_file.stem),
                    "description": schema.get("description", ""),
                    "entity_types": self.extract_entity_types(schema)
                }
                schemas.append(layer_data)

            except json.JSONDecodeError as e:
                print(f"WARNING: Failed to parse {schema_file}: {e}", file=sys.stderr)
                continue
            except Exception as e:
                print(f"ERROR: Failed to load {schema_file}: {e}", file=sys.stderr)
                sys.exit(1)

        return schemas

    def extract_entity_types(self, schema: Dict[str, Any]) -> List[Dict[str, str]]:
        """
        Extract entity type definitions from schema definitions.

        Args:
            schema: JSON schema dictionary

        Returns:
            List of entity types with name and description
        """
        entity_types = []
        definitions = schema.get("definitions", {})

        for name, definition in definitions.items():
            # Filter out enum types and other non-entity definitions
            if not isinstance(definition, dict):
                continue

            # Skip if it doesn't have properties (likely an enum or simple type)
            if "properties" not in definition:
                continue

            entity_types.append({
                "name": name,
                "description": definition.get("description", "")
            })

        return entity_types

    def export(self):
        """Export ontology to CSV."""
        print("Loading layer schemas...", file=sys.stderr)
        schemas = self.load_layer_schemas()

        print(f"Building CSV rows for {len(schemas)} layers...", file=sys.stderr)
        for schema in schemas:
            # Add Layer row (Depth 0)
            self.add_row(
                depth=0,
                title=schema["title"],
                definition=schema["description"],
                id=self.generate_uuid() if self.include_ids else ""
            )

            # Add Entity Type rows (Depth 1)
            for entity_type in schema["entity_types"]:
                self.add_row(
                    depth=1,
                    title=entity_type["name"],
                    definition=entity_type["description"],
                    id=self.generate_uuid() if self.include_ids else ""
                )

        # Write CSV
        output_path = self.validate_output_path()
        print(f"Writing {len(self.rows)} rows to {'stdout' if not output_path else output_path}...", file=sys.stderr)

        try:
            if output_path:
                with open(output_path, 'w', encoding='utf-8', newline='') as f:
                    self.write_csv(f)
                print(f"Successfully exported ontology to {output_path}", file=sys.stderr)
            else:
                self.write_csv(sys.stdout)
        except Exception as e:
            print(f"ERROR: Failed to write CSV: {e}", file=sys.stderr)
            sys.exit(1)


class ModelExporter(CSVExporter):
    """Export DR model instance data (layers + entity types + elements)."""

    def __init__(
        self,
        model_path: Path,
        output_path: Optional[str] = None,
        include_ids: bool = True
    ):
        """
        Initialize model exporter.

        Args:
            model_path: Path to model directory
            output_path: Output file path or None for stdout
            include_ids: Whether to include ID column
        """
        super().__init__(output_path, include_ids)
        self.model_path = model_path
        self.model = None

    def load_model(self):
        """Load DR model data directly from YAML files."""
        try:
            # Check if manifest exists
            manifest_path = self.model_path / "manifest.yaml"
            if not manifest_path.exists():
                print(f"ERROR: Model manifest not found: {manifest_path}", file=sys.stderr)
                sys.exit(1)

            # Load manifest
            print(f"Loading model from {self.model_path}...", file=sys.stderr)
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = yaml.safe_load(f)

            # Build model structure
            self.model = {
                "manifest": manifest,
                "layers": {}
            }

            # Load each enabled layer
            layers_config = manifest.get("layers", {})
            for layer_name, layer_config in layers_config.items():
                if not layer_config.get("enabled", True):
                    continue

                # Construct layer path (relative to model_path parent or absolute)
                layer_rel_path = layer_config.get("path", f"model/{layer_name}")
                layer_path = self.model_path.parent / layer_rel_path

                if not layer_path.exists():
                    # Try directly under model_path
                    layer_path = self.model_path / layer_name
                    if not layer_path.exists():
                        print(f"WARNING: Layer path not found: {layer_path}", file=sys.stderr)
                        continue

                # Load all YAML files in this layer
                elements = []
                for yaml_file in layer_path.glob("*.yaml"):
                    try:
                        with open(yaml_file, 'r', encoding='utf-8') as f:
                            data = yaml.safe_load(f)
                            if isinstance(data, list):
                                elements.extend(data)
                            elif isinstance(data, dict):
                                elements.append(data)
                    except Exception as e:
                        print(f"WARNING: Failed to load {yaml_file}: {e}", file=sys.stderr)
                        continue

                self.model["layers"][layer_name] = {
                    "name": layer_name,
                    "config": layer_config,
                    "elements": elements
                }

        except Exception as e:
            print(f"ERROR: Failed to load model: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            sys.exit(1)

    def group_elements_by_type(self, elements: List[Dict]) -> Dict[str, List[Dict]]:
        """
        Group elements by their type.

        Args:
            elements: List of element dictionaries

        Returns:
            Dictionary mapping element type to list of elements
        """
        grouped = {}
        for element in elements:
            element_type = element.get("type", "unknown")
            if element_type not in grouped:
                grouped[element_type] = []
            grouped[element_type].append(element)
        return grouped

    def export(self):
        """Export model to CSV."""
        self.load_model()

        # Get all layers
        layer_names = sorted(self.model["layers"].keys())
        print(f"Building CSV rows for {len(layer_names)} layers...", file=sys.stderr)

        for layer_name in layer_names:
            layer = self.model["layers"][layer_name]

            # Add Layer row (Depth 0)
            self.add_row(
                depth=0,
                title=layer["name"],
                definition=layer["config"].get("description", ""),
                id=self.generate_uuid() if self.include_ids else ""
            )

            # Get all elements in this layer
            elements = layer["elements"]
            if not elements:
                continue

            # Group elements by type
            elements_by_type = self.group_elements_by_type(elements)

            for element_type in sorted(elements_by_type.keys()):
                # Add Entity Type row (Depth 1)
                self.add_row(
                    depth=1,
                    title=element_type,
                    definition=f"Entity type: {element_type}",
                    id=self.generate_uuid() if self.include_ids else ""
                )

                # Add Element Instance rows (Depth 2)
                for element in elements_by_type[element_type]:
                    # Get title: prefer name, fallback to id
                    title = element.get("name", element.get("id", "unnamed"))

                    # Get definition: try multiple fields
                    definition = (
                        element.get("description", "") or
                        element.get("documentation", "") or
                        ""
                    )

                    # Get ID
                    element_id = element.get("id", "")

                    self.add_row(
                        depth=2,
                        title=title,
                        definition=definition,
                        id=element_id  # Use existing element ID
                    )

        # Write CSV
        output_path = self.validate_output_path()
        print(f"Writing {len(self.rows)} rows to {'stdout' if not output_path else output_path}...", file=sys.stderr)

        try:
            if output_path:
                with open(output_path, 'w', encoding='utf-8', newline='') as f:
                    self.write_csv(f)
                print(f"Successfully exported model to {output_path}", file=sys.stderr)
            else:
                self.write_csv(sys.stdout)
        except Exception as e:
            print(f"ERROR: Failed to write CSV: {e}", file=sys.stderr)
            sys.exit(1)


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Export Documentation Robotics data to Context Studio CSV format",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Export ontology to file
  %(prog)s --mode ontology --output ontology.csv

  # Export model to file
  %(prog)s --mode model --output model.csv --model-path spec/examples/minimal

  # Export to stdout
  %(prog)s --mode ontology

  # Omit IDs (auto-generate on import)
  %(prog)s --mode ontology --no-ids --output ontology.csv
        """
    )

    parser.add_argument(
        "--mode",
        choices=["ontology", "model"],
        required=True,
        help="Export mode: 'ontology' (spec schemas) or 'model' (instance data)"
    )

    parser.add_argument(
        "--output",
        help="Output CSV file path (default: stdout)"
    )

    parser.add_argument(
        "--model-path",
        default="spec/examples/minimal/model",
        help="Path to model directory for 'model' mode (default: spec/examples/minimal/model)"
    )

    parser.add_argument(
        "--schemas-path",
        default="spec/schemas",
        help="Path to schema files for 'ontology' mode (default: spec/schemas)"
    )

    parser.add_argument(
        "--no-ids",
        action="store_true",
        help="Omit ID column (Context Studio will auto-generate)"
    )

    args = parser.parse_args()

    # Create appropriate exporter
    if args.mode == "ontology":
        exporter = OntologyExporter(
            schemas_path=Path(args.schemas_path),
            output_path=args.output,
            include_ids=not args.no_ids
        )
    else:  # model
        exporter = ModelExporter(
            model_path=Path(args.model_path),
            output_path=args.output,
            include_ids=not args.no_ids
        )

    # Run export
    exporter.export()


if __name__ == "__main__":
    main()
