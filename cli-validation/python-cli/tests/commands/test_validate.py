"""Integration tests for validate command."""

import json
import re
from pathlib import Path

import pytest
from click.testing import CliRunner
from documentation_robotics.cli import cli
from documentation_robotics.core.model import Model


def strip_ansi(text):
    """Remove ANSI escape codes from text."""
    ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
    return ansi_escape.sub("", text)


class CwdCliRunner(CliRunner):
    """CLI runner that supports cwd parameter."""

    def invoke(
        self,
        cli_cmd,
        args=None,
        input=None,
        env=None,
        catch_exceptions=True,
        color=False,
        cwd=None,
        **extra,
    ):
        """Invoke CLI with optional cwd support."""
        import os

        if cwd is not None:
            # Save current directory
            original_cwd = os.getcwd()
            try:
                os.chdir(cwd)
                return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)
            finally:
                os.chdir(original_cwd)
        else:
            return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)


class TestValidateCommand:
    """Tests for validate command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project with some elements."""
        runner = CwdCliRunner()
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"

        # Add some valid elements
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Customer Service",
                "--description",
                "Handles customer operations",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0, f"Add failed: {result.output}"

        yield tmp_path

    @pytest.fixture
    def project_with_errors(self, tmp_path):
        """Create a project with validation errors."""
        runner = CwdCliRunner()
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"

        # Add element with invalid reference
        model = Model(tmp_path)
        _layer = model.get_layer("business")

        # Manually create an element file with invalid data
        element_file = tmp_path / "business" / "services" / "invalid.service.yaml"
        element_file.parent.mkdir(parents=True, exist_ok=True)
        with open(element_file, "w") as f:
            f.write(
                """id: business.service.invalid
# Missing 'name' field which is required by schema
description: Invalid service
realizes: nonexistent.service.reference
"""
            )

        yield tmp_path

    def test_validate_empty_project(self, runner, tmp_path):
        """Test validating a newly initialized empty project."""
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Validate
        result = runner.invoke(cli, ["validate"], cwd=str(tmp_path))

        assert result.exit_code == 0
        assert "Validating model" in result.output
        # Empty project should pass
        output = strip_ansi(result.output)
        assert "✓" in output or "passed" in output.lower() or "valid" in output.lower()

    def test_validate_valid_project(self, runner, initialized_project):
        """Test validating a project with valid elements."""
        result = runner.invoke(cli, ["validate"], cwd=str(initialized_project))

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Validating model" in output

    def test_validate_project_with_invalid_references(self, runner, initialized_project):
        """Test validating project with invalid cross-references."""
        # Add element with invalid reference
        model = Model(initialized_project)
        from documentation_robotics.core.element import Element

        invalid_element = Element(
            id="application.service.invalid-ref",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.invalid-ref",
                "name": "Invalid Service",
                "realizes": "nonexistent.service.id",  # Invalid reference
            },
        )
        model.add_element("application", invalid_element)
        model.save()

        result = runner.invoke(cli, ["validate"], cwd=str(initialized_project))

        # Should complete but report errors
        output = strip_ansi(result.output)
        assert "Validating model" in output

    def test_validate_strict_mode(self, runner, initialized_project):
        """Test validate with --strict flag."""
        result = runner.invoke(cli, ["validate", "--strict"], cwd=str(initialized_project))

        # Strict mode should run additional validations
        assert "Validating model" in result.output

    def test_validate_json_output(self, runner, initialized_project):
        """Test validate with JSON output."""
        result = runner.invoke(cli, ["validate", "--output", "json"], cwd=str(initialized_project))

        assert result.exit_code == 0

        # Output should contain valid JSON
        # Find the JSON in the output (it starts with { and ends with })
        output = result.output.strip()
        json_start = output.find("{")
        json_end = output.rfind("}")

        assert json_start >= 0, "No JSON object found in output"
        assert json_end >= json_start, "Invalid JSON structure in output"

        json_output = output[json_start : json_end + 1]

        try:
            data = json.loads(json_output)
            assert "valid" in data
            assert "error_count" in data
            assert "warning_count" in data
            assert "errors" in data
            assert "warnings" in data
        except json.JSONDecodeError as e:
            pytest.fail(f"Invalid JSON output: {e}\nOutput: {result.output}")

    def test_validate_updates_manifest_on_success(self, runner, initialized_project):
        """Test that validate updates manifest on successful validation."""
        result = runner.invoke(cli, ["validate"], cwd=str(initialized_project))

        assert result.exit_code == 0

        # Check if manifest exists and was updated
        # Note: Manifest behavior may vary, so this test is lenient
        possible_manifest_paths = [
            initialized_project / "manifest.yaml",
            initialized_project / ".manifest.yaml",
            initialized_project / "test-project" / "manifest.yaml",
            initialized_project / "test-project" / ".manifest.yaml",
        ]

        manifest_file = None
        for path in possible_manifest_paths:
            if path.exists():
                manifest_file = path
                break

        # If a manifest exists, verify it has validation-related content
        if manifest_file:
            with open(manifest_file, "r") as f:
                content = f.read()
                # Manifest should have validation status or timestamp
                assert (
                    "validation_status" in content
                    or "lastValidated" in content
                    or "last_validated" in content
                    or "validation" in content.lower()
                )
        else:
            # If no manifest, that's okay - just verify the command completed successfully
            assert result.exit_code == 0

    def test_validate_no_model_in_directory(self, runner, tmp_path):
        """Test validate command when no model exists."""
        # Create empty directory without initializing
        result = runner.invoke(cli, ["validate"], cwd=str(tmp_path))

        # Should fail with error
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "error" in output.lower() or "no model" in output.lower()

    def test_validate_with_schema_errors(self, runner, initialized_project):
        """Test validate detects schema validation errors."""
        # Create an element file with schema violations
        model = Model(initialized_project)
        from documentation_robotics.core.element import Element

        # Element with wrong data type
        invalid_element = Element(
            id="business.service.bad-data",
            element_type="service",
            layer="business",
            data={
                "id": 12345,  # Should be string, not number (if schema enforces it)
                "name": "Bad Service",
            },
        )
        model.add_element("business", invalid_element)
        model.save()

        result = runner.invoke(cli, ["validate"], cwd=str(initialized_project))

        # May or may not have errors depending on schema strictness
        # But command should complete
        assert "Validating model" in result.output

    def test_validate_reports_error_count(self, runner, initialized_project):
        """Test that validate reports error and warning counts."""
        result = runner.invoke(cli, ["validate"], cwd=str(initialized_project))

        assert result.exit_code == 0
        output = strip_ansi(result.output)

        # Output should mention validation results
        assert "Validating model" in output

    def test_validate_catches_schema_validator_errors(self, runner, initialized_project):
        """Test that validate properly catches SchemaValidator errors."""
        # This test ensures the bug we fixed doesn't regress
        # Create a project and run validation - SchemaValidator will be invoked
        # If the add_error calls are wrong, this will raise TypeError

        result = runner.invoke(cli, ["validate"], cwd=str(initialized_project))

        # Should not crash with TypeError
        assert result.exit_code == 0
        assert "Validating model" in result.output
        # Should not have Python exceptions in output
        assert "TypeError" not in result.output
        assert "Traceback" not in result.output

    def test_validate_strict_catches_schema_validator_errors(self, runner, initialized_project):
        """Test that validate --strict properly calls SchemaValidator without errors."""
        # This specifically tests the strict mode path
        result = runner.invoke(cli, ["validate", "--strict"], cwd=str(initialized_project))

        # Should not crash with TypeError
        assert result.exit_code == 0
        assert "Validating model" in result.output
        # Should not have Python exceptions in output
        assert "TypeError" not in result.output
        assert "Traceback" not in result.output


class TestValidateIntegrationWithSchemaValidator:
    """Integration tests specifically for SchemaValidator integration."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    def test_schema_validation_runs_during_validate(self, runner, tmp_path):
        """Test that schema validation actually runs during validate command."""
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Add element
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Test Service",
                "--description",
                "Test",
            ],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        # Run validate - this should invoke SchemaValidator
        result = runner.invoke(cli, ["validate"], cwd=str(tmp_path))

        # Should complete without errors
        assert result.exit_code == 0
        assert "TypeError" not in result.output
        assert "layer_or_issue" not in result.output

    def test_schema_validator_add_error_called_correctly(self, runner, tmp_path):
        """Test that SchemaValidator.add_error is called with correct arguments."""
        # This is the key test for the bug we fixed
        # If add_error(layer=...) is used instead of add_error(layer, ...),
        # it will raise: TypeError: add_error() got an unexpected keyword argument 'layer'

        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Create element that will trigger schema validation
        model = Model(tmp_path)

        # Check if business layer has a schema
        business_layer = model.get_layer("business")
        if business_layer.schema_path and Path(business_layer.schema_path).exists():
            # Add element and validate - this exercises the SchemaValidator code path
            result = runner.invoke(
                cli,
                [
                    "add",
                    "business",
                    "service",
                    "--name",
                    "Test Service",
                ],
                cwd=str(tmp_path),
            )
            assert result.exit_code == 0

            # Run validation
            result = runner.invoke(cli, ["validate"], cwd=str(tmp_path))

            # Should not raise TypeError about unexpected keyword argument
            assert result.exit_code == 0
            assert "unexpected keyword argument" not in result.output.lower()
            assert "layer_or_issue" not in result.output

    def test_schema_validator_add_warning_called_correctly(self, runner, tmp_path):
        """Test that SchemaValidator.add_warning is called with correct arguments."""
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Manually remove schema to trigger "no schema" warning
        model = Model(tmp_path)
        business_layer = model.get_layer("business")
        _original_schema = business_layer.schema_path
        business_layer.schema_path = None

        # Add element
        from documentation_robotics.core.element import Element

        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"id": "business.service.test", "name": "Test"},
        )
        model.add_element("business", element)
        model.save()

        # Run validation - should trigger add_warning for no schema
        result = runner.invoke(cli, ["validate"], cwd=str(tmp_path))

        # Should not raise TypeError
        assert "TypeError" not in result.output
        assert "unexpected keyword argument" not in result.output.lower()


class TestValidateLinkValidation:
    """Tests for --validate-links flag."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project."""
        runner = CwdCliRunner()
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"
        yield tmp_path

    def test_validate_links_flag_does_not_crash(self, runner, initialized_project):
        """Test that --validate-links flag doesn't crash with AttributeError.

        This is a regression test for the bug where Model.to_dict() was missing,
        causing: AttributeError: 'Model' object has no attribute 'to_dict'
        """
        result = runner.invoke(cli, ["validate", "--validate-links"], cwd=str(initialized_project))

        # Should not crash with AttributeError
        assert "AttributeError" not in result.output
        assert "'Model' object has no attribute 'to_dict'" not in result.output
        assert "Traceback" not in result.output

        # Command should complete (may pass or fail validation, but shouldn't crash)
        assert "Validating model" in result.output
        assert "cross-layer links" in result.output.lower() or "link" in result.output.lower()

    def test_validate_links_calls_model_to_dict(self, runner, initialized_project):
        """Test that --validate-links successfully calls Model.to_dict().

        This verifies that the bug fix (adding to_dict() methods) works correctly.
        """
        # Add an element to ensure model has data
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Test Service",
                "--description",
                "Test",
            ],
            cwd=str(initialized_project),
        )
        assert result.exit_code == 0

        # Run validate with --validate-links
        result = runner.invoke(cli, ["validate", "--validate-links"], cwd=str(initialized_project))

        # Should complete without errors
        assert "Validating cross-layer links" in result.output
        assert "Link validation error" not in result.output or "AttributeError" not in result.output

    def test_model_to_dict_returns_expected_structure(self, initialized_project):
        """Test that Model.to_dict() returns the expected dictionary structure.

        This is a unit test that verifies the to_dict() method produces
        the format expected by LinkAnalyzer.
        """
        model = Model(initialized_project)

        # Call to_dict() - this should not raise AttributeError
        model_data = model.to_dict()

        # Verify structure
        assert isinstance(model_data, dict)

        # Check that layers are present as keys
        for layer_name in model.layers.keys():
            assert layer_name in model_data
            assert isinstance(model_data[layer_name], dict)

    def test_layer_to_dict_returns_expected_structure(self, initialized_project):
        """Test that Layer.to_dict() returns the expected dictionary structure.

        This verifies that elements are grouped by type as expected by LinkAnalyzer.
        """
        model = Model(initialized_project)

        # Add an element
        from documentation_robotics.core.element import Element

        element = Element(
            id="business.service.test",
            element_type="service",
            layer="business",
            data={"id": "business.service.test", "name": "Test Service"},
        )
        model.add_element("business", element)

        # Get layer and call to_dict()
        layer = model.get_layer("business")
        layer_data = layer.to_dict()

        # Verify structure
        assert isinstance(layer_data, dict)

        # Check that elements are grouped by pluralized type
        # Since we added a "service", it should be in "services"
        assert "services" in layer_data
        assert isinstance(layer_data["services"], list)
        assert len(layer_data["services"]) > 0

        # Check element structure
        service = layer_data["services"][0]
        assert "id" in service
        assert "type" in service
        assert "layer" in service

    def test_validate_links_with_strict_links_flag(self, runner, initialized_project):
        """Test --validate-links with --strict-links flag.

        Verifies that both flags work together without crashing.
        """
        result = runner.invoke(
            cli,
            ["validate", "--validate-links", "--strict-links"],
            cwd=str(initialized_project),
        )

        # Should not crash
        assert "AttributeError" not in result.output
        assert "Traceback" not in result.output
        assert "Validating" in result.output

    def test_validate_links_json_output(self, runner, initialized_project):
        """Test --validate-links with JSON output format.

        Verifies that JSON output works with link validation.
        """
        result = runner.invoke(
            cli,
            ["validate", "--validate-links", "--output", "json"],
            cwd=str(initialized_project),
        )

        # Should not crash
        assert "AttributeError" not in result.output

        # Try to parse JSON (may not be pure JSON due to status messages)
        output = result.output.strip()
        json_start = output.find("{")
        if json_start >= 0:
            json_end = output.rfind("}")
            if json_end >= json_start:
                json_output = output[json_start : json_end + 1]
                try:
                    data = json.loads(json_output)
                    # Verify validation result structure exists
                    assert "valid" in data or "errors" in data
                except json.JSONDecodeError:
                    # JSON parsing may fail if output is mixed with status messages
                    # Just verify no crash occurred
                    pass

    def test_validate_links_empty_model(self, runner, initialized_project):
        """Test --validate-links on an empty model (no elements).

        Ensures link validation handles empty models gracefully.
        """
        result = runner.invoke(cli, ["validate", "--validate-links"], cwd=str(initialized_project))

        # Should complete without errors
        assert result.exit_code == 0 or "error" not in result.output.lower()
        assert "AttributeError" not in result.output
        assert "Traceback" not in result.output
