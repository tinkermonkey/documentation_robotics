"""
Pytest tests for schema completeness validation.

These tests ensure the CLI implementation matches spec schemas 100%.
"""

import pytest
from documentation_robotics.schemas.bundler import get_bundled_schemas_dir
from documentation_robotics.schemas.registry import EntityTypeRegistry

from .schema_completeness_validator import SchemaCompletenessValidator, ValidationStatus


class TestSchemaCompleteness:
    """Test suite ensuring CLI matches spec schemas."""

    @pytest.fixture
    def validator(self):
        """Create validator instance."""
        return SchemaCompletenessValidator()

    def test_all_11_layers_present(self, validator):
        """Test that all 11 expected layers are in registry."""
        expected_layers = {
            "motivation",
            "business",
            "security",
            "application",
            "technology",
            "api",
            "data_model",
            "datastore",
            "ux",
            "navigation",
            "apm_observability",
        }

        validator.validate_all()
        actual_layers = set(validator.layer_validations.keys())

        assert actual_layers == expected_layers, (
            f"Missing layers: {expected_layers - actual_layers}, "
            f"Extra layers: {actual_layers - expected_layers}"
        )

    def test_no_validation_failures(self, validator):
        """Test that validation has zero failures."""
        validator.validate_all()

        failed_results = [r for r in validator.all_results if r.status == ValidationStatus.FAIL]

        if failed_results:
            failures = "\n".join(
                [f"  - {r.layer}/{r.category}/{r.check}: {r.message}" for r in failed_results]
            )
            pytest.fail(f"Validation failures found:\n{failures}")

    def test_entity_types_match_schema_for_all_layers(self, validator):
        """Test that entity types match schema for every layer."""
        validator.validate_all()

        mismatches = []
        for layer_name, validation in validator.layer_validations.items():
            if validation.entity_types_in_schema != validation.entity_types_in_cli:
                mismatches.append(
                    {
                        "layer": layer_name,
                        "missing_in_cli": validation.missing_in_cli,
                        "extra_in_cli": validation.extra_in_cli,
                        "schema_types": validation.entity_types_in_schema,
                        "cli_types": validation.entity_types_in_cli,
                    }
                )

        if mismatches:
            details = "\n".join(
                [
                    f"  Layer: {m['layer']}\n"
                    f"    Missing in CLI: {m['missing_in_cli']}\n"
                    f"    Extra in CLI: {m['extra_in_cli']}"
                    for m in mismatches
                ]
            )
            pytest.fail(f"Entity type mismatches found:\n{details}")

    def test_business_layer_has_13_entity_types(self, validator):
        """Test business layer has exactly 13 entity types from ArchiMate."""
        validator.validate_all()

        business = validator.layer_validations.get("business")
        assert business is not None, "Business layer not found"

        expected_count = 13
        actual_count = len(business.entity_types_in_cli)

        assert actual_count == expected_count, (
            f"Business layer should have {expected_count} entity types, "
            f"found {actual_count}: {sorted(business.entity_types_in_cli)}"
        )

    def test_api_layer_has_special_types(self, validator):
        """Test API layer has special entity types."""
        validator.validate_all()

        api = validator.layer_validations.get("api")
        assert api is not None, "API layer not found"

        expected_types = {"operation", "path", "schema"}
        actual_types = api.entity_types_in_cli

        assert expected_types.issubset(actual_types), (
            f"API layer missing expected types. "
            f"Expected: {expected_types}, Found: {actual_types}"
        )

    def test_data_model_layer_has_special_types(self, validator):
        """Test data_model layer has special entity types."""
        validator.validate_all()

        data_model = validator.layer_validations.get("data_model")
        assert data_model is not None, "data_model layer not found"

        expected_types = {"schema", "entity", "attribute", "relationship"}
        actual_types = data_model.entity_types_in_cli

        assert expected_types == actual_types, (
            f"data_model layer types don't match. "
            f"Expected: {expected_types}, Found: {actual_types}"
        )

    def test_security_layer_comprehensive_coverage(self, validator):
        """Test security layer has comprehensive STS-ml coverage."""
        validator.validate_all()

        security = validator.layer_validations.get("security")
        assert security is not None, "Security layer not found"

        # Security should have at least 10 entity types from STS-ml
        min_types = 10
        actual_count = len(security.entity_types_in_cli)

        assert actual_count >= min_types, (
            f"Security layer should have at least {min_types} entity types, "
            f"found {actual_count}"
        )

    def test_all_layers_pass_above_90_percent(self, validator):
        """Test that all layers have >90% pass rate (or >85% for minimal layers)."""
        validator.validate_all()

        low_scoring_layers = [
            (name, val.pass_rate)
            for name, val in validator.layer_validations.items()
            # Allow 85% for datastore which has minimal properties
            if val.pass_rate < (85.0 if name == "datastore" else 90.0)
        ]

        if low_scoring_layers:
            details = "\n".join([f"  - {name}: {rate:.1f}%" for name, rate in low_scoring_layers])
            pytest.fail(f"Layers with low pass rate:\n{details}")

    def test_all_schemas_have_required_structure(self, validator):
        """Test that all schemas have required JSON Schema structure."""
        validator.validate_all()

        missing_structure = []
        for layer_name, validation in validator.layer_validations.items():
            # Check for schema structure failures
            structure_results = [
                r
                for r in validation.results
                if r.category == "Schema Structure" and r.status == ValidationStatus.FAIL
            ]

            if structure_results:
                missing_structure.append(
                    {"layer": layer_name, "issues": [r.check for r in structure_results]}
                )

        if missing_structure:
            details = "\n".join(
                [
                    f"  Layer: {m['layer']}\n    Missing: {', '.join(m['issues'])}"
                    for m in missing_structure
                ]
            )
            pytest.fail(f"Schema structure issues found:\n{details}")

    def test_registry_coverage_matches_validator(self, validator):
        """Test that EntityTypeRegistry matches validator findings."""
        validator.validate_all()
        registry = EntityTypeRegistry()
        registry.build_from_schemas(get_bundled_schemas_dir())

        for layer_name in validator.layer_validations.keys():
            validator_types = validator.layer_validations[layer_name].entity_types_in_cli
            registry_types = set(registry.get_valid_types(layer_name))

            assert validator_types == registry_types, (
                f"Mismatch for layer '{layer_name}': "
                f"Validator: {validator_types}, Registry: {registry_types}"
            )

    def test_validation_report_generation(self, validator, tmp_path):
        """Test that validation report can be generated."""
        validator.validate_all()

        report_file = tmp_path / "test_report.md"
        report = validator.generate_report(report_file)

        assert report_file.exists(), "Report file was not created"
        assert len(report) > 0, "Report is empty"
        assert "Schema Completeness Validation Report" in report
        assert "Overall Pass Rate" in report

        # Check all layers are in report
        for layer_name in validator.layer_validations.keys():
            assert layer_name in report or layer_name.replace("_", " ").title() in report


class TestEntityTypeRegistry:
    """Tests for EntityTypeRegistry completeness."""

    @pytest.fixture
    def registry(self):
        """Create registry instance."""
        registry = EntityTypeRegistry()
        registry.build_from_schemas(get_bundled_schemas_dir())
        return registry

    def test_registry_has_all_layers(self, registry):
        """Test registry contains all 11 layers."""
        layers = registry.get_all_layers()

        assert len(layers) == 11, f"Expected 11 layers, found {len(layers)}: {layers}"

    def test_all_layers_have_entity_types(self, registry):
        """Test that every layer has at least one entity type."""
        empty_layers = []

        for layer in registry.get_all_layers():
            types = registry.get_valid_types(layer)
            if not types:
                empty_layers.append(layer)

        assert not empty_layers, f"Layers with no entity types: {empty_layers}"

    def test_validation_works_for_all_entity_types(self, registry):
        """Test that is_valid_type works for all registered types."""
        for layer in registry.get_all_layers():
            types = registry.get_valid_types(layer)

            for entity_type in types:
                assert registry.is_valid_type(
                    layer, entity_type
                ), f"is_valid_type failed for {layer}/{entity_type}"

                # Test case insensitivity
                assert registry.is_valid_type(
                    layer, entity_type.upper()
                ), f"is_valid_type not case-insensitive for {layer}/{entity_type}"
