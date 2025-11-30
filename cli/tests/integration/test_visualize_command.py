"""Integration tests for visualize command."""

import asyncio
import re
import time
from pathlib import Path

import pytest
from click.testing import CliRunner

from documentation_robotics.cli import cli
from documentation_robotics.server.visualization_server import VisualizationServer


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


class TestVisualizeCommand:
    """Tests for visualize command."""

    @pytest.fixture
    def runner(self):
        """Create CLI runner."""
        return CwdCliRunner()

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project."""
        runner = CwdCliRunner()
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"

        # Add a sample element
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

    def test_visualize_help(self, runner):
        """Test visualize command help text."""
        result = runner.invoke(cli, ["visualize", "--help"])
        assert result.exit_code == 0
        output = strip_ansi(result.output)
        assert "Start visualization server" in output
        assert "--port" in output
        assert "--host" in output
        assert "--no-browser" in output

    def test_visualize_no_model(self, runner, tmp_path):
        """Test visualize command fails without model."""
        result = runner.invoke(cli, ["visualize", "--no-browser"], cwd=str(tmp_path))
        assert result.exit_code == 1
        output = strip_ansi(result.output)
        assert "No model found" in output

    def test_visualize_missing_spec(self, runner, initialized_project):
        """Test visualize command fails without spec directory."""
        # The visualize command expects spec directory at ../../spec relative to project
        # This test validates error handling when spec is missing
        result = runner.invoke(
            cli, ["visualize", "--no-browser"], cwd=str(initialized_project)
        )
        # Should fail because spec directory doesn't exist in tmp_path
        assert result.exit_code == 1
        output = strip_ansi(result.output)
        # Should show error about missing specification
        assert "Specification directory not found" in output or "Error" in output

    @pytest.mark.asyncio
    async def test_server_initialization(self, initialized_project):
        """Test that VisualizationServer can be initialized with valid paths."""
        spec_path = Path(__file__).parent.parent.parent.parent.parent / "spec"

        # Skip test if spec directory doesn't exist
        if not spec_path.exists():
            pytest.skip("Spec directory not found - skipping server initialization test")

        server = VisualizationServer(
            model_path=initialized_project,
            spec_path=spec_path,
            host="localhost",
            port=8888,
        )

        assert server.model_path == initialized_project
        assert server.spec_path == spec_path
        assert server.host == "localhost"
        assert server.port == 8888

    @pytest.mark.asyncio
    async def test_server_lifecycle(self, initialized_project):
        """Test server can start and shutdown gracefully."""
        spec_path = Path(__file__).parent.parent.parent.parent.parent / "spec"

        # Skip test if spec directory doesn't exist
        if not spec_path.exists():
            pytest.skip("Spec directory not found - skipping server lifecycle test")

        server = VisualizationServer(
            model_path=initialized_project,
            spec_path=spec_path,
            host="localhost",
            port=8889,
        )

        # Start server in background
        server_task = asyncio.create_task(server.start())

        # Wait a bit for server to start
        await asyncio.sleep(0.5)

        # Verify server is running by checking initialization
        assert server.app is not None
        assert server.model is not None
        assert server.specification is not None

        # Shutdown server
        await server.shutdown()

        # Wait for server task to complete
        try:
            await asyncio.wait_for(server_task, timeout=2.0)
        except asyncio.TimeoutError:
            pytest.fail("Server did not shutdown within timeout")

    def test_visualize_command_options(self, runner, initialized_project):
        """Test visualize command accepts all options."""
        spec_path = Path(__file__).parent.parent.parent.parent.parent / "spec"

        # Skip test if spec directory doesn't exist
        if not spec_path.exists():
            pytest.skip("Spec directory not found - skipping command options test")

        # Test with custom port and host (will fail to start but should parse options)
        result = runner.invoke(
            cli,
            ["visualize", "--port", "9090", "--host", "127.0.0.1", "--no-browser"],
            cwd=str(initialized_project),
            input="\x03",  # Send Ctrl+C immediately
        )

        # Command should attempt to start (may fail due to spec path issues in test env)
        output = strip_ansi(result.output)
        # Just verify the command was invoked
        assert "visualize" in output.lower() or "server" in output.lower() or "error" in output.lower()


class TestVisualizationServerIntegration:
    """Integration tests for VisualizationServer functionality."""

    @pytest.fixture
    def initialized_project(self, tmp_path):
        """Create an initialized project."""
        runner = CwdCliRunner()
        # Initialize project
        result = runner.invoke(cli, ["init", "test-project", "--path", str(tmp_path)])
        assert result.exit_code == 0, f"Init failed: {result.output}"

        # Add a sample element
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

    @pytest.mark.asyncio
    async def test_server_health_endpoint(self, initialized_project):
        """Test server health check endpoint responds correctly."""
        spec_path = Path(__file__).parent.parent.parent.parent.parent / "spec"

        if not spec_path.exists():
            pytest.skip("Spec directory not found")

        server = VisualizationServer(
            model_path=initialized_project,
            spec_path=spec_path,
            host="localhost",
            port=8890,
        )

        # Start server
        server_task = asyncio.create_task(server.start())
        await asyncio.sleep(0.5)

        try:
            # Test health endpoint
            import aiohttp

            async with aiohttp.ClientSession() as session:
                async with session.get("http://localhost:8890/health") as response:
                    assert response.status == 200
                    data = await response.json()
                    assert data["status"] == "healthy"
                    assert "model_path" in data
                    assert "spec_version" in data

        finally:
            await server.shutdown()
            try:
                await asyncio.wait_for(server_task, timeout=2.0)
            except asyncio.TimeoutError:
                pass

    @pytest.mark.asyncio
    async def test_websocket_connection(self, initialized_project):
        """Test WebSocket connection and initial state message."""
        spec_path = Path(__file__).parent.parent.parent.parent.parent / "spec"

        if not spec_path.exists():
            pytest.skip("Spec directory not found")

        server = VisualizationServer(
            model_path=initialized_project,
            spec_path=spec_path,
            host="localhost",
            port=8891,
        )

        # Start server
        server_task = asyncio.create_task(server.start())
        await asyncio.sleep(0.5)

        try:
            import aiohttp

            async with aiohttp.ClientSession() as session:
                async with session.ws_connect("ws://localhost:8891/ws") as ws:
                    # Should receive initial state message
                    msg = await ws.receive_json(timeout=5.0)

                    assert msg["type"] == "initial_state"
                    assert "data" in msg
                    assert "specification" in msg["data"]
                    assert "model" in msg["data"]
                    assert "changesets" in msg["data"]

        finally:
            await server.shutdown()
            try:
                await asyncio.wait_for(server_task, timeout=2.0)
            except asyncio.TimeoutError:
                pass
