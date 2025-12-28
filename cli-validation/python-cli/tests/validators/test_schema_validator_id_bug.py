"""
Test for Schema Validator ID Bug (VALIDATOR_BUG_REPORT.md)

Tests that elements with explicit 'id' fields in YAML are not incorrectly
reported as missing the 'id' property during schema validation.
"""

import json

import pytest
import yaml
from documentation_robotics.core.layer import Layer
from documentation_robotics.validators.schema import SchemaValidator


class TestSchemaValidatorIdBug:
    """Tests for the ID validation bug across different layers."""

    @pytest.fixture
    def security_schema(self, tmp_path):
        """Create a minimal security layer schema (full format with properties)."""
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "SecurityPolicy": {
                    "type": "object",
                    "required": ["id", "name", "priority", "target"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "priority": {"type": "integer"},
                        "target": {"type": "string"},
                    },
                }
            },
        }
        schema_path = tmp_path / "security-schema.json"
        with open(schema_path, "w") as f:
            json.dump(schema, f)
        return schema_path

    @pytest.fixture
    def ux_schema(self, tmp_path):
        """Create a minimal UX layer schema."""
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "View": {
                    "type": "object",
                    "required": ["id", "name", "type"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "type": {"type": "string"},
                    },
                }
            },
        }
        schema_path = tmp_path / "ux-schema.json"
        with open(schema_path, "w") as f:
            json.dump(schema, f)
        return schema_path

    @pytest.fixture
    def navigation_schema(self, tmp_path):
        """Create a minimal navigation layer schema."""
        schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "Route": {
                    "type": "object",
                    "required": ["id", "name", "type"],
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "type": {"type": "string"},
                    },
                }
            },
        }
        schema_path = tmp_path / "navigation-schema.json"
        with open(schema_path, "w") as f:
            json.dump(schema, f)
        return schema_path

    def test_security_policy_with_explicit_id_should_pass_validation(
        self, tmp_path, security_schema
    ):
        """
        Test Case 1: Security Policy with explicit 'id' field

        Bug Report Reference: VALIDATOR_BUG_REPORT.md Case 1
        File: documentation-robotics/model/03_security/security-policies.yaml
        Element: security.policy.local-access

        Expected: Validation should PASS (id is present)
        Actual (bug): Validation FAILS claiming id is missing
        """
        # Create YAML file with explicit id (matches bug report structure)
        yaml_content = {
            "local-access": {
                "id": "security.policy.local-access",
                "name": "Local File Access",
                "priority": 1,
                "target": "all",
                "description": "Viewer runs locally and accesses files directly",
            }
        }

        yaml_file = tmp_path / "security-policies.yaml"
        with open(yaml_file, "w") as f:
            yaml.dump(yaml_content, f)

        # Load element using Layer (simulates how validation runs)
        layer_config = {"schema": str(security_schema)}
        layer = Layer(name="security", path=tmp_path, config=layer_config)

        # Get the loaded element
        element = layer.get_element("security.policy.local-access")
        assert element is not None, "Element should be loaded"

        # CRITICAL CHECK: Verify element.data contains 'id'
        print(f"Element ID: {element.id}")
        print(f"Element data keys: {element.data.keys()}")
        print(f"'id' in element.data: {'id' in element.data}")
        print(f"Element data: {element.data}")

        # This is the BUG: element.data might not have 'id' even though YAML has it
        assert "id" in element.data, "BUG DETECTED: 'id' should be in element.data"

        # Validate using schema validator
        validator = SchemaValidator(schema_path=security_schema)
        # BUG: Validator uses the whole schema, not the entity type schema!
        # It should extract the SecurityPolicy schema from properties

        result = validator.validate_element(element, strict=False)

        # Should pass validation (no errors)
        assert result.is_valid(), f"Validation should pass. Errors: {result.errors}"

    def test_ux_view_with_explicit_id_should_pass_validation(self, tmp_path, ux_schema):
        """
        Test Case 2: UX View with explicit 'id' field

        Bug Report Reference: VALIDATOR_BUG_REPORT.md Cases 2-4
        File: documentation-robotics/model/09_ux/views.yaml
        Elements: ux.view.c4-view, ux.view.motivation-view, ux.view.spec-view

        Expected: Validation should PASS (id is present)
        Actual (bug): Validation FAILS claiming id is missing
        """
        # Create YAML file with explicit id (matches bug report structure)
        yaml_content = {
            "c4-view": {
                "id": "ux.view.c4-view",
                "name": "C4 View",
                "type": "custom",
                "description": "Hierarchical view",
            }
        }

        yaml_file = tmp_path / "views.yaml"
        with open(yaml_file, "w") as f:
            yaml.dump(yaml_content, f)

        # Load element using Layer
        layer_config = {"schema": str(ux_schema)}
        layer = Layer(name="ux", path=tmp_path, config=layer_config)

        # Get the loaded element
        element = layer.get_element("ux.view.c4-view")
        assert element is not None, "Element should be loaded"

        # CRITICAL CHECK: Verify element.data contains 'id'
        print(f"Element ID: {element.id}")
        print(f"Element data keys: {element.data.keys()}")
        print(f"'id' in element.data: {'id' in element.data}")

        assert "id" in element.data, "BUG DETECTED: 'id' should be in element.data"

        # Validate using schema validator
        validator = SchemaValidator(schema_path=ux_schema)

        result = validator.validate_element(element, strict=False)

        # Should pass validation (no errors)
        assert result.is_valid(), f"Validation should pass. Errors: {result.errors}"

    def test_navigation_route_with_explicit_id_should_pass_validation(
        self, tmp_path, navigation_schema
    ):
        """
        Test Case 3: Navigation Route with explicit 'id' field

        Bug Report Reference: VALIDATOR_BUG_REPORT.md Cases 5-7
        File: documentation-robotics/model/10_navigation/routes.yaml
        Elements: navigation.route.model, navigation.route.spec, navigation.route.motivation

        Expected: Validation should PASS (id is present)
        Actual (bug): Validation FAILS claiming id is missing
        """
        # Create YAML file with explicit id (matches bug report structure)
        yaml_content = {
            "route-model": {
                "id": "navigation.route.model",
                "name": "Model Route",
                "type": "experience",
                "description": "/model/*",
            }
        }

        yaml_file = tmp_path / "routes.yaml"
        with open(yaml_file, "w") as f:
            yaml.dump(yaml_content, f)

        # Load element using Layer
        layer_config = {"schema": str(navigation_schema)}
        layer = Layer(name="navigation", path=tmp_path, config=layer_config)

        # Get the loaded element
        element = layer.get_element("navigation.route.model")
        assert element is not None, "Element should be loaded"

        # CRITICAL CHECK: Verify element.data contains 'id'
        print(f"Element ID: {element.id}")
        print(f"Element data keys: {element.data.keys()}")
        print(f"'id' in element.data: {'id' in element.data}")

        assert "id" in element.data, "BUG DETECTED: 'id' should be in element.data"

        # Validate using schema validator
        validator = SchemaValidator(schema_path=navigation_schema)

        result = validator.validate_element(element, strict=False)

        # Should pass validation (no errors)
        assert result.is_valid(), f"Validation should pass. Errors: {result.errors}"

    def test_element_without_id_should_fail_validation_correctly(self, tmp_path, security_schema):
        """
        Test that elements genuinely missing 'id' are correctly reported as invalid.

        This ensures our fix doesn't break legitimate validation.
        """
        # Create YAML file WITHOUT id field (intentionally broken)
        yaml_content = {
            "broken-policy": {
                "name": "Broken Policy",
                "priority": 1,
                "target": "all",
                # NO 'id' field - this should fail validation
            }
        }

        yaml_file = tmp_path / "security-policies.yaml"
        with open(yaml_file, "w") as f:
            yaml.dump(yaml_content, f)

        # Load element using Layer
        layer_config = {"schema": str(security_schema)}
        layer = Layer(name="security", path=tmp_path, config=layer_config)

        # Get the loaded element (will have inferred id from key)
        elements = list(layer.elements.values())
        assert len(elements) == 1
        element = elements[0]

        # Element will have inferred ID but data won't have it
        print(f"Element ID: {element.id}")
        print(f"Element data: {element.data}")
        print(f"'id' in element.data: {'id' in element.data}")

        # Validate using schema validator
        validator = SchemaValidator(schema_path=security_schema)
        with open(security_schema) as f:
            schema_def = json.load(f)
        validator.schema = schema_def["properties"]["SecurityPolicy"]

        result = validator.validate_element(element, strict=False)

        # Should FAIL validation (missing id in data)
        assert not result.is_valid(), "Validation should fail for element without id in YAML"
        assert any(
            "id" in str(error).lower() for error in result.errors
        ), "Error message should mention missing 'id' property"
