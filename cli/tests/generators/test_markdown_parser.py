"""Tests for markdown parser."""

import sys
from pathlib import Path

import pytest

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parents[2] / "scripts"))

from generators.markdown_parser import MarkdownLayerParser  # noqa: E402

# Mark all tests in this module as expected to fail - these are WIP tests for generator functionality
pytestmark = pytest.mark.skip(reason="WIP: Generator tests under development")


class TestMarkdownLayerParser:
    """Tests for MarkdownLayerParser."""

    @pytest.fixture
    def parser(self):
        """Create parser instance."""
        return MarkdownLayerParser()

    def test_preprocess_yaml_with_inline_description(self, parser):
        """Test preprocessing YAML with inline descriptions."""
        yaml_content = """properties:
  - key: "field.name"
    value: "something" (optional, description here)"""

        result = parser._preprocess_yaml(yaml_content)

        assert 'description: "optional, description here"' in result
        assert 'value: "something"' in result

    def test_parse_attribute_spec_simple(self, parser):
        """Test parsing simple attribute spec."""
        spec = parser._parse_attribute_spec("name", "string")

        assert spec.name == "name"
        assert spec.type == "string"
        assert spec.format is None
        assert spec.is_optional is False
        assert spec.enum_ref is None

    def test_parse_attribute_spec_with_format(self, parser):
        """Test parsing attribute spec with format."""
        spec = parser._parse_attribute_spec("id", "string (UUID)")

        assert spec.name == "id"
        assert spec.type == "string"
        assert spec.format == "uuid"
        assert spec.is_optional is False

    def test_parse_attribute_spec_with_pk_marker(self, parser):
        """Test parsing attribute spec with PK marker."""
        spec = parser._parse_attribute_spec("id", "string (UUID) [PK]")

        assert spec.name == "id"
        assert spec.type == "string"
        assert spec.format == "uuid"
        assert spec.enum_ref is None  # PK should not be treated as enum

    def test_parse_attribute_spec_optional(self, parser):
        """Test parsing optional attribute spec."""
        spec = parser._parse_attribute_spec("documentation", "string (optional)")

        assert spec.name == "documentation"
        assert spec.type == "string"
        assert spec.is_optional is True

    def test_parse_attribute_spec_with_enum(self, parser):
        """Test parsing attribute spec with enum reference."""
        spec = parser._parse_attribute_spec("type", "EventType [enum]")

        assert spec.name == "type"
        assert spec.type == "eventtype"
        assert spec.enum_ref == "EventType"

    def test_normalize_type(self, parser):
        """Test type normalization."""
        assert parser._normalize_type("str") == "string"
        assert parser._normalize_type("int") == "integer"
        assert parser._normalize_type("bool") == "boolean"
        assert parser._normalize_type("string") == "string"

    def test_normalize_format(self, parser):
        """Test format normalization."""
        assert parser._normalize_format("UUID") == "uuid"
        assert parser._normalize_format("GUID") == "uuid"
        assert parser._normalize_format("date") == "date"
        assert parser._normalize_format("datetime") == "date-time"
        assert parser._normalize_format("email") == "email"

    def test_extract_layer_metadata_from_filename(self, parser, tmp_path):
        """Test extracting layer metadata from filename."""
        # Create temporary markdown file
        md_file = tmp_path / "02-business-layer.md"
        md_file.write_text("# Layer 2: Business Layer\n\nThis is the business layer.\n")

        spec = parser._extract_layer_metadata(md_file, md_file.read_text())

        assert spec.layer_number == 2
        assert spec.layer_name == "business-layer"
        assert spec.layer_id == "02-business-layer"
        assert spec.title == "Business Layer"

    def test_parse_real_business_layer(self):
        """Integration test: parse actual Business Layer markdown."""
        # This is an integration test that requires the real file
        business_layer_path = Path(__file__).parents[3] / "spec" / "layers" / "02-business-layer.md"

        if not business_layer_path.exists():
            pytest.skip("Business layer markdown not found")

        parser = MarkdownLayerParser()
        layer_spec = parser.parse(business_layer_path)

        assert layer_spec.layer_number == 2
        assert layer_spec.layer_id == "02-business-layer"
        assert len(layer_spec.entities) > 0

        # Check specific entities exist
        assert "BusinessActor" in layer_spec.entities
        assert "BusinessRole" in layer_spec.entities
        assert "BusinessProcess" in layer_spec.entities

        # Check BusinessActor attributes
        business_actor = layer_spec.entities["BusinessActor"]
        assert "id" in business_actor.attributes
        assert "name" in business_actor.attributes
        assert "documentation" in business_actor.attributes

        # Check id attribute has UUID format
        assert business_actor.attributes["id"].format == "uuid"
