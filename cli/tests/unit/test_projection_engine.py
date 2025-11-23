"""Unit tests for ProjectionEngine."""

import pytest
from documentation_robotics.core.element import Element
from documentation_robotics.core.projection_engine import ProjectionEngine, ProjectionRule


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
