"""
Integration tests for full CLI workflow.

Tests the complete user journey:
1. Initialize project
2. Add elements across layers
3. Validate model
4. Project elements
5. Export to formats
"""

import os
import tempfile
from pathlib import Path

import pytest
from click.testing import CliRunner
from documentation_robotics.cli import cli
from documentation_robotics.core.model import Model


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


class TestFullWorkflow:
    """Test complete CLI workflow from init to export."""

    @pytest.fixture
    def temp_project(self):
        """Create a temporary project directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir) / "test-project"
            yield project_dir

    @pytest.fixture
    def runner(self):
        """Create a CLI test runner."""
        return CwdCliRunner()

    def test_complete_workflow(self, runner, temp_project):
        """Test complete workflow: init -> add -> validate -> project -> export."""

        # Step 1: Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(temp_project)])
        assert result.exit_code == 0, f"Init failed: {result.output}"
        assert (
            temp_project / "documentation-robotics" / "model"
        ).exists(), "Model directory should be created"
        assert (temp_project / ".dr" / "schemas").exists(), "Schemas should be copied"

        # Verify schemas were copied
        schemas_dir = temp_project / ".dr" / "schemas"
        assert (schemas_dir / "01-motivation-layer.schema.json").exists()
        assert (schemas_dir / "02-business-layer.schema.json").exists()

        # Step 2: Add elements across layers
        # Add a goal (motivation layer)
        result = runner.invoke(
            cli,
            [
                "add",
                "motivation",
                "goal",
                "--name",
                "Improve Customer Satisfaction",
                "--property",
                "description=Increase customer satisfaction scores",
            ],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0, f"Add goal failed: {result.output}"

        # Add a business process (business layer)
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "process",
                "--name",
                "Order Fulfillment",
                "--property",
                "description=Process customer orders",
            ],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0, f"Add process failed: {result.output}"

        # Add an application service (application layer)
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "service",
                "--name",
                "Order Service",
                "--property",
                "description=Manages customer orders",
                "--property",
                "realizes=business.process.order-fulfillment",
            ],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0, f"Add service failed: {result.output}"

        # Step 3: Validate model
        result = runner.invoke(cli, ["validate"], cwd=str(temp_project))
        assert result.exit_code == 0, f"Validation failed: {result.output}"

        # Step 4: List elements
        result = runner.invoke(cli, ["list", "business"], cwd=str(temp_project))
        assert result.exit_code == 0, f"List failed: {result.output}"
        assert "Order Fulfillment" in result.output

        # Step 5: Search elements
        result = runner.invoke(cli, ["search", "--name", "Order*"], cwd=str(temp_project))
        assert result.exit_code == 0, f"Search failed: {result.output}"

        # Step 6: Export (test at least one format)
        result = runner.invoke(
            cli,
            [
                "export",
                "--format",
                "markdown",
                "--output",
                str(temp_project / "specs"),
            ],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0, f"Export failed: {result.output}"

    def test_init_with_schemas(self, runner, temp_project):
        """Test that init properly copies schema files."""
        result = runner.invoke(cli, ["init", "test-project", "--path", str(temp_project)])
        assert result.exit_code == 0

        schemas_dir = temp_project / ".dr" / "schemas"
        assert schemas_dir.exists()

        # Check that all layer schemas exist
        expected_schemas = [
            "01-motivation-layer.schema.json",
            "02-business-layer.schema.json",
            "03-security-layer.schema.json",
            "04-application-layer.schema.json",
            "05-technology-layer.schema.json",
            "06-api-layer.schema.json",
            "07-data-model-layer.schema.json",
            "08-datastore-layer.schema.json",
            "09-ux-layer.schema.json",
            "10-navigation-layer.schema.json",
            "11-apm-observability-layer.schema.json",
            "federated-architecture.schema.json",
        ]

        for schema_file in expected_schemas:
            schema_path = schemas_dir / schema_file
            assert schema_path.exists(), f"Schema {schema_file} should exist"

    def test_add_with_validation(self, runner, temp_project):
        """Test that adding elements validates against schemas."""
        # Initialize project
        runner.invoke(cli, ["init", "test-project", "--path", str(temp_project)])

        # Try to add element with invalid properties (should fail validation)
        # This tests that schemas are being used
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "process",
                "--name",
                "",  # Empty name should fail
                "--root",
                str(temp_project),
            ],
        )
        # Should fail due to empty name
        assert result.exit_code != 0 or "error" in result.output.lower()

    def test_model_persistence(self, runner, temp_project):
        """Test that model changes persist across operations."""
        # Initialize
        runner.invoke(cli, ["init", "test-project", "--path", str(temp_project)])

        # Add element
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Customer Service",
            ],
            cwd=str(temp_project),
        )

        # Load model programmatically and verify element exists
        model = Model(temp_project)
        elements = list(model.get_layer("business").elements.values())
        assert len(elements) > 0
        assert any("customer-service" in e.id for e in elements)

    def test_cross_layer_references(self, runner, temp_project):
        """Test that cross-layer references work correctly."""
        # Initialize
        runner.invoke(cli, ["init", "test-project", "--path", str(temp_project)])

        # Add business service
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Payment Processing",
                "--id",
                "business.service.payment-processing",
            ],
            cwd=str(temp_project),
        )

        # Add application service that realizes the business service
        result = runner.invoke(
            cli,
            [
                "add",
                "application",
                "service",
                "--name",
                "Payment API",
                "--property",
                "realizes=business.service.payment-processing",
            ],
            cwd=str(temp_project),
        )
        assert result.exit_code == 0

        # Validate should pass (valid reference)
        result = runner.invoke(cli, ["validate"], cwd=str(temp_project))
        assert result.exit_code == 0

    def test_conformance_command(self, runner, temp_project):
        """Test the conformance command works."""
        # Initialize
        runner.invoke(cli, ["init", "test-project", "--path", str(temp_project)])

        # Run conformance check
        result = runner.invoke(cli, ["conformance"], cwd=str(temp_project))
        assert result.exit_code == 0
        assert "Specification" in result.output or "conformance" in result.output.lower()
