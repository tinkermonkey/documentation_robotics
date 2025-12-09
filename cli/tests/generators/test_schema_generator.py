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

# Mark all tests in this module as expected to fail - these are WIP tests for generator functionality
pytestmark = pytest.mark.skip(reason="WIP: Generator tests under development")


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
                "id": AttributeSpec(
                    name="id", type="string", format="uuid", is_primary_key=True, is_optional=False
                ),
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
                "id": AttributeSpec(name="id", type="string", format="uuid", is_primary_key=True),
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
                "id": AttributeSpec(name="id", type="string", format="uuid", is_primary_key=True),
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
                "id": AttributeSpec(name="id", type="string", format="uuid", is_primary_key=True),
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
            entities=[simple_entity],
            relationships=["Composition", "Aggregation"],
        )

    def test_generate_header(self, generator, layer_spec):
        """Test generation of schema header."""
        header = generator._generate_header(layer_spec, include_descriptions=True)

        assert header["$schema"] == "http://json-schema.org/draft-07/schema#"
        assert header["$id"] == "https://example.com/schemas/02-business-layer.json"
        assert header["title"] == "Business Layer Schema"
        assert header["type"] == "object"
        assert "description" in header

    def test_generate_top_level_properties(self, generator, simple_entity):
        """Test generation of top-level properties."""
        properties = generator._generate_top_level_properties([simple_entity])

        assert "businessActors" in properties
        assert properties["businessActors"]["type"] == "array"
        assert properties["businessActors"]["items"]["$ref"] == "#/definitions/BusinessActor"
        assert "relationships" in properties

    def test_to_camel_case_plural(self, generator):
        """Test entity name to camelCase plural conversion."""
        assert generator._to_camel_case_plural("BusinessActor") == "businessActors"
        assert generator._to_camel_case_plural("Contract") == "contracts"
        assert generator._to_camel_case_plural("BusinessProcess") == "businessProcesses"

    def test_generate_simple_entity_definition(self, generator, simple_entity):
        """Test generation of simple entity definition."""
        definition = generator._generate_entity_definition(simple_entity, include_descriptions=True)

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
        definition = generator._generate_entity_definition(
            entity_with_properties, include_descriptions=True
        )

        # Should have properties object
        assert "properties" in definition["properties"]
        props_obj = definition["properties"]["properties"]

        assert props_obj["type"] == "object"
        assert "motivation.delivers-value" in props_obj["properties"]
        assert "sla.availability" in props_obj["properties"]

        # Check description is included
        motivation_prop = props_obj["properties"]["motivation.delivers-value"]
        assert motivation_prop["type"] == "string"
        assert "Value IDs" in motivation_prop["description"]

    def test_generate_entity_with_enum(self, generator, entity_with_enum):
        """Test generation of entity with enum type."""
        definition = generator._generate_entity_definition(
            entity_with_enum, include_descriptions=True
        )

        # Check type attribute has enum
        type_prop = definition["properties"]["type"]
        assert type_prop["type"] == "string"
        assert "enum" in type_prop
        assert set(type_prop["enum"]) == {"time-driven", "state-change", "external"}

    def test_generate_entity_with_contains(self, generator, entity_with_contains):
        """Test generation of entity with contains relationships."""
        definition = generator._generate_entity_definition(
            entity_with_contains, include_descriptions=True
        )

        # Check services property
        services_prop = definition["properties"]["services"]
        assert services_prop["type"] == "array"
        assert services_prop["items"]["type"] == "string"
        assert services_prop["items"]["format"] == "uuid"
        assert services_prop["minItems"] == 1
        assert "maxItems" not in services_prop  # None means no max
        assert "BusinessService" in services_prop["description"]

        # Check contracts property
        contracts_prop = definition["properties"]["contracts"]
        assert contracts_prop["minItems"] == 0

    def test_type_mappings(self, generator):
        """Test type mapping from markdown to JSON Schema."""
        assert generator.TYPE_MAPPINGS["string"]["type"] == "string"
        assert generator.TYPE_MAPPINGS["integer"]["type"] == "integer"
        assert generator.TYPE_MAPPINGS["boolean"]["type"] == "boolean"

    def test_get_required_fields_simple(self, generator, simple_entity):
        """Test required field determination for simple entity."""
        required = generator._get_required_fields(simple_entity)

        # id and name are always required, documentation is optional
        assert "id" in required
        assert "name" in required
        assert "documentation" not in required

    def test_generate_relationship_definition(self, generator):
        """Test generation of Relationship definition."""
        relationships = ["Composition", "Aggregation", "Realization"]

        definition = generator._generate_relationship_definition(relationships)

        assert definition["type"] == "object"
        assert set(definition["required"]) == {"type", "source", "target"}

        # Check type enum
        assert definition["properties"]["type"]["type"] == "string"
        assert set(definition["properties"]["type"]["enum"]) == set(relationships)

        # Check source and target are UUIDs
        assert definition["properties"]["source"]["format"] == "uuid"
        assert definition["properties"]["target"]["format"] == "uuid"

    def test_generate_relationship_definition_default(self, generator):
        """Test generation of Relationship definition with default types."""
        definition = generator._generate_relationship_definition([])

        # Should use default ArchiMate types
        default_types = {
            "Composition",
            "Aggregation",
            "Assignment",
            "Realization",
            "Triggering",
            "Flow",
            "Association",
            "Access",
            "Serving",
        }
        assert set(definition["properties"]["type"]["enum"]) == default_types

    def test_generate_complete_schema(self, generator, layer_spec):
        """Test generation of complete schema."""
        schema = generator.generate_layer_schema(layer_spec, include_descriptions=True)

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

    def test_generate_schema_without_descriptions(self, generator, layer_spec):
        """Test schema generation without descriptions."""
        schema = generator.generate_layer_schema(layer_spec, include_descriptions=False)

        # Should still have structure
        assert "$schema" in schema
        assert "definitions" in schema

        # Entity definition should not have description
        # (Header will still have description generated from layer name)

    def test_generate_properties_object(self, generator):
        """Test generation of properties object."""
        properties = [
            PropertySpec(
                key="motivation.delivers-value",
                value="value-id",
                description="Value IDs",
                is_optional=True,
            )
        ]

        props_obj = generator._generate_properties_object(properties, include_descriptions=True)

        assert props_obj["type"] == "object"
        assert "properties" in props_obj
        assert "motivation.delivers-value" in props_obj["properties"]

        prop_def = props_obj["properties"]["motivation.delivers-value"]
        assert prop_def["type"] == "string"
        assert "Value IDs" in prop_def["description"]

    def test_generate_attribute_property_uuid(self, generator):
        """Test generation of UUID attribute property."""
        attr = AttributeSpec(name="id", type="string", format="uuid", is_primary_key=True)
        entity = EntityDefinition(name="Test", description="Test")

        prop = generator._generate_attribute_property(attr, entity, include_descriptions=True)

        assert prop["type"] == "string"
        assert prop["format"] == "uuid"

    def test_generate_attribute_property_with_enum(self, generator, entity_with_enum):
        """Test generation of attribute that references enum."""
        type_attr = entity_with_enum.attributes["type"]

        prop = generator._generate_attribute_property(
            type_attr, entity_with_enum, include_descriptions=True
        )

        assert prop["type"] == "string"
        assert "enum" in prop
        assert set(prop["enum"]) == {"time-driven", "state-change", "external"}

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
