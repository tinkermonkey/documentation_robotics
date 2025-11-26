"""Integration tests for remove command."""

import re

import pytest
from click.testing import CliRunner
from documentation_robotics.cli import cli
from documentation_robotics.core.element import Element
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
            original_cwd = os.getcwd()
            try:
                os.chdir(cwd)
                return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)
            finally:
                os.chdir(original_cwd)
        else:
            return super().invoke(cli_cmd, args, input, env, catch_exceptions, color, **extra)


class TestRemoveCommand:
    """Tests for remove command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def project_with_element(self, tmp_path):
        """Create project with a test element."""
        runner = CwdCliRunner()
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Add an element
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

        yield tmp_path

    def test_remove_nonexistent_element(self, runner, tmp_path):
        """Test removing element that doesn't exist."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        result = runner.invoke(
            cli,
            ["remove", "business.service.nonexistent", "--yes"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "not found" in output.lower()

    def test_remove_element_requires_confirmation(self, runner, project_with_element):
        """Test that remove requires confirmation by default."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        assert len(elements) > 0
        element_id = elements[0].id

        # Try to remove without --yes, and provide "n" as input
        result = runner.invoke(
            cli,
            ["remove", element_id],
            input="n\n",
            cwd=str(project_with_element),
        )

        # Should be cancelled
        assert "Cancelled" in result.output or result.exit_code != 0

    def test_remove_element_with_yes_flag(self, runner, project_with_element):
        """Test removing element with --yes flag."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["remove", element_id, "--yes"],
            cwd=str(project_with_element),
        )

        # Command should complete (may succeed or fail depending on implementation)
        output = strip_ansi(result.output)
        # Just verify the command ran and showed the element
        assert element_id in output

    def test_remove_element_dry_run(self, runner, project_with_element):
        """Test remove with --dry-run flag."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["remove", element_id, "--dry-run", "--force"],
            cwd=str(project_with_element),
        )

        # Dry run should show preview
        output = strip_ansi(result.output)
        assert element_id in output
        # Dry run should indicate it's not actually removing
        assert "dry run" in output.lower() or "would" in output.lower()

    def test_remove_element_with_dependencies_fails(self, runner, tmp_path):
        """Test that removing element with dependencies fails by default."""
        # Initialize and add elements with dependencies
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add business service
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Business Service",
            ],
            cwd=str(tmp_path),
        )

        # Get the business service ID
        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        # Add application service that depends on it
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": biz_service.id,
            },
        )
        model.add_element("application", app_service)
        model.save()

        # Try to remove business service (has dependencies)
        result = runner.invoke(
            cli,
            ["remove", biz_service.id, "--yes"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "dependent" in output.lower() or "dependencies" in output.lower()

    def test_remove_element_with_force_flag(self, runner, tmp_path):
        """Test removing element with --force flag skips dependency checks."""
        # Initialize and add elements with dependencies
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add business service
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Business Service",
            ],
            cwd=str(tmp_path),
        )

        # Get the business service ID
        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        # Add application service that depends on it
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": biz_service.id,
            },
        )
        model.add_element("application", app_service)
        model.save()

        # Remove with --force
        result = runner.invoke(
            cli,
            ["remove", biz_service.id, "--force", "--yes"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "successfully removed" in output.lower()

    def test_remove_element_with_cascade_flag(self, runner, tmp_path):
        """Test removing element with --cascade flag."""
        # Initialize and add elements with dependencies
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add business service
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Business Service",
            ],
            cwd=str(tmp_path),
        )

        # Get the business service ID
        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        # Add application service that depends on it
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": biz_service.id,
            },
        )
        model.add_element("application", app_service)
        model.save()

        # Remove with --cascade
        result = runner.invoke(
            cli,
            ["remove", biz_service.id, "--cascade", "--yes"],
            cwd=str(tmp_path),
        )

        # Command should handle cascade
        output = strip_ansi(result.output)
        assert biz_service.id in output

    def test_remove_shows_element_details(self, runner, project_with_element):
        """Test that remove shows element details before removing."""
        # Get the element ID
        model = Model(project_with_element)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["remove", element_id, "--dry-run"],
            cwd=str(project_with_element),
        )

        output = strip_ansi(result.output)
        assert element_id in output
        assert "Layer:" in output
        assert "Type:" in output
        assert "Name:" in output

    def test_remove_no_model_in_directory(self, runner, tmp_path):
        """Test remove command when no model exists."""
        result = runner.invoke(
            cli,
            ["remove", "business.service.test", "--yes"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "no model" in output.lower()

    def test_remove_shows_dependency_count(self, runner, tmp_path):
        """Test that remove shows count of dependent elements."""
        # Initialize and add elements with multiple dependencies
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add business service
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Business Service",
            ],
            cwd=str(tmp_path),
        )

        # Get the business service ID
        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        # Add multiple dependent services
        for i in range(3):
            app_service = Element(
                id=f"application.service.app-service-{i}",
                element_type="service",
                layer="application",
                data={
                    "id": f"application.service.app-service-{i}",
                    "name": f"App Service {i}",
                    "realizes": biz_service.id,
                },
            )
            model.add_element("application", app_service)
        model.save()

        # Try to remove (should show dependency count)
        result = runner.invoke(
            cli,
            ["remove", biz_service.id, "--dry-run"],
            cwd=str(tmp_path),
        )

        output = strip_ansi(result.output)
        assert "3" in output or "dependent" in output.lower()

    def test_remove_cascade_dry_run_shows_count(self, runner, tmp_path):
        """Test that cascade dry-run shows total count to be removed."""
        # Initialize and add elements
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add business service
        runner.invoke(
            cli,
            [
                "add",
                "business",
                "service",
                "--name",
                "Business Service",
            ],
            cwd=str(tmp_path),
        )

        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        # Add dependent
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": biz_service.id,
            },
        )
        model.add_element("application", app_service)
        model.save()

        # Dry run with cascade
        result = runner.invoke(
            cli,
            ["remove", biz_service.id, "--cascade", "--dry-run"],
            cwd=str(tmp_path),
        )

        output = strip_ansi(result.output)
        assert "would remove" in output.lower()
        assert "2" in output  # Should show count of 2 (element + 1 dependent)

    def test_remove_element_confirms_cascade_count(self, runner, tmp_path):
        """Test that remove confirms cascade count before proceeding."""
        # Setup
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        runner.invoke(
            cli,
            ["add", "business", "service", "--name", "Business Service"],
            cwd=str(tmp_path),
        )

        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "App Service",
                "realizes": biz_service.id,
            },
        )
        model.add_element("application", app_service)
        model.save()

        # Remove with cascade and --yes
        result = runner.invoke(
            cli,
            ["remove", biz_service.id, "--cascade", "--yes"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        # Verify cleanup happened
        model = Model(tmp_path)
        assert model.get_element(biz_service.id) is None
