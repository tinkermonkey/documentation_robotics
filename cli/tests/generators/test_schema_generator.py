"""Unit tests for schema generator."""

import sys
from pathlib import Path

import pytest

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parents[3] / "scripts"))

from generators.markdown_parser import (  # noqa: E402
    AttributeSpec,
    ContainsSpec,
    EntityDefinition,
    LayerSpec,
    PropertySpec,
)
from generators.schema_generator import JSONSchemaGenerator  # noqa: E402


class TestJSONSchemaGenerator:
    """Test JSONSchemaGenerator functionality."""

    @pytest.fixture
    def generator(self):
        """Create generator instance."""
        return JSONSchemaGenerator()

    @pytest.fixture
    def simple_entity(self):
        """Create a simple entity for testing."""
        return EntityDefinition(
            name="BusinessActor",
            description="An organizational entity",
            attributes={
                "id": AttributeSpec(name="id", type="string", format="uuid", is_optional=False),
                "name": AttributeSpec(name="name", type="string", is_optional=False),
                "documentation": AttributeSpec(
                    name="documentation", type="string", is_optional=True
                ),
            },
        )

    @pytest.fixture
    def entity_with_properties(self):
        """Create entity with properties for testing."""
        return EntityDefinition(
            name="BusinessService",
            description="Service that fulfills a need",
            attributes={
                "id": AttributeSpec(name="id", type="string", format="uuid"),
                "name": AttributeSpec(name="name", type="string"),
            },
            properties=[
                PropertySpec(
                    key="motivation.delivers-value",
                    value="value-id-1,value-id-2",
                    description="comma-separated Value IDs",
                    is_optional=True,
                ),
                PropertySpec(
                    key="sla.availability",
                    value="99.9%",
                    description="availability percentage",
                    is_optional=True,
                ),
            ],
        )

    @pytest.fixture
    def entity_with_enum(self):
        """Create entity with enum for testing."""
        return EntityDefinition(
            name="BusinessEvent",
            description="Something that happens",
            attributes={
                "id": AttributeSpec(name="id", type="string", format="uuid"),
                "name": AttributeSpec(name="name", type="string"),
                "type": AttributeSpec(name="type", type="string", enum_ref="EventType"),
            },
            enums={"EventType": ["time-driven", "state-change", "external"]},
        )

    @pytest.fixture
    def entity_with_contains(self):
        """Create entity with contains for testing."""
        return EntityDefinition(
            name="Product",
            description="Collection of services",
            attributes={
                "id": AttributeSpec(name="id", type="string", format="uuid"),
                "name": AttributeSpec(name="name", type="string"),
            },
            contains=[
                ContainsSpec(
                    name="services", target_type="BusinessService", min_items=1, max_items=None
                ),
                ContainsSpec(name="contracts", target_type="Contract", min_items=0, max_items=None),
            ],
        )

    @pytest.fixture
    def layer_spec(self, simple_entity):
        """Create layer spec for testing."""
        return LayerSpec(
            layer_number=2,
            layer_name="business",
            layer_id="02-business",
            title="Business",
            description="Business layer for testing",
            entities={"BusinessActor": simple_entity},
            relationship_types=["Composition", "Aggregation"],
        )

    def test_to_array_name(self, generator):
        """Test entity name to array name (kebab-case plural) conversion."""
        assert generator._to_array_name("BusinessActor") == "business-actors"
        assert generator._to_array_name("Contract") == "contracts"
        assert generator._to_array_name("BusinessProcess") == "business-processes"

    def test_generate_simple_entity_definition(self, generator, simple_entity):
        """Test generation of simple entity definition."""
        definition = generator._generate_entity_schema(simple_entity)

        assert definition["type"] == "object"
        assert definition["description"] == "An organizational entity"
        assert set(definition["required"]) == {"id", "name"}

        # Check properties
        props = definition["properties"]
        assert "id" in props
        assert props["id"]["type"] == "string"
        assert props["id"]["format"] == "uuid"
        assert "name" in props
        assert props["name"]["minLength"] == 1
        assert "documentation" in props

        # Should not have properties object (no cross-layer properties)
        assert "properties" not in props

    def test_generate_entity_with_properties(self, generator, entity_with_properties):
        """Test generation of entity with cross-layer properties."""
        definition = generator._generate_entity_schema(entity_with_properties)

        # Should have properties object
        assert "properties" in definition["properties"]
        props_obj = definition["properties"]["properties"]

        assert props_obj["type"] == "object"
        # Properties are nested by namespace
        assert "motivation" in props_obj["properties"]
        assert "sla" in props_obj["properties"]

        # Check nested structure
        motivation_ns = props_obj["properties"]["motivation"]
        assert motivation_ns["type"] == "object"
        assert "delivers-value" in motivation_ns["properties"]
        assert "Value IDs" in motivation_ns["properties"]["delivers-value"]["description"]

    def test_generate_entity_with_enum(self, generator, entity_with_enum):
        """Test generation of entity with enum type."""
        definition = generator._generate_entity_schema(entity_with_enum)

        # Check type attribute references enum definition
        type_prop = definition["properties"]["type"]
        assert "$ref" in type_prop
        assert type_prop["$ref"] == "#/definitions/EventType"

        # Check enum is defined
        assert "definitions" in definition
        assert "EventType" in definition["definitions"]
        assert set(definition["definitions"]["EventType"]["enum"]) == {
            "time-driven",
            "state-change",
            "external",
        }

    def test_generate_entity_with_contains(self, generator, entity_with_contains):
        """Test generation of entity with contains relationships."""
        definition = generator._generate_entity_schema(entity_with_contains)

        # Check services property
        services_prop = definition["properties"]["services"]
        assert services_prop["type"] == "array"
        assert services_prop["items"]["type"] == "string"
        assert services_prop["items"]["format"] == "uuid"
        assert services_prop["minItems"] == 1
        assert "maxItems" not in services_prop  # None means no max
        assert "BusinessService" in services_prop["description"]

        # Check contracts property (min_items=0 means no minItems constraint)
        contracts_prop = definition["properties"]["contracts"]
        assert "minItems" not in contracts_prop  # 0 means optional, so no constraint

    def test_type_mappings(self, generator):
        """Test type mapping from markdown to JSON Schema."""
        assert generator.TYPE_MAPPINGS["string"]["type"] == "string"
        assert generator.TYPE_MAPPINGS["integer"]["type"] == "integer"
        assert generator.TYPE_MAPPINGS["boolean"]["type"] == "boolean"

    def test_generate_relationship_schema(self, generator):
        """Test generation of Relationship definition."""
        relationships = ["Composition", "Aggregation", "Realization"]

        definition = generator._generate_relationship_schema(relationships)

        assert definition["type"] == "object"
        assert set(definition["required"]) == {"id", "type", "source", "target"}

        # Check type enum
        assert definition["properties"]["type"]["type"] == "string"
        assert set(definition["properties"]["type"]["enum"]) == set(relationships)

        # Check source and target are strings (entity IDs)
        assert definition["properties"]["source"]["type"] == "string"
        assert definition["properties"]["target"]["type"] == "string"

        # Check id has uuid format
        assert definition["properties"]["id"]["format"] == "uuid"

    def test_generate_relationship_schema_empty(self, generator):
        """Test generation of Relationship definition with empty types."""
        definition = generator._generate_relationship_schema([])

        # Should have empty enum when no types provided
        assert definition["type"] == "object"
        assert set(definition["required"]) == {"id", "type", "source", "target"}
        assert definition["properties"]["type"]["enum"] == []

    def test_generate_complete_schema(self, generator, layer_spec):
        """Test generation of complete schema."""
        schema = generator.generate_layer_schema(layer_spec)

        # Check all required sections
        assert "$schema" in schema
        assert "$id" in schema
        assert "title" in schema
        assert "type" in schema
        assert "description" in schema
        assert "properties" in schema
        assert "definitions" in schema

        # Check entity is in definitions
        assert "BusinessActor" in schema["definitions"]

        # Check Relationship is in definitions
        assert "Relationship" in schema["definitions"]

    def test_generate_schema_structure(self, generator, layer_spec):
        """Test schema generation structure."""
        schema = generator.generate_layer_schema(layer_spec)

        # Should have all required structure
        assert "$schema" in schema
        assert "definitions" in schema
        assert "properties" in schema
        assert "title" in schema

    def test_generate_attribute_schema_uuid(self, generator):
        """Test generation of UUID attribute property."""
        attr = AttributeSpec(name="id", type="string", format="uuid")

        prop = generator._generate_attribute_schema(attr)

        assert prop["type"] == "string"
        assert prop["format"] == "uuid"

    def test_generate_attribute_schema_with_enum(self, generator, entity_with_enum):
        """Test generation of attribute that references enum."""
        type_attr = entity_with_enum.attributes["type"]

        prop = generator._generate_attribute_schema(type_attr)

        # When an enum_ref is specified, the attribute gets a $ref
        assert "$ref" in prop
        assert prop["$ref"] == "#/definitions/EventType"

    def test_generate_contains_property(self, generator):
        """Test generation of contains property."""
        contains = ContainsSpec(
            name="services", target_type="BusinessService", min_items=1, max_items=10
        )

        prop = generator._generate_contains_property(contains, include_descriptions=True)

        assert prop["type"] == "array"
        assert prop["items"]["type"] == "string"
        assert prop["items"]["format"] == "uuid"
        assert prop["minItems"] == 1
        assert prop["maxItems"] == 10
        assert "BusinessService" in prop["description"]


class TestTypeMappings:
    """Test type mapping functionality."""

    @pytest.fixture
    def generator(self):
        """Create generator instance."""
        return JSONSchemaGenerator()

    def test_string_mapping(self, generator):
        """Test string type mapping."""
        mapping = generator.TYPE_MAPPINGS["string"]
        assert mapping["type"] == "string"

    def test_integer_mapping(self, generator):
        """Test integer type mapping."""
        mapping = generator.TYPE_MAPPINGS["integer"]
        assert mapping["type"] == "integer"

    def test_boolean_mapping(self, generator):
        """Test boolean type mapping."""
        mapping = generator.TYPE_MAPPINGS["boolean"]
        assert mapping["type"] == "boolean"

    def test_number_mapping(self, generator):
        """Test number type mapping."""
        mapping = generator.TYPE_MAPPINGS["number"]
        assert mapping["type"] == "number"
