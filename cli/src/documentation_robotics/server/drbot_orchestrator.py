"""
DrBot Orchestrator - Claude-native intent routing for DR model interaction.

DrBot uses Claude's reasoning for all decisions, with access to:
1. DR CLI tools for read operations (dr find, dr list, dr search, dr trace)
2. Delegation to dr-architect for model modifications via SDK agents
"""

import asyncio
import json
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

import yaml

try:
    from claude_agent_sdk import (
        AgentMessage,
        AssistantMessage,
        ClaudeAgentOptions,
        ResultMessage,
        TextBlock,
        ToolUseBlock,
        query,
        tool,
    )

    HAS_SDK = True
except ImportError:
    # SDK not available - define placeholder types for tests
    HAS_SDK = False
    AgentMessage = Any
    AssistantMessage = Any
    ClaudeAgentOptions = Any
    ResultMessage = Any
    TextBlock = Any
    ToolUseBlock = Any

    def query(*args, **kwargs):
        """Placeholder for SDK query function."""
        raise ImportError("Claude Agent SDK not installed")

    def tool(*args, **kwargs):
        """Placeholder for SDK tool decorator."""

        def decorator(func):
            return func

        return decorator


# System prompt incorporating dr-architect expertise
DRBOT_SYSTEM_PROMPT = """You are DrBot, an expert conversational assistant for Documentation Robotics (DR) models.

## Your Expertise

You understand the **full 12-layer DR architecture** (note that layers are numbered 00-10, plus 12 for Testing):
1. Motivation (Layer 00) - WHY: goals, principles, requirements, constraints
2. Business (Layer 01) - WHAT: capabilities, processes, services, actors
3. Security (Layer 02) - WHO/PROTECTION: actors, roles, policies, threats
4. Application (Layer 03) - HOW: components, services, interfaces, events
5. Technology (Layer 04) - WITH: platforms, frameworks, infrastructure
6. API (Layer 05) - CONTRACTS: OpenAPI 3.0.3 specs (26 entity types)
7. Data Model (Layer 06) - STRUCTURE: JSON Schema Draft 7 (17 entity types)
8. Datastore (Layer 07) - PERSISTENCE: SQL DDL (10 entity types)
9. UX (Layer 08) - EXPERIENCE: Three-Tier Architecture (26 entity types)
10. Navigation (Layer 09) - FLOW: Multi-Modal routing (10 entity types)
11. APM (Layer 10) - OBSERVE: OpenTelemetry 1.0+ (14 entity types)
12. Testing (Layer 12) - VERIFY: ISP Coverage Model (17 entity types)

## Your Tools

You have access to tools that:
- **Query the model**: Find, list, search, and trace elements
- **Modify the model**: Delegate complex modeling tasks to dr-architect agent

## Your Approach

1. **Understand user intent** through conversation, not keyword matching
2. **Use appropriate tools** based on what the user needs
3. **Chain operations** when needed (e.g., search then trace dependencies)
4. **Provide context** from the current model state
5. **Delegate to dr-architect** for creating or modifying elements
6. **Explain results** in a conversational, helpful way

## When to Use Tools

**dr_list**: List all elements of a specific type in a layer
- Example: "Show me all API operations"

**dr_find**: Get details about a specific element by ID
- Example: "What is business.service.orders?"

**dr_search**: Search for elements by pattern or keyword
- Example: "Find anything related to payments"

**dr_trace**: Trace cross-layer dependencies for an element
- Example: "What depends on the Order API?"

**delegate_to_architect**: Create or modify model elements
- Example: "Add a new REST API endpoint for user login"
- Example: "Update the Orders service to link to the revenue goal"

## Guidelines

- Always **understand before acting** - ask clarifying questions if needed
- **Chain tools** when appropriate for complete answers
- **Provide context** from model state when explaining
- **Be conversational** - you're a helpful assistant, not just a CLI wrapper
- **Suggest next steps** when appropriate
- **Explain traceability** using cross-layer links when relevant
"""


class DrBotOrchestrator:
    """DrBot uses Claude directly for all decision-making."""

    def __init__(
        self,
        model_path: Path,
        timeout: int = 120,
        agents_dir: Optional[Path] = None,
    ):
        """
        Initialize DrBot orchestrator.

        Args:
            model_path: Path to the DR model directory
            timeout: Timeout in seconds for agent operations
            agents_dir: Optional path to agents directory; if None, uses default
                       location relative to model_path
        """
        self.model_path = Path(model_path)
        self.timeout = timeout
        self.agents_dir = agents_dir

    async def handle_message(
        self,
        user_message: str,
        context: Dict[str, Any],
        conversation_history: Optional[str] = None,
    ) -> AsyncIterator[AgentMessage]:
        """
        Handle a user message with Claude-native intent routing.

        Claude decides which tools to invoke based on user intent.

        Args:
            user_message: The user's message
            context: Model context (manifest summary, recent elements, etc.)
            conversation_history: Optional conversation history for context

        Yields:
            Agent messages from Claude (text responses, tool invocations, etc.)
        """
        # Build system prompt with current model context
        system_prompt = self._build_system_prompt(context, conversation_history)

        # Configure Claude with DR tools and dr-architect delegation
        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            tools=[
                self._create_dr_list_tool(),
                self._create_dr_find_tool(),
                self._create_dr_search_tool(),
                self._create_dr_trace_tool(),
                self._create_dr_architect_tool(),
            ],
            agents={
                "dr-architect": {
                    "description": (
                        "Expert DR modeler for creating and modifying elements. "
                        "Use this agent when the user wants to CREATE, MODIFY, or "
                        "UPDATE architectural elements."
                    ),
                    "prompt": self._load_dr_architect_prompt(),
                    "tools": ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
                }
            },
            cwd=str(self.model_path),
            permission_mode="acceptEdits",
        )

        # Let Claude decide what to do
        async for message in query(prompt=user_message, options=options):
            yield message

    def _build_system_prompt(
        self, context: Dict[str, Any], conversation_history: Optional[str] = None
    ) -> str:
        """
        Build system prompt with current model context.

        Args:
            context: Model context dictionary
            conversation_history: Optional conversation history

        Returns:
            Complete system prompt with context
        """
        prompt_parts = [DRBOT_SYSTEM_PROMPT]

        # Add model context
        if context:
            prompt_parts.append("\n## Current Model Context\n")

            if "manifest" in context:
                manifest = context["manifest"]
                prompt_parts.append(f"**Model**: {manifest.get('name', 'Unknown')}\n")
                prompt_parts.append(f"**Spec Version**: {manifest.get('specVersion', 'Unknown')}\n")

            if "layer_stats" in context:
                prompt_parts.append("\n**Layer Statistics**:\n")
                for layer, count in context["layer_stats"].items():
                    prompt_parts.append(f"- {layer}: {count} elements\n")

            if "recent_elements" in context:
                prompt_parts.append(
                    f"\n**Recent Elements**: {len(context['recent_elements'])} "
                    "elements recently modified\n"
                )

        # Add conversation history if provided
        if conversation_history:
            prompt_parts.append("\n## Recent Conversation\n")
            prompt_parts.append(conversation_history)
            prompt_parts.append("\n")

        return "".join(prompt_parts)

    def _create_dr_list_tool(self) -> Any:
        """Create tool wrapper for 'dr list' command."""

        # Valid DR layer names (based on layer file names in spec/)
        valid_layers = [
            "motivation",
            "business",
            "security",
            "application",
            "technology",
            "api",
            "data_model",
            "datastore",
            "ux",
            "navigation",
            "apm",
            "testing",
        ]

        async def dr_list_impl(layer: str, element_type: str = "") -> str:
            """
            List all elements of a specific type in a layer.

            Args:
                layer: The DR layer (e.g., 'api', 'business', 'application')
                       Valid layers: motivation, business, security, application,
                       technology, api, data_model, datastore, ux, navigation, apm, testing
                element_type: Optional element type (e.g., 'service', 'operation')

            Returns:
                JSON string with list of elements
            """
            # Validate layer name
            if layer not in valid_layers:
                return json.dumps(
                    {
                        "error": f"Invalid layer: {layer}. Valid layers: {', '.join(valid_layers)}",
                        "valid_layers": valid_layers,
                    }
                )

            cmd_parts = ["dr", "list", layer]
            if element_type:
                cmd_parts.append(element_type)
            cmd_parts.extend(["--output", "json"])

            result = await self._execute_cli(cmd_parts)
            return result

        return tool(
            name="dr_list",
            description=(
                "List all elements of a specific type in a DR layer. "
                "Use this to see what elements exist in a layer. "
                f"Valid layers: {', '.join(valid_layers)}"
            ),
            parameters={
                "layer": {
                    "type": "string",
                    "description": (
                        f"The DR layer name. Must be one of: {', '.join(valid_layers)}"
                    ),
                },
                "element_type": {
                    "type": "string",
                    "description": "Optional element type (e.g., 'service', 'operation')",
                },
            },
        )(dr_list_impl)

    def _create_dr_find_tool(self) -> Any:
        """Create tool wrapper for 'dr find' command."""

        async def dr_find_impl(element_id: str) -> str:
            """
            Get details about a specific element by ID.

            Args:
                element_id: The element ID (e.g., 'business.service.orders')

            Returns:
                JSON string with element details
            """
            cmd_parts = ["dr", "find", element_id, "--output", "json"]
            result = await self._execute_cli(cmd_parts)
            return result

        return tool(
            name="dr_find",
            description=(
                "Get detailed information about a specific DR element by its ID. "
                "Use this to inspect element properties, links, and metadata."
            ),
            parameters={
                "element_id": {
                    "type": "string",
                    "description": "The element ID (e.g., 'business.service.orders')",
                }
            },
        )(dr_find_impl)

    def _create_dr_search_tool(self) -> Any:
        """Create tool wrapper for 'dr search' command."""

        async def dr_search_impl(pattern: str) -> str:
            """
            Search for elements matching a pattern or keyword.

            Args:
                pattern: Search pattern (searches names, descriptions, properties)

            Returns:
                JSON string with matching elements
            """
            cmd_parts = ["dr", "search", pattern, "--output", "json"]
            result = await self._execute_cli(cmd_parts)
            return result

        return tool(
            name="dr_search",
            description=(
                "Search for DR elements by pattern or keyword. "
                "Searches element names, descriptions, and properties."
            ),
            parameters={
                "pattern": {
                    "type": "string",
                    "description": "Search pattern (e.g., 'payment', 'order', 'user')",
                }
            },
        )(dr_search_impl)

    def _create_dr_trace_tool(self) -> Any:
        """Create tool wrapper for 'dr trace' command."""

        async def dr_trace_impl(element_id: str) -> str:
            """
            Trace cross-layer dependencies for an element.

            Args:
                element_id: The element ID to trace

            Returns:
                JSON string with dependency trace
            """
            cmd_parts = ["dr", "trace", element_id, "--output", "json"]
            result = await self._execute_cli(cmd_parts)
            return result

        return tool(
            name="dr_trace",
            description=(
                "Trace cross-layer dependencies for a DR element. "
                "Shows what elements this element depends on and what depends on it."
            ),
            parameters={
                "element_id": {
                    "type": "string",
                    "description": "The element ID to trace (e.g., 'api.operation.create-order')",
                }
            },
        )(dr_trace_impl)

    def _create_dr_architect_tool(self) -> Any:
        """Create tool that delegates to dr-architect agent."""

        async def delegate_to_architect_impl(task_description: str) -> str:
            """
            Delegate a modeling task to the dr-architect agent.

            Use this when the user wants to CREATE, MODIFY, or UPDATE
            architectural elements.

            Args:
                task_description: Clear description of what to model/create

            Returns:
                Summary of what dr-architect accomplished
            """
            if not HAS_SDK:
                return json.dumps(
                    {
                        "error": "Claude Agent SDK not available. Cannot delegate to dr-architect.",
                        "task": task_description,
                    }
                )

            # Use SDK's query function to invoke the dr-architect subagent
            try:
                # Build the prompt for dr-architect
                prompt = f"Please help with the following modeling task: {task_description}"

                # Query the dr-architect agent
                responses = []
                async for message in query(
                    prompt=prompt,
                    options=ClaudeAgentOptions(
                        system_prompt=self._load_dr_architect_prompt(),
                        tools=["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
                        cwd=str(self.model_path),
                        permission_mode="acceptEdits",
                    ),
                ):
                    # Collect text responses from the agent
                    if hasattr(message, "content"):
                        for block in message.content:
                            if hasattr(block, "text"):
                                responses.append(block.text)

                # Return aggregated response
                if responses:
                    return json.dumps(
                        {
                            "success": True,
                            "task": task_description,
                            "result": "\n".join(responses),
                        }
                    )
                else:
                    return json.dumps(
                        {
                            "success": True,
                            "task": task_description,
                            "result": "dr-architect completed the task",
                        }
                    )

            except Exception as e:
                return json.dumps(
                    {
                        "error": f"Failed to delegate to dr-architect: {str(e)}",
                        "task": task_description,
                    }
                )

        return tool(
            name="delegate_to_architect",
            description=(
                "Delegate complex modeling tasks to dr-architect agent. "
                "Use this when the user wants to CREATE, MODIFY, or SUGGEST "
                "new architectural elements. The dr-architect agent has expertise "
                "in all DR workflows and will handle the modeling task with validation."
            ),
            parameters={
                "task_description": {
                    "type": "string",
                    "description": (
                        "Clear description of the modeling task "
                        "(e.g., 'Add a REST API endpoint for user login', "
                        "'Create a business service for order processing')"
                    ),
                }
            },
        )(delegate_to_architect_impl)

    async def _execute_cli(self, cmd_parts: List[str]) -> str:
        """
        Execute a DR CLI command and return results.

        Args:
            cmd_parts: Command parts list (e.g., ['dr', 'list', 'api'])

        Returns:
            JSON string with command results or error message
        """
        try:
            # Execute command with timeout
            proc = await asyncio.create_subprocess_exec(
                *cmd_parts,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.model_path),
            )

            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self.timeout)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                return json.dumps(
                    {
                        "error": f"Command timed out after {self.timeout} seconds",
                        "command": " ".join(cmd_parts),
                    }
                )

            if proc.returncode == 0:
                # Success - return stdout
                output = stdout.decode("utf-8").strip()
                if not output:
                    return json.dumps({"result": "Command succeeded with no output"})
                return output
            else:
                # Error - return stderr
                error_msg = stderr.decode("utf-8").strip()
                return json.dumps(
                    {
                        "error": error_msg or "Command failed",
                        "command": " ".join(cmd_parts),
                        "returncode": proc.returncode,
                    }
                )

        except FileNotFoundError:
            return json.dumps(
                {
                    "error": "DR CLI not found. Is it installed?",
                    "command": " ".join(cmd_parts),
                }
            )
        except Exception as e:
            return json.dumps(
                {"error": f"Unexpected error: {str(e)}", "command": " ".join(cmd_parts)}
            )

    def _load_dr_architect_prompt(self) -> str:
        """
        Load the dr-architect agent prompt from the integration directory.

        Returns:
            The dr-architect agent prompt content
        """
        # Try custom agents_dir first if provided
        if self.agents_dir:
            custom_path = self.agents_dir / "dr-architect.md"
            if custom_path.exists():
                return custom_path.read_text()

        # Try default location relative to model_path
        integration_path = (
            self.model_path.parent.parent
            / "src"
            / "documentation_robotics"
            / "claude_integration"
            / "agents"
            / "dr-architect.md"
        )

        if integration_path.exists():
            return integration_path.read_text()

        # Fallback to minimal prompt if file not found
        return """You are dr-architect, an expert in Documentation Robotics modeling.

You help users create and modify DR model elements using the CLI.
You validate all changes and maintain model quality.

Use CLI commands like:
- dr add <layer> <type> --name "Name" --description "Description"
- dr update <element-id> --set key=value
- dr validate --strict --validate-links

Always validate after changes and explain what you're doing."""

    def build_model_context(self) -> Dict[str, Any]:
        """
        Build model context from the current model state.

        This is called by the chat handler to provide context to DrBot.

        Returns:
            Dictionary with model context information
        """
        context: Dict[str, Any] = {}

        # Load manifest if it exists
        manifest_path = self.model_path / ".dr" / "manifest.yaml"
        if manifest_path.exists():
            try:
                with open(manifest_path) as f:
                    context["manifest"] = yaml.safe_load(f)
            except Exception:
                pass

        # Get layer statistics by counting model files
        model_dir = self.model_path / "model"
        layer_stats = {}
        if model_dir.exists():
            for layer_dir in model_dir.iterdir():
                if layer_dir.is_dir() and not layer_dir.name.startswith("."):
                    # Count YAML files recursively
                    count = sum(1 for _ in layer_dir.rglob("*.yaml") if not _.name.startswith("."))
                    if count > 0:
                        layer_stats[layer_dir.name] = count
        context["layer_stats"] = layer_stats

        # Get recently modified elements (last 10)
        recent_elements = []
        if model_dir.exists():
            yaml_files = []
            for yaml_file in model_dir.rglob("*.yaml"):
                if not yaml_file.name.startswith("."):
                    try:
                        mtime = yaml_file.stat().st_mtime
                        yaml_files.append((yaml_file, mtime))
                    except OSError:
                        pass

            # Sort by modification time, most recent first
            yaml_files.sort(key=lambda x: x[1], reverse=True)

            for yaml_file, _ in yaml_files[:10]:
                # Extract element ID from file path
                rel_path = yaml_file.relative_to(model_dir)
                parts = list(rel_path.parts)
                if len(parts) >= 2:
                    layer = parts[0]
                    # Get element type from directory name or filename
                    if len(parts) > 2:
                        element_type = parts[1]
                    else:
                        # Only 2 parts: layer/file.yaml
                        element_type = Path(parts[-1]).stem
                    element_name = Path(parts[-1]).stem
                    element_id = f"{layer}.{element_type}.{element_name}"
                    recent_elements.append(element_id)

        context["recent_elements"] = recent_elements

        return context
