"""Integration tests for trace command."""

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


class TestTraceCommand:
    """Tests for trace command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def project_with_dependencies(self, tmp_path):
        """Create project with elements that have dependencies."""
        runner = CwdCliRunner()
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0

        # Add business service
        result = runner.invoke(
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
        assert result.exit_code == 0

        # Get the business service ID
        model = Model(tmp_path)
        biz_service = list(model.get_layer("business").list_elements())[0]

        # Add application service that realizes business service
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

        # Add API operation that uses application service
        api_operation = Element(
            id="api.operation.get-users",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.get-users",
                "name": "Get Users",
                "uses": "application.service.app-service",
            },
        )
        model.add_element("api", api_operation)

        model.save()
        yield tmp_path

    def test_trace_nonexistent_element(self, runner, tmp_path):
        """Test tracing nonexistent element."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        result = runner.invoke(
            cli,
            ["trace", "business.service.nonexistent"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "not found" in output.lower()

    def test_trace_no_model_in_directory(self, runner, tmp_path):
        """Test trace command when no model exists."""
        result = runner.invoke(
            cli,
            ["trace", "business.service.test"],
            cwd=str(tmp_path),
        )

        assert result.exit_code != 0
        output = strip_ansi(result.output)
        assert "no model" in output.lower()

    def test_trace_element_with_no_dependencies(self, runner, tmp_path):
        """Test tracing element with no dependencies."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Add element without dependencies
        result = runner.invoke(
            cli,
            ["add", "business", "service", "--name", "Isolated Service"],
            cwd=str(tmp_path),
        )
        assert result.exit_code == 0

        # Get the element ID
        model = Model(tmp_path)
        elements = list(model.get_layer("business").list_elements())
        element_id = elements[0].id

        result = runner.invoke(
            cli,
            ["trace", element_id],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "No dependencies found" in output or "no dependencies" in output.lower()

    def test_trace_default_direction_both(self, runner, project_with_dependencies):
        """Test trace with default direction (both)."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Tracing dependencies" in output
        assert "both" in output.lower()

    def test_trace_direction_up(self, runner, project_with_dependencies):
        """Test tracing dependencies upward."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id, "--direction", "up"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Direction: up" in output

    def test_trace_direction_down(self, runner, project_with_dependencies):
        """Test tracing dependents downward."""
        model = Model(project_with_dependencies)
        biz_services = list(model.get_layer("business").list_elements())
        biz_service_id = biz_services[0].id

        result = runner.invoke(
            cli,
            ["trace", biz_service_id, "--direction", "down"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Direction: down" in output

    def test_trace_with_max_depth(self, runner, project_with_dependencies):
        """Test trace with max depth limit."""
        model = Model(project_with_dependencies)
        biz_services = list(model.get_layer("business").list_elements())
        biz_service_id = biz_services[0].id

        result = runner.invoke(
            cli,
            ["trace", biz_service_id, "--max-depth", "1"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Max depth: 1" in output

    def test_trace_output_tree(self, runner, project_with_dependencies):
        """Test trace with tree output (default)."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id, "--output", "tree"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Tree output contains the element ID
        assert app_service.id in output

    def test_trace_output_table(self, runner, project_with_dependencies):
        """Test trace with table output."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id, "--output", "table"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Table output has "Dependencies" header
        assert "Dependencies" in output or "Element ID" in output

    def test_trace_output_list(self, runner, project_with_dependencies):
        """Test trace with list output."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id, "--output", "list"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # List output shows bullet points
        assert "•" in output or "Tracing dependencies" in output

    def test_trace_group_by_layer(self, runner, project_with_dependencies):
        """Test trace with group-by-layer flag."""
        model = Model(project_with_dependencies)
        biz_services = list(model.get_layer("business").list_elements())
        biz_service_id = biz_services[0].id

        result = runner.invoke(
            cli,
            ["trace", biz_service_id, "--group-by-layer"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Group by layer should show layer names
        assert "application:" in output or "layer" in output.lower()

    def test_trace_shows_element_name(self, runner, project_with_dependencies):
        """Test that trace shows element names."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show element name
        assert "App Service" in output

    def test_trace_complex_dependency_chain(self, runner, tmp_path):
        """Test tracing through complex dependency chain."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        # Create a chain: Business -> Application -> API -> UX
        model = Model(tmp_path)

        # Add business service
        biz_service = Element(
            id="business.service.biz-service",
            element_type="service",
            layer="business",
            data={
                "id": "business.service.biz-service",
                "name": "Business Service",
            },
        )
        model.add_element("business", biz_service)

        # Add application service
        app_service = Element(
            id="application.service.app-service",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.app-service",
                "name": "Application Service",
                "realizes": "business.service.biz-service",
            },
        )
        model.add_element("application", app_service)

        # Add API operation
        api_operation = Element(
            id="api.operation.get-data",
            element_type="operation",
            layer="api",
            data={
                "id": "api.operation.get-data",
                "name": "Get Data",
                "uses": "application.service.app-service",
            },
        )
        model.add_element("api", api_operation)

        # Add UX screen
        ux_screen = Element(
            id="ux.screen.dashboard",
            element_type="screen",
            layer="ux",
            data={
                "id": "ux.screen.dashboard",
                "name": "Dashboard",
                "uses": "api.operation.get-data",
            },
        )
        model.add_element("ux", ux_screen)

        model.save()

        # Trace from business service
        result = runner.invoke(
            cli,
            ["trace", "business.service.biz-service", "--direction", "down"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show the chain
        assert "business.service.biz-service" in output

    def test_trace_multiple_dependencies(self, runner, tmp_path):
        """Test tracing element with multiple dependencies."""
        runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])

        model = Model(tmp_path)

        # Add multiple business services
        for i in [1, 2, 3]:
            biz_service = Element(
                id=f"business.service.biz-service-{i}",
                element_type="service",
                layer="business",
                data={
                    "id": f"business.service.biz-service-{i}",
                    "name": f"Business Service {i}",
                },
            )
            model.add_element("business", biz_service)

        # Add application service that realizes all of them
        app_service = Element(
            id="application.service.composite",
            element_type="service",
            layer="application",
            data={
                "id": "application.service.composite",
                "name": "Composite Service",
                "realizes": [
                    "business.service.biz-service-1",
                    "business.service.biz-service-2",
                    "business.service.biz-service-3",
                ],
            },
        )
        model.add_element("application", app_service)

        model.save()

        # Trace the composite service
        result = runner.invoke(
            cli,
            ["trace", "application.service.composite", "--direction", "up"],
            cwd=str(tmp_path),
        )

        assert result.exit_code == 0
        # Command should complete successfully

    def test_trace_with_all_options(self, runner, project_with_dependencies):
        """Test trace with all options combined."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            [
                "trace",
                app_service.id,
                "--direction",
                "both",
                "--max-depth",
                "2",
                "--output",
                "table",
            ],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Direction: both" in output
        assert "Max depth: 2" in output

    def test_trace_shows_layer_info(self, runner, project_with_dependencies):
        """Test that trace shows layer information."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id, "--output", "list"],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        # Should show element information in list format
        assert "Tracing dependencies" in output or "•" in output

    def test_trace_element_id_shown_in_output(self, runner, project_with_dependencies):
        """Test that element ID is shown in trace output."""
        model = Model(project_with_dependencies)
        app_service = model.get_element("application.service.app-service")

        result = runner.invoke(
            cli,
            ["trace", app_service.id],
            cwd=str(project_with_dependencies),
        )

        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert app_service.id in output
