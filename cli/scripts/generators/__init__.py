"""Schema generation from markdown specifications.

This module provides automated generation of JSON Schemas from markdown
layer specifications, ensuring consistency between documentation and schemas.
"""

from .markdown_parser import (
    AttributeSpec,
    EntityDefinition,
    LayerSpec,
    MarkdownLayerParser,
    PropertySpec,
)
from .schema_generator import JSONSchemaGenerator
from .schema_merger import SchemaMerger

__all__ = [
    "AttributeSpec",
    "EntityDefinition",
    "LayerSpec",
    "MarkdownLayerParser",
    "PropertySpec",
    "JSONSchemaGenerator",
    "SchemaMerger",
]
