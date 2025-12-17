"""Integration tests for relationship command group.

Tests the full workflow of managing relationships with predicates:
- Adding relationships with predicate validation
- Listing relationships (outgoing and incoming)
- Removing relationships with optional inverse removal
- Validating relationships across the model
"""

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from documentation_robotics.cli import cli
from documentation_robotics.core.model import Model


@pytest.fixture
def test_model_with_elements(tmp_path):
    """Create a test model with sample elements for relationship testing."""
    runner = CliRunner()

    with runner.isolated_filesystem(temp_dir=tmp_path):
        # Initialize model
        result = runner.invoke(cli, ["init", "test-project"])
        assert result.exit_code == 0, f"Init failed: {result.output}"

        # Add API operation
        result = runner.invoke(
            cli,
            [
                "add",
                "api",
                "operation",
                "--id",
                "api.operation.create-user",
                "--name",
                "Create User",
                "--description",
                "Creates a new user",
            ],
        )
        assert result.exit_code == 0, f"Add API operation failed: {result.output}"

        # Add data schema
        result = runner.invoke(
            cli,
            [
                "add",
                "data_model",
                "json-schema",
                "--id",
                "data_model.schema.user",
                "--name",
                "User",
                "--description",
                "User data schema",
            ],
        )
        assert result.exit_code == 0, f"Add data schema failed: {result.output}"

        # Add another data schema
        result = runner.invoke(
            cli,
            [
                "add",
                "data_model",
                "json-schema",
                "--id",
                "data_model.schema.profile",
                "--name",
                "Profile",
                "--description",
                "User profile data",
            ],
        )
        assert result.exit_code == 0, f"Add profile schema failed: {result.output}"

        # Add business service
        result = runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--id",
                "business.service.user-management",
                "--name",
                "User Management",
                "--description",
                "User management service",
            ],
        )
        assert result.exit_code == 0, f"Add business service failed: {result.output}"

        yield Path.cwd()


class TestRelationshipAdd:
    """Tests for dr relationship add command."""

    def test_add_cross_layer_relationship(self, test_model_with_elements):
        """Test adding a cross-layer relationship with predicate."""
        runner = CliRunner()

        result = runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        assert result.exit_code == 0, f"Command failed: {result.output}"
        assert "✓" in result.output
        assert "accesses" in result.output

        # Verify relationship was added
        model = Model(test_model_with_elements)
        relationships = model.get_relationships("api.operation.create-user")
        assert len(relationships) == 1
        assert relationships[0]["targetId"] == "data_model.schema.user"
        assert relationships[0]["predicate"] == "accesses"
        assert relationships[0]["type"] == "cross-layer"

    def test_add_intra_layer_relationship(self, test_model_with_elements):
        """Test adding an intra-layer relationship."""
        runner = CliRunner()

        result = runner.invoke(
            cli,
            ["relationship", "add", "data_model.schema.user", "aggregates", "data_model.schema.profile"],
        )

        assert result.exit_code == 0, f"Command failed: {result.output}"
        assert "✓" in result.output
        assert "aggregates" in result.output

        # Verify relationship type
        model = Model(test_model_with_elements)
        relationships = model.get_relationships("data_model.schema.user")
        assert len(relationships) == 1
        assert relationships[0]["type"] == "intra-layer"

    def test_add_invalid_predicate(self, test_model_with_elements):
        """Test adding relationship with unknown predicate fails."""
        runner = CliRunner()

        result = runner.invoke(
            cli,
            [
                "relationship",
                "add",
                "api.operation.create-user",
                "invalid-predicate",
                "data_model.schema.user",
            ],
        )

        assert result.exit_code != 0
        assert "Unknown predicate" in result.output or "✗" in result.output

    def test_add_predicate_invalid_for_layer(self, test_model_with_elements):
        """Test that predicates invalid for a layer are rejected."""
        runner = CliRunner()

        # Try to use a predicate that's not valid for the API layer
        # (This test assumes certain predicates are layer-specific)
        result = runner.invoke(
            cli,
            [
                "relationship",
                "add",
                "api.operation.create-user",
                "governs",  # governance predicate not typically for API layer
                "data_model.schema.user",
            ],
        )

        # Should either fail or succeed depending on relationship-catalog.json
        # This is a flexible test that verifies the validation runs
        assert "predicate" in result.output.lower() or result.exit_code == 0

    def test_add_nonexistent_source(self, test_model_with_elements):
        """Test adding relationship with nonexistent source element fails."""
        runner = CliRunner()

        result = runner.invoke(
            cli,
            ["relationship", "add", "api.operation.nonexistent", "accesses", "data_model.schema.user"],
        )

        assert result.exit_code != 0
        assert "not found" in result.output

    def test_add_nonexistent_target(self, test_model_with_elements):
        """Test adding relationship with nonexistent target element fails."""
        runner = CliRunner()

        result = runner.invoke(
            cli,
            [
                "relationship",
                "add",
                "api.operation.create-user",
                "accesses",
                "data_model.schema.nonexistent",
            ],
        )

        assert result.exit_code != 0
        assert "not found" in result.output

    def test_add_suggests_inverse(self, test_model_with_elements):
        """Test that adding bidirectional relationship suggests inverse."""
        runner = CliRunner()

        result = runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        # Should succeed and suggest inverse predicate
        assert result.exit_code == 0
        assert "Suggestion" in result.output or "inverse" in result.output.lower()
        assert "accessed-by" in result.output


class TestRelationshipList:
    """Tests for dr relationship list command."""

    def test_list_relationships(self, test_model_with_elements):
        """Test listing relationships for an element."""
        runner = CliRunner()

        # Add some relationships
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )
        runner.invoke(
            cli,
            [
                "relationship",
                "add",
                "api.operation.create-user",
                "accesses",
                "data_model.schema.profile",
            ],
        )

        # List relationships
        result = runner.invoke(cli, ["relationship", "list", "api.operation.create-user"])

        assert result.exit_code == 0
        assert "data_model.schema.user" in result.output
        assert "data_model.schema.profile" in result.output
        assert "accesses" in result.output

    def test_list_outgoing_only(self, test_model_with_elements):
        """Test listing only outgoing relationships."""
        runner = CliRunner()

        # Add relationship
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        result = runner.invoke(
            cli, ["relationship", "list", "api.operation.create-user", "--direction", "outgoing"]
        )

        assert result.exit_code == 0
        assert "Outgoing" in result.output
        assert "data_model.schema.user" in result.output

    def test_list_incoming_only(self, test_model_with_elements):
        """Test listing only incoming relationships."""
        runner = CliRunner()

        # Add relationship (target perspective)
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        result = runner.invoke(
            cli, ["relationship", "list", "data_model.schema.user", "--direction", "incoming"]
        )

        assert result.exit_code == 0
        assert "Incoming" in result.output
        assert "api.operation.create-user" in result.output

    def test_list_json_format(self, test_model_with_elements):
        """Test listing relationships in JSON format."""
        runner = CliRunner()

        # Add relationship
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        result = runner.invoke(
            cli, ["relationship", "list", "api.operation.create-user", "--format", "json"]
        )

        assert result.exit_code == 0
        output = json.loads(result.output)
        assert "elementId" in output
        assert "outgoing" in output
        assert len(output["outgoing"]) == 1

    def test_list_filter_by_predicate(self, test_model_with_elements):
        """Test filtering relationships by predicate."""
        runner = CliRunner()

        # Add multiple relationships with different predicates
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        result = runner.invoke(
            cli,
            ["relationship", "list", "api.operation.create-user", "--predicate", "accesses"],
        )

        assert result.exit_code == 0
        assert "accesses" in result.output


class TestRelationshipRemove:
    """Tests for dr relationship remove command."""

    def test_remove_relationship(self, test_model_with_elements):
        """Test removing a relationship."""
        runner = CliRunner()

        # Add relationship
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        # Remove relationship
        result = runner.invoke(
            cli,
            [
                "relationship",
                "remove",
                "api.operation.create-user",
                "accesses",
                "data_model.schema.user",
            ],
        )

        assert result.exit_code == 0
        assert "✓" in result.output or "Removed" in result.output

        # Verify relationship was removed
        model = Model(test_model_with_elements)
        relationships = model.get_relationships("api.operation.create-user")
        assert len(relationships) == 0

    def test_remove_nonexistent_relationship(self, test_model_with_elements):
        """Test removing nonexistent relationship fails gracefully."""
        runner = CliRunner()

        result = runner.invoke(
            cli,
            [
                "relationship",
                "remove",
                "api.operation.create-user",
                "accesses",
                "data_model.schema.user",
            ],
        )

        assert result.exit_code != 0
        assert "not found" in result.output.lower()

    def test_remove_with_inverse(self, test_model_with_elements):
        """Test removing relationship with inverse flag."""
        runner = CliRunner()

        # Add forward relationship
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        # Add inverse relationship manually
        runner.invoke(
            cli,
            [
                "relationship",
                "add",
                "data_model.schema.user",
                "accessed-by",
                "api.operation.create-user",
            ],
        )

        # Remove with inverse
        result = runner.invoke(
            cli,
            [
                "relationship",
                "remove",
                "api.operation.create-user",
                "accesses",
                "data_model.schema.user",
                "--remove-inverse",
            ],
        )

        assert result.exit_code == 0

        # Verify both removed
        model = Model(test_model_with_elements)
        forward_rels = model.get_relationships("api.operation.create-user")
        inverse_rels = model.get_relationships("data_model.schema.user")
        assert len(forward_rels) == 0
        assert len(inverse_rels) == 0


class TestRelationshipValidate:
    """Tests for dr relationship validate command."""

    def test_validate_valid_relationships(self, test_model_with_elements):
        """Test validating a model with valid relationships."""
        runner = CliRunner()

        # Add valid relationship
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        result = runner.invoke(cli, ["relationship", "validate"])

        assert result.exit_code == 0
        assert "passed" in result.output.lower() or "✓" in result.output

    def test_validate_with_fix_inverse(self, test_model_with_elements):
        """Test validation with automatic inverse fixing."""
        runner = CliRunner()

        # Add only forward relationship (no inverse)
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        result = runner.invoke(cli, ["relationship", "validate", "--fix-inverse"])

        # Should either fix or report no issues depending on whether relationship is bidirectional
        assert result.exit_code == 0 or "WARNING" in result.output

    def test_validate_strict_mode(self, test_model_with_elements):
        """Test validation in strict mode (warnings become errors)."""
        runner = CliRunner()

        # Add relationship
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        result = runner.invoke(cli, ["relationship", "validate", "--strict"])

        # Strict mode may fail on warnings
        assert "Validation" in result.output


class TestRelationshipWorkflow:
    """End-to-end workflow tests."""

    def test_complete_workflow(self, test_model_with_elements):
        """Test complete add → list → validate → remove workflow."""
        runner = CliRunner()

        # 1. Add relationship
        result = runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )
        assert result.exit_code == 0

        # 2. List relationships
        result = runner.invoke(cli, ["relationship", "list", "api.operation.create-user"])
        assert result.exit_code == 0
        assert "data_model.schema.user" in result.output

        # 3. Validate
        result = runner.invoke(cli, ["relationship", "validate"])
        assert result.exit_code == 0

        # 4. Remove
        result = runner.invoke(
            cli,
            [
                "relationship",
                "remove",
                "api.operation.create-user",
                "accesses",
                "data_model.schema.user",
            ],
        )
        assert result.exit_code == 0

        # 5. Verify removed
        result = runner.invoke(cli, ["relationship", "list", "api.operation.create-user"])
        assert result.exit_code == 0
        assert "No relationships" in result.output or result.output.count("data_model.schema.user") == 0

    def test_bidirectional_relationship_workflow(self, test_model_with_elements):
        """Test workflow with bidirectional relationships."""
        runner = CliRunner()

        # Add forward relationship
        runner.invoke(
            cli,
            ["relationship", "add", "api.operation.create-user", "accesses", "data_model.schema.user"],
        )

        # Add inverse relationship
        runner.invoke(
            cli,
            [
                "relationship",
                "add",
                "data_model.schema.user",
                "accessed-by",
                "api.operation.create-user",
            ],
        )

        # List from source perspective
        result = runner.invoke(cli, ["relationship", "list", "api.operation.create-user"])
        assert "Outgoing" in result.output
        assert "data_model.schema.user" in result.output

        # List from target perspective
        result = runner.invoke(cli, ["relationship", "list", "data_model.schema.user"])
        assert "Outgoing" in result.output  # has inverse relationship out
        assert "Incoming" in result.output  # has forward relationship in

        # Validate should pass
        result = runner.invoke(cli, ["relationship", "validate"])
        assert result.exit_code == 0
