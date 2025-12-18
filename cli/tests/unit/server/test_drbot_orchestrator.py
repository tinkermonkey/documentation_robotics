"""Tests for DrBot orchestrator."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from documentation_robotics.server.drbot_orchestrator import (
    DRBOT_SYSTEM_PROMPT,
    HAS_ANTHROPIC,
    DrBotOrchestrator,
)


@pytest.fixture
def mock_model_path(tmp_path):
    """Create a mock model directory structure."""
    # Create manifest
    dr_dir = tmp_path / ".dr"
    dr_dir.mkdir()

    manifest_path = dr_dir / "manifest.yaml"
    manifest_path.write_text(
        """
name: Test Model
specVersion: 0.5.0
description: Test DR model
"""
    )

    # Create model directory with some layers
    model_dir = tmp_path / "model"
    model_dir.mkdir()

    # Create business layer with services
    business_dir = model_dir / "business" / "service"
    business_dir.mkdir(parents=True)
    (business_dir / "orders.yaml").write_text("id: business.service.orders\n")
    (business_dir / "payments.yaml").write_text("id: business.service.payments\n")

    # Create application layer
    app_dir = model_dir / "application" / "service"
    app_dir.mkdir(parents=True)
    (app_dir / "order-api.yaml").write_text("id: application.service.order-api\n")

    return tmp_path


class TestDrBotOrchestrator:
    """Tests for DrBotOrchestrator."""

    def test_init(self, mock_model_path):
        """Test orchestrator initialization."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        assert orchestrator.model_path == mock_model_path
        assert orchestrator.timeout == 120

    def test_init_custom_timeout(self, mock_model_path):
        """Test orchestrator with custom timeout."""
        orchestrator = DrBotOrchestrator(mock_model_path, timeout=60)

        assert orchestrator.timeout == 60

    def test_build_model_context(self, mock_model_path):
        """Test building model context from directory structure."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()

        # Check manifest was loaded
        assert "manifest" in context
        assert context["manifest"]["name"] == "Test Model"
        assert context["manifest"]["specVersion"] == "0.5.0"

        # Check layer stats
        assert "layer_stats" in context
        assert context["layer_stats"]["business"] == 2  # 2 services
        assert context["layer_stats"]["application"] == 1  # 1 service

        # Check recent elements
        assert "recent_elements" in context
        assert len(context["recent_elements"]) > 0

    def test_build_model_context_missing_manifest(self, tmp_path):
        """Test building context when manifest is missing."""
        orchestrator = DrBotOrchestrator(tmp_path)
        context = orchestrator.build_model_context()

        # Should still return context without manifest
        assert "manifest" not in context
        assert "layer_stats" in context
        assert "recent_elements" in context

    def test_build_system_prompt_basic(self, mock_model_path):
        """Test building system prompt with basic context."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()

        prompt = orchestrator._build_system_prompt(context)

        # Check prompt contains key sections
        assert DRBOT_SYSTEM_PROMPT in prompt
        assert "Current Model Context" in prompt
        assert "Test Model" in prompt
        assert "0.5.0" in prompt
        assert "Layer Statistics" in prompt
        assert "business: 2" in prompt
        assert "application: 1" in prompt

    def test_build_system_prompt_with_conversation_history(self, mock_model_path):
        """Test building system prompt with conversation history."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()
        history = "User: List all services\nDrBot: Found 3 services"

        prompt = orchestrator._build_system_prompt(context, history)

        assert "Recent Conversation" in prompt
        assert history in prompt

    def test_build_system_prompt_empty_context(self, mock_model_path):
        """Test building system prompt with empty context."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        prompt = orchestrator._build_system_prompt({})

        # Should still contain base prompt
        assert DRBOT_SYSTEM_PROMPT in prompt

    @pytest.mark.asyncio
    async def test_execute_cli_success(self, mock_model_path):
        """Test executing CLI command successfully."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        # Mock subprocess
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate.return_value = (
            b'[{"id": "business.service.orders"}]',
            b"",
        )

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
            result = await orchestrator._execute_cli(["dr", "list", "business"])

            # Check command was executed
            mock_exec.assert_called_once()
            args = mock_exec.call_args[0]
            assert args == ("dr", "list", "business")

            # Check cwd was set
            assert mock_exec.call_args[1]["cwd"] == str(mock_model_path)

            # Check result
            result_data = json.loads(result)
            assert result_data[0]["id"] == "business.service.orders"

    @pytest.mark.asyncio
    async def test_execute_cli_error(self, mock_model_path):
        """Test executing CLI command that fails."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        # Mock subprocess with error
        mock_proc = AsyncMock()
        mock_proc.returncode = 1
        mock_proc.communicate.return_value = (b"", b"Error: Layer not found")

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await orchestrator._execute_cli(["dr", "list", "invalid"])

            # Check error response
            result_data = json.loads(result)
            assert "error" in result_data
            assert "Layer not found" in result_data["error"]
            assert result_data["returncode"] == 1

    @pytest.mark.asyncio
    async def test_execute_cli_timeout(self, mock_model_path):
        """Test CLI command timeout."""
        orchestrator = DrBotOrchestrator(mock_model_path, timeout=0.1)

        # Mock subprocess that hangs
        mock_proc = AsyncMock()
        mock_proc.returncode = None  # Process still running
        # Mock stdin (StreamWriter with close())
        mock_stdin = MagicMock()
        mock_stdin.is_closing.return_value = False
        mock_proc.stdin = mock_stdin
        # stdout/stderr are StreamReaders (no close() method)
        mock_proc.stdout = MagicMock()
        mock_proc.stderr = MagicMock()

        async def slow_communicate():
            """Simulate a slow subprocess."""
            await asyncio.sleep(10)  # Much longer than timeout
            return (b"", b"")

        async def mock_wait():
            """Mock wait that sets returncode."""
            mock_proc.returncode = -9  # Killed
            return -9

        def mock_kill():
            """Mock kill method (not async)."""
            pass

        mock_proc.communicate = slow_communicate
        mock_proc.wait = mock_wait
        mock_proc.kill = MagicMock(side_effect=mock_kill)  # Make kill() sync

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await orchestrator._execute_cli(["dr", "list", "business"])

            # Check timeout error
            result_data = json.loads(result)
            assert "error" in result_data
            assert "timed out" in result_data["error"].lower()
            mock_proc.kill.assert_called()
            # Verify stdin was closed before killing
            mock_stdin.close.assert_called()

    @pytest.mark.asyncio
    async def test_execute_cli_not_found(self, mock_model_path):
        """Test CLI command not found."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        with patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError()):
            result = await orchestrator._execute_cli(["dr", "list", "business"])

            # Check not found error
            result_data = json.loads(result)
            assert "error" in result_data
            assert "not found" in result_data["error"].lower()

    @pytest.mark.asyncio
    async def test_execute_cli_unexpected_error(self, mock_model_path):
        """Test CLI command with unexpected error."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        with patch("asyncio.create_subprocess_exec", side_effect=RuntimeError("Test error")):
            result = await orchestrator._execute_cli(["dr", "list", "business"])

            # Check unexpected error
            result_data = json.loads(result)
            assert "error" in result_data
            assert "Test error" in result_data["error"]

    def test_load_dr_architect_prompt_exists(self, tmp_path):
        """Test loading dr-architect prompt when file exists."""
        # Create a temporary model path
        model_path = tmp_path / "test_model"
        model_path.mkdir()

        # Create mock dr-architect.md
        integration_path = (
            model_path.parent.parent
            / "src"
            / "documentation_robotics"
            / "claude_integration"
            / "agents"
        )
        integration_path.mkdir(parents=True, exist_ok=True)
        architect_file = integration_path / "dr-architect.md"
        architect_file.write_text("# Custom DR Architect Prompt\nTest content")

        orchestrator = DrBotOrchestrator(model_path)
        prompt = orchestrator._load_dr_architect_prompt()

        assert "Custom DR Architect Prompt" in prompt
        assert "Test content" in prompt

    def test_load_dr_architect_prompt_custom_dir(self, tmp_path):
        """Test loading dr-architect prompt from custom agents_dir."""
        model_path = tmp_path / "test_model"
        model_path.mkdir()

        # Create custom agents directory
        custom_agents_dir = tmp_path / "custom_agents"
        custom_agents_dir.mkdir()
        architect_file = custom_agents_dir / "dr-architect.md"
        architect_file.write_text("# Custom Agents Dir Prompt\nCustom content")

        orchestrator = DrBotOrchestrator(model_path, agents_dir=custom_agents_dir)
        prompt = orchestrator._load_dr_architect_prompt()

        assert "Custom Agents Dir Prompt" in prompt
        assert "Custom content" in prompt

    def test_load_dr_architect_prompt_fallback(self, tmp_path):
        """Test fallback prompt when dr-architect.md doesn't exist."""
        # Create a model path with a unique structure that won't find the integration file
        model_path = tmp_path / "isolated" / "test_model"
        model_path.mkdir(parents=True)

        orchestrator = DrBotOrchestrator(model_path)
        prompt = orchestrator._load_dr_architect_prompt()

        # Should return fallback prompt
        assert "dr-architect" in prompt
        assert "Documentation Robotics" in prompt

    def test_create_dr_list_tool(self, mock_model_path):
        """Test dr_list tool creation."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        tool_def = orchestrator._create_dr_list_tool()

        # Check tool was created
        # Can be a SdkMcpTool (when SDK available), callable, or dict
        assert tool_def is not None
        assert (
            callable(tool_def)
            or isinstance(tool_def, dict)
            or hasattr(tool_def, "name")  # SdkMcpTool has a 'name' attribute
        )

    def test_create_dr_find_tool(self, mock_model_path):
        """Test dr_find tool creation."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        tool_def = orchestrator._create_dr_find_tool()

        # Check tool was created
        assert tool_def is not None

    def test_create_dr_search_tool(self, mock_model_path):
        """Test dr_search tool creation."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        tool_def = orchestrator._create_dr_search_tool()

        # Check tool was created
        assert tool_def is not None

    def test_create_dr_trace_tool(self, mock_model_path):
        """Test dr_trace tool creation."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        tool_def = orchestrator._create_dr_trace_tool()

        # Check tool was created
        assert tool_def is not None

    def test_create_dr_architect_tool(self, mock_model_path):
        """Test dr_architect delegation tool creation."""
        orchestrator = DrBotOrchestrator(mock_model_path)

        tool_def = orchestrator._create_dr_architect_tool()

        # Check tool was created
        assert tool_def is not None

    @pytest.mark.asyncio
    @pytest.mark.skipif(not HAS_ANTHROPIC, reason="Anthropic SDK not installed")
    async def test_handle_message_real_sdk_integration(self, mock_model_path):
        """
        Test handle_message with real Anthropic API (no mocking).

        This verifies that we're using the Anthropic API directly
        instead of the broken subprocess approach.
        """

        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()

        # Call the real SDK code path
        messages = []
        generator = None
        try:
            generator = orchestrator.handle_message(
                "How many layers are in this model?", context
            )
            async for message in generator:
                messages.append(message)
                if len(messages) >= 1:
                    break
            # If we got here with valid API key, great!
            assert len(messages) > 0
        except Exception as e:
            # Without valid API key, we expect authentication error
            # NOT subprocess transport error
            error_str = str(e).lower()

            # These errors are ACCEPTABLE (prove we're using Anthropic API):
            if "authentication" in error_str or "api" in error_str or "401" in error_str:
                # Good! We're calling Anthropic API, just need valid key
                return

            # These errors mean we're BROKEN (subprocess issues):
            if "processtransport" in error_str or "subprocess" in error_str or "cli" in error_str:
                pytest.fail(f"Still using subprocess approach! Error: {e}")

            # Unknown error - let it fail
            raise
        finally:
            # Properly close the async generator to prevent ResourceWarning
            if generator is not None:
                await generator.aclose()


class TestDrBotSystemPrompt:
    """Tests for DrBot system prompt structure."""

    def test_system_prompt_contains_expertise(self):
        """Test that system prompt describes DrBot's expertise."""
        assert "DrBot" in DRBOT_SYSTEM_PROMPT
        assert "12-layer" in DRBOT_SYSTEM_PROMPT
        assert "Documentation Robotics" in DRBOT_SYSTEM_PROMPT

    def test_system_prompt_lists_layers(self):
        """Test that system prompt lists all 12 layers."""
        layers = [
            "Motivation",
            "Business",
            "Security",
            "Application",
            "Technology",
            "API",
            "Data Model",
            "Datastore",
            "UX",
            "Navigation",
            "APM",
            "Testing",
        ]

        for layer in layers:
            assert layer in DRBOT_SYSTEM_PROMPT

    def test_system_prompt_describes_tools(self):
        """Test that system prompt describes available tools."""
        tools = ["dr_list", "dr_find", "dr_search", "dr_trace", "delegate_to_architect"]

        for tool in tools:
            assert tool in DRBOT_SYSTEM_PROMPT

    def test_system_prompt_provides_guidelines(self):
        """Test that system prompt provides usage guidelines."""
        assert "When to Use Tools" in DRBOT_SYSTEM_PROMPT
        assert "Guidelines" in DRBOT_SYSTEM_PROMPT
        assert "understand before acting" in DRBOT_SYSTEM_PROMPT.lower()


class TestModelContext:
    """Tests for model context building."""

    def test_context_with_all_components(self, mock_model_path):
        """Test building context with all components present."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()

        # Check all expected keys
        assert "manifest" in context
        assert "layer_stats" in context
        assert "recent_elements" in context

        # Check manifest details
        assert context["manifest"]["name"] == "Test Model"

        # Check layer stats
        assert isinstance(context["layer_stats"], dict)
        assert len(context["layer_stats"]) > 0

        # Check recent elements
        assert isinstance(context["recent_elements"], list)

    def test_context_recent_elements_limit(self, mock_model_path):
        """Test that recent elements are limited to 10."""
        # Create more than 10 elements
        model_dir = mock_model_path / "model" / "test_layer" / "test_type"
        model_dir.mkdir(parents=True)

        for i in range(15):
            (model_dir / f"element{i}.yaml").write_text(f"id: test.element{i}\n")

        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()

        # Should have at most 10 recent elements
        assert len(context["recent_elements"]) <= 10

    def test_context_layer_stats_ignores_hidden(self, mock_model_path):
        """Test that layer stats ignore hidden files."""
        # Create hidden files
        model_dir = mock_model_path / "model" / "business" / "service"
        (model_dir / ".hidden.yaml").write_text("id: hidden\n")

        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()

        # Hidden files should not be counted
        # We had 2 services, should still be 2
        assert context["layer_stats"]["business"] == 2

    def test_context_empty_model_directory(self, tmp_path):
        """Test context with empty model directory."""
        model_dir = tmp_path / "model"
        model_dir.mkdir()

        orchestrator = DrBotOrchestrator(tmp_path)
        context = orchestrator.build_model_context()

        # Should have empty stats and elements
        assert context["layer_stats"] == {}
        assert context["recent_elements"] == []
