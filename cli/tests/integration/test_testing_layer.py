"""
Integration tests for Testing Layer (Layer 12) support.
"""

import os

import pytest
import yaml
from click.testing import CliRunner
from documentation_robotics.cli import cli


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


class TestTestingLayerIntegration:
    """Test Testing Layer integration with CLI commands."""

    @pytest.fixture
    def runner(self):
        """Create a CLI test runner."""
        return CwdCliRunner()

    @pytest.fixture
    def temp_model(self, tmp_path, runner):
        """Create a temporary model for testing."""
        # Initialize model in tmp_path (creates model IN tmp_path, not in tmp_path/test-model)
        result = runner.invoke(
            cli,
            ["init", "test-model", "--path", str(tmp_path)],
        )

        # Debug output if init fails
        if result.exit_code != 0:
            print(f"\nInit command failed with exit code {result.exit_code}")
            print(f"Output: {result.output}")
            if result.exception:
                print(f"Exception: {result.exception}")
                import traceback

                traceback.print_exception(
                    type(result.exception), result.exception, result.exception.__traceback__
                )

        assert (
            result.exit_code == 0
        ), f"Init failed with exit code {result.exit_code}: {result.output}"

        # The model is created in tmp_path, not in tmp_path/test-model
        model_path = tmp_path
        assert (
            model_path / "documentation-robotics" / "model" / "manifest.yaml"
        ).exists(), f"Model not created at {model_path}. Contents: {list(model_path.iterdir())}"

        return model_path

    def test_testing_layer_in_manifest(self, temp_model):
        """Test that Testing layer is included in manifest."""
        manifest_path = temp_model / "documentation-robotics" / "model" / "manifest.yaml"
        assert manifest_path.exists()

        with open(manifest_path) as f:
            manifest = yaml.safe_load(f)

        # Check that testing layer is present
        assert "testing" in manifest["layers"]
        assert manifest["layers"]["testing"]["order"] == 12
        assert manifest["layers"]["testing"]["name"] == "Testing"
        assert manifest["layers"]["testing"]["enabled"] is True

    def test_testing_layer_directory_created(self, temp_model):
        """Test that Testing layer directory is created."""
        testing_dir = temp_model / "documentation-robotics" / "model" / "12_testing"
        assert testing_dir.exists()
        assert testing_dir.is_dir()

    def test_testing_layer_schema_bundled(self, temp_model):
        """Test that Testing layer schema is bundled."""
        schema_path = temp_model / ".dr" / "schemas" / "12-testing-layer.schema.json"
        assert schema_path.exists()

        # Verify it's valid JSON
        import json

        with open(schema_path) as f:
            schema = json.load(f)

        assert schema["$id"] == "https://example.com/schemas/12-testing-layer.json"
        assert schema["title"] == "Testing Layer Schema"

    def test_add_coverage_target(self, temp_model, runner):
        """Test adding a coverage target entity."""
        result = runner.invoke(
            cli,
            [
                "add",
                "testing",
                "coverage-target",
                "--name",
                "Order Creation Coverage",
                "--description",
                "Test coverage for order creation workflow",
            ],
            cwd=str(temp_model),
            catch_exceptions=False,
        )

        # The command should succeed
        # We're mainly testing that the entity type is recognized
        assert result.exit_code == 0, f"Add failed: {result.output}"

    def test_list_testing_layer(self, temp_model, runner):
        """Test listing Testing layer elements."""
        result = runner.invoke(
            cli,
            ["list", "testing"],
            cwd=str(temp_model),
            catch_exceptions=False,
        )

        # Should not error, even if empty
        assert result.exit_code == 0, f"List failed: {result.output}"

    def test_entity_type_registry_recognizes_testing_types(self):
        """Test that entity type registry recognizes Testing layer types."""
        from documentation_robotics.schemas.registry import TESTING_LAYER_TYPES

        # Verify all expected entity types are defined
        expected_types = [
            "coverage-target",
            "input-space-partition",
            "context-variation",
            "coverage-requirement",
            "test-case-sketch",
        ]

        for entity_type in expected_types:
            assert entity_type in TESTING_LAYER_TYPES

    def test_testing_layer_validation(self, temp_model, runner):
        """Test that Testing layer can be validated."""
        result = runner.invoke(
            cli,
            ["validate", "--layer", "testing"],
            cwd=str(temp_model),
            catch_exceptions=False,
        )

        # Should validate successfully (even if empty)
        assert result.exit_code == 0, f"Validate failed: {result.output}"
