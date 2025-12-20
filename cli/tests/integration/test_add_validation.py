"""Integration tests for entity type validation in add command."""

import os
import re

import pytest
from click.testing import CliRunner
from documentation_robotics.cli import cli


def strip_ansi(text):
    """Remove ANSI escape codes from text."""
    ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
    return ansi_escape.sub("", text)


class CwdCliRunner(CliRunner):
    """CLI runner that supports cwd parameter."""

    def invoke(
        self,
        cli,
        args=None,
        input=None,
        env=None,
        catch_exceptions=True,
        color=False,
        cwd=None,
        **extra,
    ):
        """Invoke CLI with optional cwd support."""
        if cwd is not None:
            # Save current directory
            original_cwd = os.getcwd()
            try:
                os.chdir(cwd)
                return super().invoke(cli, args, input, env, catch_exceptions, color, **extra)
            finally:
                os.chdir(original_cwd)
        else:
            return super().invoke(cli, args, input, env, catch_exceptions, color, **extra)


class TestAddEntityTypeValidation:
    """Tests for entity type validation in dr add command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project."""
        runner = CwdCliRunner()
        # Initialize project - init creates project at the path location
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"
        # Return the tmp_path since init creates the project there
        yield tmp_path

    def test_add_with_valid_entity_type_succeeds(self, runner, initialized_project):
        """Test that add command succeeds with valid entity type."""
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Customer Management",
                "--description",
                "Handles customer operations",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_with_invalid_entity_type_fails(self, runner, initialized_project):
        """Test that add command fails with invalid entity type."""
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "unicorn",  # Invalid type
                "--name",
                "Magic Service",
            ],
            cwd=str(initialized_project),
        )

        # Should fail
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "Invalid entity type 'unicorn'" in output
        assert "business" in output

    def test_add_error_shows_valid_types(self, runner, initialized_project):
        """Test that error message shows list of valid entity types."""
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "dragon",  # Invalid type
                "--name",
                "Fire Service",
            ],
            cwd=str(initialized_project),
        )

        # Should show valid types
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "Valid entity types for 'business' layer:" in output
        # Business layer should have these types from schema
        assert any(t in output for t in ["service", "process", "actor", "role", "event", "object"])

    def test_add_application_component_succeeds(self, runner, initialized_project):
        """Test that add command works for application layer."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "User Interface",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_invalid_application_type_fails(self, runner, initialized_project):
        """Test that invalid application type fails."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "widget",  # Invalid type
                "--name",
                "Test Widget",
            ],
            cwd=str(initialized_project),
        )

        # Should fail with helpful message
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "Invalid entity type 'widget'" in output
        assert "application" in output

    def test_add_validation_is_case_insensitive(self, runner, initialized_project):
        """Test that entity type validation is case-insensitive."""
        # Try uppercase version of valid type
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "SERVICE",  # Valid type in uppercase
                "--name",
                "Test Service",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed (validation is case-insensitive)
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_api_layer_special_types(self, runner, initialized_project):
        """Test that API layer accepts its special entity types."""
        result = runner.invoke(
            cli,
            [
                "add",
                "api",
                "operation",  # Special API layer type
                "--name",
                "Get Users",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_data_model_layer_special_types(self, runner, initialized_project):
        """Test that data_model layer accepts its special entity types."""
        result = runner.invoke(
            cli,
            [
                "add",
                "data_model",
                "object-schema",  # Valid data_model layer type (JSON Schema Draft 7)
                "--name",
                "User",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_with_source_file_only(self, runner, initialized_project):
        """Test that add command accepts source-file option."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-file",
                "src/services/order_service.py",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_with_source_file_and_symbol(self, runner, initialized_project):
        """Test that add command accepts source-file and source-symbol options."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-file",
                "src/services/order_service.py",
                "--source-symbol",
                "OrderService",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_with_source_symbol_without_file_fails(self, runner, initialized_project):
        """Test that source-symbol without source-file fails."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-symbol",
                "OrderService",
            ],
            cwd=str(initialized_project),
        )

        # Should fail
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "--source-symbol requires --source-file" in output

    def test_add_with_all_source_options(self, runner, initialized_project):
        """Test that add command accepts all source reference options."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-file",
                "src/services/order_service.py",
                "--source-symbol",
                "OrderService",
                "--source-provenance",
                "manual",
                "--source-repo-url",
                "https://github.com/acme/backend.git",
                "--source-commit",
                "abcdef0123456789abcdef0123456789abcdef01",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_with_invalid_commit_format_fails(self, runner, initialized_project):
        """Test that invalid commit SHA format fails."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-file",
                "src/services/order_service.py",
                "--source-commit",
                "invalid",
            ],
            cwd=str(initialized_project),
        )

        # Should fail
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "40 hexadecimal characters" in output

    def test_add_with_short_commit_hash_fails(self, runner, initialized_project):
        """Test that commit SHA shorter than 40 characters fails."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-file",
                "src/services/order_service.py",
                "--source-commit",
                "abc123",  # Too short
            ],
            cwd=str(initialized_project),
        )

        # Should fail
        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "40 hexadecimal characters" in output

    def test_add_with_different_provenance_types(self, runner, initialized_project):
        """Test that different provenance types are accepted."""
        for provenance in ["manual", "extracted", "inferred", "generated"]:
            result = runner.invoke(
                cli,
                [
                    "add",
                    "application",
                    "component",
                    "--name",
                    f"Component {provenance}",
                    "--source-file",
                    "src/services/test.py",
                    "--source-provenance",
                    provenance,
                ],
                cwd=str(initialized_project),
            )

            # All should succeed
            assert result.exit_code == 0, f"Failed for provenance={provenance}: {result.output}"
            assert "Successfully added element" in result.output

    def test_add_source_provenance_defaults_to_manual(self, runner, initialized_project):
        """Test that source-provenance defaults to 'manual' when not specified."""
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-file",
                "src/services/order_service.py",
                "--source-symbol",
                "OrderService",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed with default provenance
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

    def test_add_source_reference_data_stored_correctly(self, runner, initialized_project):
        """Test that source reference data is stored correctly in element properties."""
        from pathlib import Path

        import yaml

        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Order Service",
                "--source-file",
                "src/services/order_service.py",
                "--source-symbol",
                "OrderService",
                "--source-provenance",
                "manual",
                "--source-repo-url",
                "https://github.com/acme/backend.git",
                "--source-commit",
                "abcdef0123456789abcdef0123456789abcdef01",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed
        assert result.exit_code == 0

        # Read the stored element from the model (elements stored in model/04_application/components.yaml)
        model_file = (
            Path(initialized_project)
            / "documentation-robotics"
            / "model"
            / "04_application"
            / "components.yaml"
        )
        assert model_file.exists(), f"Components file not found at {model_file}"

        with open(model_file, "r") as f:
            layer_data = yaml.safe_load(f) or {}

        # Find the Order Service element (stored by name as key)
        assert "Order Service" in layer_data, "Order Service element not found in stored data"
        order_service = layer_data["Order Service"]

        # Verify the source reference structure
        assert "properties" in order_service
        assert "source" in order_service["properties"]
        assert "reference" in order_service["properties"]["source"]

        source_ref = order_service["properties"]["source"]["reference"]

        # Verify all fields
        assert source_ref["provenance"] == "manual"
        assert len(source_ref["locations"]) == 1
        assert source_ref["locations"][0]["file"] == "src/services/order_service.py"
        assert source_ref["locations"][0]["symbol"] == "OrderService"
        assert source_ref["repository"]["url"] == "https://github.com/acme/backend.git"
        assert source_ref["repository"]["commit"] == "abcdef0123456789abcdef0123456789abcdef01"

    def test_add_with_uppercase_commit_sha(self, runner, initialized_project):
        """Test that uppercase commit SHA is accepted and normalized."""
        from pathlib import Path

        import yaml

        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "component",
                "--name",
                "Payment Service",
                "--source-file",
                "src/services/payment_service.py",
                "--source-commit",
                "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
            ],
            cwd=str(initialized_project),
        )

        # Should succeed (uppercase should be accepted)
        assert result.exit_code == 0
        assert "Successfully added element" in result.output

        # Read the stored element to verify commit was normalized to lowercase
        model_file = (
            Path(initialized_project)
            / "documentation-robotics"
            / "model"
            / "04_application"
            / "components.yaml"
        )
        with open(model_file, "r") as f:
            layer_data = yaml.safe_load(f) or {}

        assert "Payment Service" in layer_data, "Payment Service element not found in stored data"
        payment_service = layer_data["Payment Service"]

        source_ref = payment_service["properties"]["source"]["reference"]

        # Verify commit was normalized to lowercase
        assert source_ref["repository"]["commit"] == "abcdef0123456789abcdef0123456789abcdef01"
