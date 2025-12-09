"""Markdown layer specification parser.

Extracts entity definitions from markdown layer specifications in YAML format.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


@dataclass
class AttributeSpec:
    """Specification for an entity attribute."""

    name: str
    type: str  # "string", "integer", "boolean", etc.
    format: Optional[str] = None  # "uuid", "date", etc.
    is_optional: bool = False
    enum_ref: Optional[str] = None  # Reference to enum type
    description: Optional[str] = None


@dataclass
class PropertySpec:
    """Specification for a cross-layer property."""

    key: str  # e.g., "motivation.delivers-value"
    value: str  # Type or example value
    description: str
    is_optional: bool = True


@dataclass
class ContainsSpec:
    """Specification for a contains relationship."""

    name: str  # Relationship name (e.g., "services")
    target_type: str  # Target entity type (e.g., "BusinessService")
    min_items: int = 0  # Minimum number of items
    max_items: Optional[int] = None  # Maximum number of items (None = unbounded)


@dataclass
class EntityDefinition:
    """Complete definition of an entity from markdown."""

    name: str
    description: str
    attributes: Dict[str, AttributeSpec] = field(default_factory=dict)
    properties: List[PropertySpec] = field(default_factory=list)
    enums: Dict[str, List[str]] = field(default_factory=dict)
    examples: List[str] = field(default_factory=list)
    contains: Dict[str, Any] = field(default_factory=dict)  # For contains relationships


@dataclass
class LayerSpec:
    """Complete specification for a layer."""

    layer_number: int
    layer_name: str
    layer_id: str  # e.g., "01-motivation"
    title: str
    description: str
    entities: Dict[str, EntityDefinition] = field(default_factory=dict)
    relationship_types: List[str] = field(default_factory=list)


class MarkdownLayerParser:
    """Parser for markdown layer specifications."""

    # Regex patterns
    YAML_BLOCK_PATTERN = re.compile(r"```yaml\n([\s\S]*?)\n```", re.MULTILINE)
    LAYER_ID_PATTERN = re.compile(r"^#\s+Layer\s+(\d+):\s+(.+)$", re.MULTILINE)

    def __init__(self):
        """Initialize the parser."""
        self.current_file: Optional[Path] = None

    def parse(self, markdown_path: Path) -> LayerSpec:
        """Extract all entities from markdown file.

        Args:
            markdown_path: Path to markdown layer specification file

        Returns:
            LayerSpec with all parsed entities

        Raises:
            ValueError: If markdown cannot be parsed
        """
        self.current_file = markdown_path

        with open(markdown_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Extract layer metadata from filename and content
        layer_spec = self._extract_layer_metadata(markdown_path, content)

        # Extract all YAML blocks
        yaml_blocks = self.YAML_BLOCK_PATTERN.findall(content)

        if not yaml_blocks:
            raise ValueError(f"No YAML blocks found in {markdown_path}")

        # Parse each YAML block
        for yaml_content in yaml_blocks:
            try:
                # Pre-process YAML to handle inline descriptions in properties
                yaml_content = self._preprocess_yaml(yaml_content)

                data = yaml.safe_load(yaml_content)
                if isinstance(data, dict):
                    self._parse_yaml_block(data, layer_spec)
            except yaml.YAMLError as e:
                print(f"Warning: Skipping invalid YAML block in {markdown_path}: {e}")
                continue

        return layer_spec

    def _extract_layer_metadata(self, markdown_path: Path, content: str) -> LayerSpec:
        """Extract layer metadata from filename and content.

        Args:
            markdown_path: Path to markdown file
            content: Markdown content

        Returns:
            LayerSpec with metadata filled in
        """
        # Extract from filename: "NN-layer-name.md"
        filename = markdown_path.stem
        match = re.match(r"(\d+)-([\w-]+)", filename)
        if not match:
            raise ValueError(f"Invalid layer filename format: {filename}")

        layer_number = int(match.group(1))
        layer_name = match.group(2)
        layer_id = f"{layer_number:02d}-{layer_name}"

        # Try to extract title from first heading
        title_match = self.LAYER_ID_PATTERN.search(content)
        if title_match:
            title = title_match.group(2).strip()
        else:
            # Fallback to capitalized layer name
            title = layer_name.replace("-", " ").title()

        # Extract description from first paragraph after title
        description = self._extract_description(content)

        return LayerSpec(
            layer_number=layer_number,
            layer_name=layer_name,
            layer_id=layer_id,
            title=title,
            description=description,
        )

    def _preprocess_yaml(self, yaml_content: str) -> str:
        """Pre-process YAML content to handle inline descriptions.

        Converts:
            value: "something" (description here)
        To:
            value: "something"
            description: "description here"

        Args:
            yaml_content: Raw YAML content

        Returns:
            Processed YAML content
        """
        # Pattern to match: value: "..." (description) or value: "..." (optional, description)
        pattern = r'(\s+value:\s+"[^"]+")(\s+\([^)]+\))'

        def replace_inline_desc(match):
            value_part = match.group(1)
            desc_part = match.group(2).strip()
            # Remove parentheses and quote the description
            desc_text = desc_part.strip("() \t")
            return f'{value_part}\n      description: "{desc_text}"'

        return re.sub(pattern, replace_inline_desc, yaml_content)

    def _extract_description(self, content: str) -> str:
        """Extract layer description from content.

        Args:
            content: Markdown content

        Returns:
            Description text or empty string
        """
        # Look for first paragraph after the main heading
        lines = content.split("\n")
        in_description = False
        description_lines = []

        for line in lines:
            stripped = line.strip()

            # Skip until we find the first heading
            if stripped.startswith("# Layer"):
                in_description = True
                continue

            # Stop at next heading or YAML block
            if in_description:
                if stripped.startswith("#") or stripped.startswith("```"):
                    break
                if stripped:
                    description_lines.append(stripped)
                elif description_lines:  # Empty line after description
                    break

        return " ".join(description_lines) if description_lines else ""

    def _parse_yaml_block(self, data: Dict[str, Any], layer_spec: LayerSpec):
        """Parse a single YAML block for entity definitions.

        Args:
            data: Parsed YAML data
            layer_spec: LayerSpec to add entities to
        """
        for entity_name, entity_data in data.items():
            if not isinstance(entity_data, dict):
                continue

            # Check if this looks like an entity definition
            if "description" in entity_data or "attributes" in entity_data:
                entity = self._parse_entity(entity_name, entity_data)
                layer_spec.entities[entity_name] = entity

    def _parse_entity(self, name: str, data: Dict[str, Any]) -> EntityDefinition:
        """Parse entity definition from YAML data.

        Args:
            name: Entity name
            data: Entity YAML data

        Returns:
            EntityDefinition
        """
        entity = EntityDefinition(
            name=name, description=data.get("description", ""), examples=data.get("examples", [])
        )

        # Parse attributes
        if "attributes" in data:
            self._parse_attributes(data["attributes"], entity)

        # Parse properties
        if "properties" in data:
            self._parse_properties(data["properties"], entity)

        # Parse enums
        if "enums" in data:
            entity.enums = data["enums"]

        # Parse contains relationships
        if "contains" in data:
            entity.contains = data["contains"]

        return entity

    def _parse_attributes(self, attributes: Any, entity: EntityDefinition):
        """Parse entity attributes.

        Args:
            attributes: Attributes data (dict or list)
            entity: EntityDefinition to add attributes to
        """
        if isinstance(attributes, dict):
            # Format: {name: "type [PK] (optional)"}
            for attr_name, attr_spec in attributes.items():
                entity.attributes[attr_name] = self._parse_attribute_spec(attr_name, attr_spec)
        elif isinstance(attributes, list):
            # Format: list of strings "name: type [PK] (optional)"
            for attr_line in attributes:
                if isinstance(attr_line, str) and ":" in attr_line:
                    attr_name, attr_spec = attr_line.split(":", 1)
                    entity.attributes[attr_name.strip()] = self._parse_attribute_spec(
                        attr_name.strip(), attr_spec.strip()
                    )

    def _parse_attribute_spec(self, name: str, spec: str) -> AttributeSpec:
        """Parse attribute specification string.

        Args:
            name: Attribute name
            spec: Specification string like "string (UUID) [PK] (optional)"

        Returns:
            AttributeSpec
        """
        # Extract optional flag
        is_optional = "(optional)" in spec.lower()
        spec = re.sub(r"\(optional\)", "", spec, flags=re.IGNORECASE).strip()

        # Extract format from parentheses
        format_match = re.search(r"\(([^)]+)\)", spec)
        format_str = format_match.group(1) if format_match else None
        if format_match:
            spec = re.sub(r"\([^)]+\)", "", spec).strip()

        # Extract enum reference from brackets (but not [PK])
        enum_match = re.search(r"\[(\w+)\]", spec)
        enum_ref = None

        # Remove brackets first to get the type
        if enum_match:
            spec = re.sub(r"\[\w+\]", "", spec).strip()

        # What's left is the type
        type_str = spec.strip()

        # Determine enum_ref based on what was in brackets
        if enum_match:
            bracket_content = enum_match.group(1)
            if bracket_content.lower() == "enum":
                # When [enum] is used, the type itself is the enum name
                enum_ref = type_str
            elif bracket_content != "PK":
                # Otherwise, brackets contain the enum type name
                enum_ref = bracket_content

        # Normalize type
        type_normalized = self._normalize_type(type_str)

        # Normalize format
        format_normalized = self._normalize_format(format_str) if format_str else None

        return AttributeSpec(
            name=name,
            type=type_normalized,
            format=format_normalized,
            is_optional=is_optional,
            enum_ref=enum_ref,
        )

    def _parse_properties(self, properties: Any, entity: EntityDefinition):
        """Parse cross-layer properties.

        Args:
            properties: Properties data (list of dicts or strings)
            entity: EntityDefinition to add properties to
        """
        if not isinstance(properties, list):
            return

        for prop in properties:
            if isinstance(prop, dict):
                # Format: {key: "namespace.field", value: "type", description: "..."}
                key = prop.get("key", "")
                value = prop.get("value", "")
                description = prop.get("description", "")
                is_optional = prop.get("optional", True)

                if key:
                    entity.properties.append(
                        PropertySpec(
                            key=key, value=value, description=description, is_optional=is_optional
                        )
                    )
            elif isinstance(prop, str):
                # Format: "namespace.field: type (description)"
                if ":" in prop:
                    key, rest = prop.split(":", 1)
                    # Try to extract description from parentheses
                    desc_match = re.search(r"\(([^)]+)\)", rest)
                    description = desc_match.group(1) if desc_match else ""
                    value = re.sub(r"\([^)]+\)", "", rest).strip()

                    entity.properties.append(
                        PropertySpec(key=key.strip(), value=value, description=description)
                    )

    def _normalize_type(self, type_str: str) -> str:
        """Normalize type string to JSON Schema type.

        Args:
            type_str: Type string from markdown

        Returns:
            Normalized JSON Schema type
        """
        type_str = type_str.lower().strip()

        # Map common variations
        type_map = {
            "str": "string",
            "int": "integer",
            "bool": "boolean",
            "num": "number",
            "arr": "array",
            "obj": "object",
        }

        return type_map.get(type_str, type_str)

    def _normalize_format(self, format_str: str) -> str:
        """Normalize format string to JSON Schema format.

        Args:
            format_str: Format string from markdown

        Returns:
            Normalized JSON Schema format
        """
        format_str = format_str.lower().strip()

        # Map common variations
        format_map = {
            "uuid": "uuid",
            "guid": "uuid",
            "date": "date",
            "datetime": "date-time",
            "time": "time",
            "email": "email",
            "uri": "uri",
            "url": "uri",
        }

        return format_map.get(format_str, format_str)
