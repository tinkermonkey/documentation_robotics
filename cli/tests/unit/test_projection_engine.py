"""Unit tests for ProjectionEngine."""

import pytest
from documentation_robotics.core.element import Element
from documentation_robotics.core.projection_engine import (
    ProjectionCondition,
    ProjectionEngine,
    ProjectionRule,
    PropertyMapping,
    PropertyTransform,
)


class TestProjectionRule:
    """Tests for ProjectionRule dataclass."""

    def test_rule_creation(self):
        """Test creating a projection rule."""
        rule = ProjectionRule(
            name="test-rule",
            from_layer="business",
            from_type="service",
            to_layer="application",
            to_type="service",
            name_template="{source.name}Service",
            property_mappings={"realizes": "{source.id}"},
        )

        assert rule.name == "test-rule"
        assert rule.from_layer == "business"
        assert rule.to_layer == "application"
        assert rule.name_template == "{source.name}Service"


class TestProjectionEngine:
    """Tests for ProjectionEngine."""

    @pytest.fixture
    def mock_model(self, initialized_model):
        """Create a mock model for testing."""
        return initialized_model

    @pytest.fixture
    def simple_rule(self):
        """Create a simple projection rule."""
        return ProjectionRule(
            name="business-to-app",
            from_layer="business",
            from_type="service",
            to_layer="application",
            to_type="service",
            name_template="{source.name}",
            property_mappings={"realizes": "{source.id}", "description": "Realizes {source.name}"},
        )

    def test_engine_creation(self, mock_model):
        """Test creating a projection engine."""
        engine = ProjectionEngine(mock_model)

        assert engine.model == mock_model
        assert len(engine.rules) == 0

    def test_engine_with_rules_file(self, mock_model, temp_dir):
        """Test creating engine with rules file."""
        rules_file = temp_dir / "test-projection-rules.yaml"
        rules_file.write_text(
            """
projections:
  - name: "test-rule"
    from: business.service
    to: application.service
    rules:
      - create_type: service
        name_template: "{source.name}"
        properties:
          realizes: "{source.id}"
"""
        )

        engine = ProjectionEngine(mock_model, rules_file)

        assert len(engine.rules) == 1
        assert engine.rules[0].name == "test-rule"

    def test_find_applicable_rules(self, mock_model, simple_rule):
        """Test finding applicable rules."""
        engine = ProjectionEngine(mock_model)
        engine.rules.append(simple_rule)

        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )

        rules = engine.find_applicable_rules(element, "application")

        assert len(rules) == 1
        assert rules[0].name == "business-to-app"

    def test_find_applicable_rules_no_match(self, mock_model, simple_rule):
        """Test finding rules with no match."""
        engine = ProjectionEngine(mock_model)
        engine.rules.append(simple_rule)

        # Wrong layer
        element = Element(
            id="technology.node.test",
            element_type="node",
            layer="technology",
            data={"name": "Test Node"},
        )

        rules = engine.find_applicable_rules(element, "application")

        assert len(rules) == 0

    def test_render_template_simple(self, mock_model):
        """Test rendering simple template."""
        engine = ProjectionEngine(mock_model)

        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Customer Management", "description": "Manages customers"},
        )

        result = engine._render_template("{source.name}", element)
        assert result == "Customer Management"

        result = engine._render_template("{source.description}", element)
        assert result == "Manages customers"

    def test_render_template_with_transformations(self, mock_model):
        """Test rendering template with case transformations."""
        engine = ProjectionEngine(mock_model)

        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Customer Management"},
        )

        # Kebab case
        result = engine._render_template("{source.name_kebab}", element)
        assert result == "customer-management"

        # Pascal case
        result = engine._render_template("{source.name_pascal}", element)
        assert result == "CustomerManagement"

        # Snake case
        result = engine._render_template("{source.name_snake}", element)
        assert result == "customer_management"

    def test_render_template_jinja2(self, mock_model):
        """Test rendering Jinja2 template."""
        engine = ProjectionEngine(mock_model)

        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Customer"},
        )

        result = engine._render_template("{{source.name}}Service", element)
        assert result == "CustomerService"

    def test_build_projected_element(self, mock_model, simple_rule):
        """Test building a projected element."""
        engine = ProjectionEngine(mock_model)

        source = Element(
            id="business.service.customer-mgmt",
            element_type="service",
            layer="business",
            data={"name": "Customer Management", "description": "Manages customers"},
        )

        projected = engine._build_projected_element(source, simple_rule)

        assert projected.layer == "application"
        assert projected.type == "service"
        assert projected.name == "Customer Management"
        assert projected.data.get("realizes") == "business.service.customer-mgmt"

    def test_project_element_dry_run(self, mock_model, simple_rule):
        """Test projecting element in dry-run mode."""
        engine = ProjectionEngine(mock_model)
        engine.rules.append(simple_rule)

        source = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"name": "Test Service"},
        )

        # Add source to model first
        mock_model.add_element("business", source)

        projected = engine.project_element(source, "application", dry_run=True)

        assert projected is not None
        assert projected.layer == "application"

        # Verify it wasn't actually added to model
        assert mock_model.get_element(projected.id) is None

    def test_check_conditions_match(self, mock_model):
        """Test condition checking with match."""
        engine = ProjectionEngine(mock_model)

        element = Element(
            id="test.element.1",
            element_type="test",
            layer="test",
            data={"status": "active", "type": "primary"},
        )

        conditions = {"status": "active"}
        assert engine._check_conditions(element, conditions) is True

    def test_check_conditions_no_match(self, mock_model):
        """Test condition checking with no match."""
        engine = ProjectionEngine(mock_model)

        element = Element(
            id="test.element.1", element_type="test", layer="test", data={"status": "inactive"}
        )

        conditions = {"status": "active"}
        assert engine._check_conditions(element, conditions) is False

    def test_check_conditions_list(self, mock_model):
        """Test condition checking with list."""
        engine = ProjectionEngine(mock_model)

        element = Element(
            id="test.element.1", element_type="test", layer="test", data={"status": "active"}
        )

        conditions = {"status": ["active", "pending"]}
        assert engine._check_conditions(element, conditions) is True

        conditions = {"status": ["inactive", "pending"]}
        assert engine._check_conditions(element, conditions) is False

    def test_set_nested_property(self, mock_model):
        """Test setting nested properties."""
        engine = ProjectionEngine(mock_model)

        data = {}
        engine._set_nested_property(data, "simple", "value")
        assert data["simple"] == "value"

        engine._set_nested_property(data, "nested.property", "nested_value")
        assert data["nested"]["property"] == "nested_value"

        engine._set_nested_property(data, "deep.nested.property", "deep_value")
        assert data["deep"]["nested"]["property"] == "deep_value"

    def test_parse_rule(self, mock_model):
        """Test parsing rule from YAML data."""
        engine = ProjectionEngine(mock_model)

        rule_data = {
            "name": "test-rule",
            "from": "business.service",
            "to": "application.service",
            "rules": [
                {
                    "create_type": "service",
                    "name_template": "{source.name}",
                    "properties": {"realizes": "{source.id}"},
                }
            ],
        }

        rule = engine._parse_rule(rule_data)

        assert rule.name == "test-rule"
        assert rule.from_layer == "business"
        assert rule.from_type == "service"
        assert rule.to_layer == "application"
        assert rule.to_type == "service"

    def test_to_pascal_case(self, mock_model):
        """Test PascalCase conversion."""
        engine = ProjectionEngine(mock_model)

        assert engine._to_pascal_case("customer management") == "CustomerManagement"
        assert engine._to_pascal_case("order-processing") == "OrderProcessing"
        assert engine._to_pascal_case("api_gateway") == "ApiGateway"

    def test_to_snake_case(self, mock_model):
        """Test snake_case conversion."""
        engine = ProjectionEngine(mock_model)

        assert engine._to_snake_case("Customer Management") == "customer_management"
        assert engine._to_snake_case("OrderProcessing") == "order_processing"


class TestProjectionCondition:
    """Tests for enhanced projection conditions."""

    def test_exists_operator(self):
        """Test exists operator."""
        condition = ProjectionCondition(field="properties.criticality", operator="exists")

        element_with_field = Element(
            id="test.element.1",
            element_type="service",
            layer="application",
            data={"properties": {"criticality": "high"}},
        )

        element_without_field = Element(
            id="test.element.2",
            element_type="service",
            layer="application",
            data={"properties": {}},
        )

        assert condition.evaluate(element_with_field) is True
        assert condition.evaluate(element_without_field) is False

    def test_equals_operator(self):
        """Test equals operator."""
        condition = ProjectionCondition(
            field="properties.criticality", operator="equals", value="high"
        )

        element_match = Element(
            id="test.element.1",
            element_type="service",
            layer="application",
            data={"properties": {"criticality": "high"}},
        )

        element_no_match = Element(
            id="test.element.2",
            element_type="service",
            layer="application",
            data={"properties": {"criticality": "low"}},
        )

        assert condition.evaluate(element_match) is True
        assert condition.evaluate(element_no_match) is False

    def test_not_equals_operator(self):
        """Test not_equals operator."""
        condition = ProjectionCondition(field="status", operator="not_equals", value="inactive")

        element_match = Element(
            id="test.element.1",
            element_type="service",
            layer="application",
            data={"status": "active"},
        )

        element_no_match = Element(
            id="test.element.2",
            element_type="service",
            layer="application",
            data={"status": "inactive"},
        )

        assert condition.evaluate(element_match) is True
        assert condition.evaluate(element_no_match) is False

    def test_contains_operator(self):
        """Test contains operator."""
        condition = ProjectionCondition(
            field="description", operator="contains", value="processing"
        )

        element_match = Element(
            id="test.element.1",
            element_type="service",
            layer="business",
            data={"description": "Payment processing service"},
        )

        element_no_match = Element(
            id="test.element.2",
            element_type="service",
            layer="business",
            data={"description": "User authentication"},
        )

        assert condition.evaluate(element_match) is True
        assert condition.evaluate(element_no_match) is False

    def test_matches_operator(self):
        """Test matches operator with regex."""
        condition = ProjectionCondition(
            field="name", operator="matches", pattern=r"^Payment.*Service$"
        )

        element_match = Element(
            id="test.element.1",
            element_type="service",
            layer="application",
            data={"name": "Payment Processing Service"},
        )

        element_no_match = Element(
            id="test.element.2",
            element_type="service",
            layer="application",
            data={"name": "User Service"},
        )

        assert condition.evaluate(element_match) is True
        assert condition.evaluate(element_no_match) is False

    def test_gt_operator(self):
        """Test greater than operator."""
        condition = ProjectionCondition(field="properties.priority", operator="gt", value=5)

        element_match = Element(
            id="test.element.1",
            element_type="goal",
            layer="motivation",
            data={"properties": {"priority": 10}},
        )

        element_no_match = Element(
            id="test.element.2",
            element_type="goal",
            layer="motivation",
            data={"properties": {"priority": 3}},
        )

        assert condition.evaluate(element_match) is True
        assert condition.evaluate(element_no_match) is False

    def test_lt_operator(self):
        """Test less than operator."""
        condition = ProjectionCondition(field="properties.cost", operator="lt", value=1000)

        element_match = Element(
            id="test.element.1",
            element_type="service",
            layer="application",
            data={"properties": {"cost": 500}},
        )

        element_no_match = Element(
            id="test.element.2",
            element_type="service",
            layer="application",
            data={"properties": {"cost": 1500}},
        )

        assert condition.evaluate(element_match) is True
        assert condition.evaluate(element_no_match) is False

    def test_nested_property_access(self):
        """Test nested property access with dot notation."""
        condition = ProjectionCondition(
            field="properties.security.level", operator="equals", value="high"
        )

        element = Element(
            id="test.element.1",
            element_type="service",
            layer="application",
            data={"properties": {"security": {"level": "high"}}},
        )

        assert condition.evaluate(element) is True


class TestPropertyTransform:
    """Tests for property transformations."""

    def test_uppercase_transform(self):
        """Test uppercase transformation."""
        transform = PropertyTransform(type="uppercase")
        assert transform.apply("hello") == "HELLO"
        assert transform.apply("Hello World") == "HELLO WORLD"

    def test_lowercase_transform(self):
        """Test lowercase transformation."""
        transform = PropertyTransform(type="lowercase")
        assert transform.apply("HELLO") == "hello"
        assert transform.apply("Hello World") == "hello world"

    def test_kebab_transform(self):
        """Test kebab-case transformation."""
        transform = PropertyTransform(type="kebab")
        assert transform.apply("Hello World") == "hello-world"
        assert transform.apply("hello_world") == "hello-world"
        assert transform.apply("helloWorld") == "helloworld"

    def test_snake_transform(self):
        """Test snake_case transformation."""
        transform = PropertyTransform(type="snake")
        assert transform.apply("Hello World") == "hello_world"
        assert transform.apply("hello-world") == "hello_world"
        assert transform.apply("helloWorld") == "helloworld"

    def test_pascal_transform(self):
        """Test PascalCase transformation."""
        transform = PropertyTransform(type="pascal")
        assert transform.apply("hello world") == "HelloWorld"
        assert transform.apply("hello-world") == "HelloWorld"
        assert transform.apply("hello_world") == "HelloWorld"

    def test_prefix_transform(self):
        """Test prefix transformation."""
        transform = PropertyTransform(type="prefix", value="API_")
        assert transform.apply("endpoint") == "API_endpoint"
        assert transform.apply("service") == "API_service"

    def test_suffix_transform(self):
        """Test suffix transformation."""
        transform = PropertyTransform(type="suffix", value="_Service")
        assert transform.apply("User") == "User_Service"
        assert transform.apply("Payment") == "Payment_Service"

    def test_template_transform(self):
        """Test template transformation."""
        transform = PropertyTransform(type="template", value="v1/{value}")
        assert transform.apply("users") == "v1/users"
        assert transform.apply("products") == "v1/products"

    def test_none_value_handling(self):
        """Test transformation with None value."""
        transform = PropertyTransform(type="uppercase")
        assert transform.apply(None) is None


class TestPropertyMapping:
    """Tests for property mapping."""

    def test_simple_mapping(self):
        """Test simple property mapping without transform."""
        mapping = PropertyMapping(source="name", target="title")
        assert mapping.source == "name"
        assert mapping.target == "title"
        assert mapping.default is None
        assert mapping.required is False
        assert mapping.transform is None

    def test_mapping_with_default(self):
        """Test mapping with default value."""
        mapping = PropertyMapping(source="runtime", target="properties.runtime", default="java")
        assert mapping.default == "java"

    def test_mapping_with_transform(self):
        """Test mapping with transformation."""
        transform = PropertyTransform(type="snake")
        mapping = PropertyMapping(source="name", target="service_name", transform=transform)
        assert mapping.transform.type == "snake"

    def test_required_mapping(self):
        """Test required mapping."""
        mapping = PropertyMapping(source="id", target="element_id", required=True)
        assert mapping.required is True

    def test_complex_mapping(self):
        """Test complex mapping with all options."""
        transform = PropertyTransform(type="uppercase")
        mapping = PropertyMapping(
            source="properties.status",
            target="metadata.current_status",
            default="PENDING",
            required=True,
            transform=transform,
        )

        assert mapping.source == "properties.status"
        assert mapping.target == "metadata.current_status"
        assert mapping.default == "PENDING"
        assert mapping.required is True
        assert mapping.transform.type == "uppercase"


class TestEnhancedProjectionEngine:
    """Integration tests for enhanced projection features."""

    @pytest.fixture
    def engine_with_enhanced_rule(self, initialized_model):
        """Create engine with enhanced projection rule."""
        engine = ProjectionEngine(initialized_model)

        # Create enhanced rule with conditions and transforms
        rule = ProjectionRule(
            name="enhanced-projection",
            from_layer="business",
            from_type="service",
            to_layer="application",
            to_type="service",
            name_template="{source.name_pascal}Service",
            property_mappings=[
                PropertyMapping(
                    source="name", target="name", transform=PropertyTransform(type="pascal")
                ),
                PropertyMapping(
                    source="properties.runtime",
                    target="properties.runtime",
                    default="java-spring-boot",
                    transform=PropertyTransform(type="lowercase"),
                ),
                PropertyMapping(source="id", target="properties.realizes", required=True),
            ],
            conditions=[
                ProjectionCondition(
                    field="properties.criticality", operator="equals", value="critical"
                )
            ],
            create_bidirectional=True,
        )

        engine.rules.append(rule)
        return engine

    def test_projection_with_conditions(self, initialized_model, engine_with_enhanced_rule):
        """Test projection with conditions filtering."""
        # Critical element - should be projected
        critical_element = Element(
            id="business.service.payment",
            element_type="service",
            layer="business",
            data={"name": "Payment Processing", "properties": {"criticality": "critical"}},
        )

        # Non-critical element - should not be projected
        normal_element = Element(
            id="business.service.user",
            element_type="service",
            layer="business",
            data={"name": "User Service", "properties": {"criticality": "normal"}},
        )

        initialized_model.add_element("business", critical_element)
        initialized_model.add_element("business", normal_element)

        # Only critical element should have applicable rules
        critical_rules = engine_with_enhanced_rule.find_applicable_rules(
            critical_element, "application"
        )
        normal_rules = engine_with_enhanced_rule.find_applicable_rules(
            normal_element, "application"
        )

        assert len(critical_rules) == 1
        assert len(normal_rules) == 0

    def test_projection_with_transforms(self, initialized_model, engine_with_enhanced_rule):
        """Test projection with property transformations."""
        source = Element(
            id="business.service.payment",
            element_type="service",
            layer="business",
            data={
                "name": "payment processing",
                "properties": {"criticality": "critical", "runtime": "JAVA"},
            },
        )

        initialized_model.add_element("business", source)

        projected = engine_with_enhanced_rule.project_element(source, "application", dry_run=True)

        # Check transformations were applied
        assert projected.name == "PaymentProcessing"  # Pascal case transform
        assert projected.data["properties"]["runtime"] == "java"  # Lowercase transform

    def test_projection_with_default_values(self, initialized_model, engine_with_enhanced_rule):
        """Test projection uses default values when property missing."""
        source = Element(
            id="business.service.payment",
            element_type="service",
            layer="business",
            data={
                "name": "Payment Processing",
                "properties": {
                    "criticality": "critical"
                    # Note: no runtime property
                },
            },
        )

        initialized_model.add_element("business", source)

        projected = engine_with_enhanced_rule.project_element(source, "application", dry_run=True)

        # Check default was applied and transformed
        assert projected.data["properties"]["runtime"] == "java-spring-boot"

    def test_bidirectional_relationship_creation(
        self, initialized_model, engine_with_enhanced_rule
    ):
        """Test bidirectional relationship is created."""
        source = Element(
            id="business.service.payment",
            element_type="service",
            layer="business",
            data={"name": "Payment Processing", "properties": {"criticality": "critical"}},
        )

        initialized_model.add_element("business", source)

        projected = engine_with_enhanced_rule.project_element(source, "application", dry_run=True)

        # Check "realizes" relationship was created
        assert "realizes" in projected.data.get("properties", {})
        assert projected.data["properties"]["realizes"] == source.id

    def test_nested_property_operations(self, initialized_model):
        """Test nested property get and set operations."""
        engine = ProjectionEngine(initialized_model)

        # Test setting nested properties
        data = {}
        engine._set_nested_property(data, "properties.security.level", "high")
        assert data == {"properties": {"security": {"level": "high"}}}

        # Test getting nested properties
        value = engine._get_nested_property(data, "properties.security.level")
        assert value == "high"

        # Test getting non-existent nested property
        value = engine._get_nested_property(data, "properties.missing.path")
        assert value is None
