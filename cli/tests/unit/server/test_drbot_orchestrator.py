"""Tests for DrBot orchestrator."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from documentation_robotics.server.drbot_orchestrator import (
    DRBOT_SYSTEM_PROMPT,
    HAS_SDK,
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
        # Use MagicMock for the process to avoid making kill() async
        mock_proc = MagicMock()

        async def slow_communicate():
            """Simulate a slow subprocess."""
            await asyncio.sleep(10)  # Much longer than timeout
            return (b"", b"")

        mock_proc.communicate = slow_communicate

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            result = await orchestrator._execute_cli(["dr", "list", "business"])

            # Check timeout error
            result_data = json.loads(result)
            assert "error" in result_data
            assert "timed out" in result_data["error"].lower()
            mock_proc.kill.assert_called_once()

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

        # Check tool was created (it's a function when SDK not available)
        assert tool_def is not None
        assert callable(tool_def) or isinstance(tool_def, dict)

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
    async def test_dr_list_tool_end_to_end(self, mock_model_path):
        """Test dr_list tool executes CLI command correctly."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        tool_func = orchestrator._create_dr_list_tool()

        # Mock subprocess
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate.return_value = (
            b'[{"id": "business.service.orders"}]',
            b"",
        )

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
            # Get the actual implementation function
            if HAS_SDK:
                # Tool decorator returns the function directly when SDK is available
                result = await tool_func("business", "service")
            else:
                # Without SDK, tool() is a passthrough
                result = await tool_func("business", "service")

            # Verify CLI command was called correctly
            mock_exec.assert_called_once()
            args = mock_exec.call_args[0]
            assert args == ("dr", "list", "business", "service", "--output", "json")

            # Verify result
            result_data = json.loads(result)
            assert result_data[0]["id"] == "business.service.orders"

    @pytest.mark.asyncio
    async def test_dr_list_tool_invalid_layer(self, mock_model_path):
        """Test dr_list tool rejects invalid layer names."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        tool_func = orchestrator._create_dr_list_tool()

        # Call with invalid layer
        if HAS_SDK:
            result = await tool_func("invalid_layer")
        else:
            result = await tool_func("invalid_layer")

        result_data = json.loads(result)
        assert "error" in result_data
        assert "Invalid layer" in result_data["error"]
        assert "valid_layers" in result_data

    @pytest.mark.asyncio
    async def test_dr_find_tool_end_to_end(self, mock_model_path):
        """Test dr_find tool executes CLI command correctly."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        tool_func = orchestrator._create_dr_find_tool()

        # Mock subprocess
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate.return_value = (
            b'{"id": "business.service.orders", "name": "Orders"}',
            b"",
        )

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
            if HAS_SDK:
                result = await tool_func("business.service.orders")
            else:
                result = await tool_func("business.service.orders")

            # Verify CLI command
            args = mock_exec.call_args[0]
            assert args == ("dr", "find", "business.service.orders", "--output", "json")

            # Verify result
            result_data = json.loads(result)
            assert result_data["id"] == "business.service.orders"

    @pytest.mark.asyncio
    async def test_dr_search_tool_end_to_end(self, mock_model_path):
        """Test dr_search tool executes CLI command correctly."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        tool_func = orchestrator._create_dr_search_tool()

        # Mock subprocess
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate.return_value = (
            b'[{"id": "business.service.orders", "matches": ["order"]}]',
            b"",
        )

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
            if HAS_SDK:
                result = await tool_func("order")
            else:
                result = await tool_func("order")

            # Verify CLI command
            args = mock_exec.call_args[0]
            assert args == ("dr", "search", "order", "--output", "json")

            # Verify result
            result_data = json.loads(result)
            assert len(result_data) > 0

    @pytest.mark.asyncio
    async def test_dr_trace_tool_end_to_end(self, mock_model_path):
        """Test dr_trace tool executes CLI command correctly."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        tool_func = orchestrator._create_dr_trace_tool()

        # Mock subprocess
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate.return_value = (
            b'{"element": "api.operation.create-order", "dependencies": []}',
            b"",
        )

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
            if HAS_SDK:
                result = await tool_func("api.operation.create-order")
            else:
                result = await tool_func("api.operation.create-order")

            # Verify CLI command
            args = mock_exec.call_args[0]
            assert args == ("dr", "trace", "api.operation.create-order", "--output", "json")

            # Verify result
            result_data = json.loads(result)
            assert result_data["element"] == "api.operation.create-order"

    @pytest.mark.asyncio
    @pytest.mark.skipif(not HAS_SDK, reason="Claude Agent SDK not installed")
    async def test_handle_message(self, mock_model_path):
        """Test handling a user message."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()

        # Mock the query function from SDK
        async def mock_query(*args, **kwargs):
            """Mock query that yields a simple text response."""
            yield MagicMock(
                role="assistant",
                content=[MagicMock(type="text", text="This is a test response")],
            )

        with patch("documentation_robotics.server.drbot_orchestrator.query", mock_query):
            messages = []
            async for message in orchestrator.handle_message("List all services", context):
                messages.append(message)

            # Check we got a response
            assert len(messages) > 0

    @pytest.mark.asyncio
    @pytest.mark.skipif(not HAS_SDK, reason="Claude Agent SDK not installed")
    async def test_handle_message_with_history(self, mock_model_path):
        """Test handling message with conversation history."""
        orchestrator = DrBotOrchestrator(mock_model_path)
        context = orchestrator.build_model_context()
        history = "User: What layers exist?\nDrBot: I found business and application layers"

        async def mock_query(*args, **kwargs):
            """Mock query that yields a response."""
            # Check that system prompt includes history
            options = kwargs.get("options")
            if options:
                system_prompt = options.system_prompt
                assert "Recent Conversation" in system_prompt
                assert history in system_prompt

            yield MagicMock(
                role="assistant",
                content=[MagicMock(type="text", text="Response")],
            )

        with patch("documentation_robotics.server.drbot_orchestrator.query", mock_query):
            messages = []
            async for message in orchestrator.handle_message(
                "Show me the business services", context, history
            ):
                messages.append(message)

            assert len(messages) > 0


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
