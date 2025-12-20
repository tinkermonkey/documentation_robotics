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
    import anthropic
    from anthropic.types import MessageStreamEvent

    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False
    anthropic = None
    MessageStreamEvent = Any

# Compatibility alias for tests
HAS_SDK = HAS_ANTHROPIC


# Simple stub for backward compatibility with tests
class _ToolStub:
    """Stub object for legacy tool creation methods (tests only)."""

    def __init__(self, name: str):
        self.name = name
        # Add handler property for tests that check tool.handler
        self.handler = self._stub_handler

    async def _stub_handler(self, *args, **kwargs):
        """Stub handler for tests."""
        return f"Tool {self.name} called"

    def __call__(self, *args, **kwargs):
        return f"Tool {self.name} called"


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

    async def _handle_via_claude_cli(
        self,
        user_message: str,
        context: Dict[str, Any],
        conversation_history: Optional[str] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Handle message by invoking Claude Code CLI as subprocess.

        This uses the user's OAuth token (no API key needed) and simply
        captures the response from the CLI.

        Args:
            user_message: The user's message
            context: Model context
            conversation_history: Optional conversation history

        Yields:
            Messages with text content

        Raises:
            FileNotFoundError: If claude command not found
        """
        # Build system prompt with DR context
        system_prompt = self._build_system_prompt(context, conversation_history)

        # Launch Claude CLI with:
        # --print: non-interactive output
        # --dangerously-skip-permissions: skip permission prompts (safe in this context)
        # --system-prompt: DR context and expertise
        # --tools: allow Bash for running dr commands
        # --verbose: required for stream-json
        # --output-format stream-json: streaming JSON responses
        # (user_message piped via stdin)
        proc = None
        cleanup_done = False
        try:
            proc = await asyncio.create_subprocess_exec(
                "claude",
                "--print",
                "--dangerously-skip-permissions",
                "--verbose",
                "--system-prompt",
                system_prompt,
                "--tools",
                "Bash,Read",  # Allow running dr commands and reading files
                "--output-format",
                "stream-json",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.model_path),
            )

            # Send user message via stdin
            if proc.stdin:
                proc.stdin.write(user_message.encode("utf-8"))
                await proc.stdin.drain()
                proc.stdin.close()
                await proc.stdin.wait_closed()

            # Stream JSON events
            accumulated_text = []
            if proc.stdout:
                async for line in proc.stdout:
                    try:
                        event = json.loads(line.decode("utf-8").strip())

                        # Handle different event types
                        if event.get("type") == "assistant":
                            # Extract text from assistant message
                            message = event.get("message", {})
                            content = message.get("content", [])
                            for block in content:
                                if block.get("type") == "text":
                                    text = block.get("text", "")
                                    accumulated_text.append(text)
                                    yield {
                                        "type": "text_delta",
                                        "text": text,
                                    }
                                elif block.get("type") == "tool_use":
                                    # Claude is using a tool (e.g., running a dr command)
                                    yield {
                                        "type": "tool_use",
                                        "name": block.get("name"),
                                        "input": block.get("input", {}),
                                    }
                    except json.JSONDecodeError:
                        # Skip non-JSON lines
                        pass

            # Wait for completion - this ensures the process exits cleanly
            await proc.wait()

            # Yield completion
            yield {
                "type": "complete",
                "text": "".join(accumulated_text),
            }
        except GeneratorExit:
            # Generator is being closed early (e.g., test breaks after first yield)
            # This is the critical path for cleanup when async generator is closed
            cleanup_done = True
            if proc is not None and proc.returncode is None:
                # Process is still running - we need to clean it up NOW
                # before the event loop closes
                await self._cleanup_subprocess(proc)
            raise
        finally:
            # Ensure process is terminated and resources are cleaned up
            # This is critical to prevent ResourceWarning about subprocess still running
            if not cleanup_done and proc is not None and proc.returncode is None:
                await self._cleanup_subprocess(proc)

    async def _cleanup_subprocess(self, proc: asyncio.subprocess.Process) -> None:
        """
        Clean up a subprocess and its resources.

        This ensures all pipes are drained and closed before terminating the process,
        preventing ResourceWarning about unclosed transports.

        Args:
            proc: The subprocess to clean up
        """
        # Close stdin if it's open (stdin is a StreamWriter, has close())
        if proc.stdin and not proc.stdin.is_closing():
            proc.stdin.close()
            try:
                await proc.stdin.wait_closed()
            except Exception:
                pass

        # Drain any remaining data from stdout/stderr to close transports cleanly
        # This prevents ResourceWarning about unclosed transports
        if proc.stdout:
            try:
                # Read remaining data with a short timeout
                await asyncio.wait_for(proc.stdout.read(), timeout=0.1)
            except (asyncio.TimeoutError, Exception):
                pass

        if proc.stderr:
            try:
                await asyncio.wait_for(proc.stderr.read(), timeout=0.1)
            except (asyncio.TimeoutError, Exception):
                pass

        # Now kill the process
        proc.kill()
        try:
            # Wait for process to be killed (with timeout to prevent hanging)
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            # Process didn't terminate within timeout - this is rare but possible
            pass

        # CRITICAL: Give the event loop time to process transport cleanup callbacks
        # When a process is killed, asyncio schedules transport._call_connection_lost()
        # callbacks to close the pipe transports. If the event loop closes before
        # these callbacks run, we get ResourceWarning about unclosed transports.
        # A small sleep allows pending callbacks to execute.
        await asyncio.sleep(0.1)

    async def handle_message(
        self,
        user_message: str,
        context: Dict[str, Any],
        conversation_history: Optional[str] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Handle a user message using Claude Code CLI subprocess.

        Args:
            user_message: The user's message
            context: Model context (manifest summary, recent elements, etc.)
            conversation_history: Optional conversation history for context

        Yields:
            Messages with content (text chunks, tool uses, completion)
        """
        # Try Claude Code CLI first (uses OAuth, no API key needed)
        try:
            async for msg in self._handle_via_claude_cli(
                user_message, context, conversation_history
            ):
                yield msg
            return
        except FileNotFoundError:
            # Claude CLI not available, fall back to Anthropic API
            pass

        # Fallback: Use Anthropic API (requires API key)
        if not HAS_ANTHROPIC:
            raise ImportError(
                "Claude Code CLI not found and Anthropic SDK not installed. "
                "Either install Claude Code or install Anthropic SDK with: pip install anthropic"
            )

        # Build system prompt with current model context
        system_prompt = self._build_system_prompt(context, conversation_history)

        # Get tool definitions in Anthropic format
        tools = self._get_anthropic_tool_definitions()

        # Create async Anthropic client
        client = anthropic.AsyncAnthropic()

        # Build conversation messages
        messages = [{"role": "user", "content": user_message}]

        # Conversation loop for tool calling
        max_turns = 10
        for turn in range(max_turns):
            # Call Claude with streaming
            async with client.messages.stream(
                model="claude-sonnet-4-5-20250929",
                max_tokens=4096,
                system=system_prompt,
                messages=messages,
                tools=tools,
            ) as stream:
                # Collect response
                response_text = []
                tool_uses = []

                async for event in stream:
                    if event.type == "content_block_delta":
                        if hasattr(event.delta, "text"):
                            chunk = event.delta.text
                            response_text.append(chunk)
                            # Yield text chunks as they arrive
                            yield {
                                "type": "text_delta",
                                "text": chunk,
                            }
                    elif event.type == "content_block_start":
                        if hasattr(event.content_block, "type"):
                            if event.content_block.type == "tool_use":
                                tool_uses.append(
                                    {
                                        "id": event.content_block.id,
                                        "name": event.content_block.name,
                                        "input": event.content_block.input,
                                    }
                                )

                # Get final message
                final_message = await stream.get_final_message()

                # If no tool uses, we're done
                if not final_message.stop_reason == "tool_use":
                    yield {
                        "type": "complete",
                        "text": "".join(response_text),
                    }
                    break

                # Handle tool calls
                messages.append(
                    {
                        "role": "assistant",
                        "content": final_message.content,
                    }
                )

                tool_results = []
                for tool_use in final_message.content:
                    if tool_use.type == "tool_use":
                        # Yield tool invocation notification
                        yield {
                            "type": "tool_use",
                            "name": tool_use.name,
                            "input": tool_use.input,
                        }

                        # Execute tool
                        result = await self._execute_tool(tool_use.name, tool_use.input)

                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_use.id,
                                "content": result,
                            }
                        )

                # Add tool results to conversation
                messages.append(
                    {
                        "role": "user",
                        "content": tool_results,
                    }
                )

        # If we hit max turns, yield completion
        yield {
            "type": "complete",
            "text": "Reached maximum conversation turns",
        }

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

    def _get_anthropic_tool_definitions(self) -> List[Dict[str, Any]]:
        """
        Get tool definitions in Anthropic API format.

        Returns:
            List of tool definition dictionaries
        """
        return [
            {
                "name": "dr_list",
                "description": "List all elements of a specific type in a DR layer. Use this to see what elements exist in a layer. Valid layers: motivation, business, security, application, technology, api, data_model, datastore, ux, navigation, apm, testing",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "layer": {
                            "type": "string",
                            "description": "The DR layer name. Must be one of: motivation, business, security, application, technology, api, data_model, datastore, ux, navigation, apm, testing",
                        },
                        "element_type": {
                            "type": "string",
                            "description": "Optional element type (e.g., 'service', 'operation')",
                        },
                    },
                    "required": ["layer"],
                },
            },
            {
                "name": "dr_find",
                "description": "Find a specific element by its ID in the DR model. Returns complete element details.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "element_id": {
                            "type": "string",
                            "description": "Element ID (e.g., 'business.service.orders', 'api.operation.create-user')",
                        }
                    },
                    "required": ["element_id"],
                },
            },
            {
                "name": "dr_search",
                "description": "Search for elements matching a pattern across all layers. Use this to find elements by name or content.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Search pattern (can be text or regex)",
                        }
                    },
                    "required": ["pattern"],
                },
            },
            {
                "name": "dr_trace",
                "description": "Trace dependencies for an element. Shows what depends on this element and what it depends on.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "element_id": {
                            "type": "string",
                            "description": "Element ID to trace",
                        }
                    },
                    "required": ["element_id"],
                },
            },
            {
                "name": "delegate_to_architect",
                "description": "Get expert guidance for DR modeling tasks. Use this when you need help with CREATE, MODIFY, or UPDATE operations on architectural elements. Provides step-by-step instructions, example commands, and best practices.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "task_description": {
                            "type": "string",
                            "description": "Clear description of the modeling task (e.g., 'Add a REST API endpoint for user login', 'Create a business service for order processing')",
                        }
                    },
                    "required": ["task_description"],
                },
            },
        ]

    async def _execute_tool(self, tool_name: str, tool_input: Dict[str, Any]) -> str:
        """
        Execute a tool by name with given input.

        Args:
            tool_name: Name of the tool to execute
            tool_input: Tool input parameters

        Returns:
            Tool result as JSON string
        """
        if tool_name == "dr_list":
            return await self._dr_list_impl(
                layer=tool_input["layer"],
                element_type=tool_input.get("element_type"),
            )
        elif tool_name == "dr_find":
            return await self._dr_find_impl(element_id=tool_input["element_id"])
        elif tool_name == "dr_search":
            return await self._dr_search_impl(pattern=tool_input["pattern"])
        elif tool_name == "dr_trace":
            return await self._dr_trace_impl(element_id=tool_input["element_id"])
        elif tool_name == "delegate_to_architect":
            return await self._delegate_to_architect_impl(
                task_description=tool_input["task_description"]
            )
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

    async def _dr_list_impl(self, layer: str, element_type: Optional[str] = None) -> str:
        """Implementation of dr_list tool."""
        # Valid DR layer names
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

        # Validate layer
        if layer not in valid_layers:
            return json.dumps(
                {
                    "error": f"Invalid layer '{layer}'. Must be one of: {', '.join(valid_layers)}",
                    "valid_layers": valid_layers,
                }
            )

        # Build command
        cmd_parts = ["dr", "list", layer]
        if element_type:
            cmd_parts.append(element_type)
        cmd_parts.extend(["--output", "json"])

        # Execute
        return await self._execute_cli(cmd_parts)

    async def _dr_find_impl(self, element_id: str) -> str:
        """Implementation of dr_find tool."""
        cmd_parts = ["dr", "find", element_id, "--output", "json"]
        return await self._execute_cli(cmd_parts)

    async def _dr_search_impl(self, pattern: str) -> str:
        """Implementation of dr_search tool."""
        cmd_parts = ["dr", "search", pattern, "--output", "json"]
        return await self._execute_cli(cmd_parts)

    async def _dr_trace_impl(self, element_id: str) -> str:
        """Implementation of dr_trace tool."""
        cmd_parts = ["dr", "trace", element_id, "--output", "json"]
        return await self._execute_cli(cmd_parts)

    async def _delegate_to_architect_impl(self, task_description: str) -> str:
        """Implementation of delegate_to_architect tool."""
        # Provide structured guidance based on task
        guidance = {
            "task": task_description,
            "guidance": """To accomplish this DR modeling task:

1. Identify which DR layer(s) to modify
   - Use dr_list to explore existing elements
   - Use dr_search to find related elements

2. Plan your changes
   - Review element structure with dr_find
   - Check dependencies with dr_trace

3. Execute changes
   - Use Bash tool to run 'dr add' commands
   - Or use Edit/Write tools to modify YAML files directly
   - Validate changes with 'dr validate'

4. Verify the results
   - Run dr_list to confirm additions
   - Run dr validate to ensure model integrity
""",
            "recommended_tools": [
                "dr_list - List existing elements in layers",
                "dr_search - Search for related elements",
                "dr_find - Get details of specific elements",
                "dr_trace - Check dependencies",
                "Bash - Run 'dr add' or 'dr validate' commands",
                "Edit/Write - Modify YAML files directly",
            ],
            "example_commands": self._get_example_commands_for_task(task_description),
            "best_practices": [
                "Always validate after making changes: 'dr validate'",
                "Check existing elements first to avoid duplicates",
                "Follow naming conventions: {layer}.{type}.{kebab-case-name}",
                "Higher layers can only reference lower layers",
            ],
        }

        return json.dumps(guidance, indent=2)

    def _create_dr_list_tool(self) -> Any:
        """Create tool wrapper for 'dr list' command (legacy SDK compatibility)."""
        # Return stub if SDK not available (tests only)
        return _ToolStub("dr_list")

    def _create_dr_find_tool(self) -> Any:
        """Create tool wrapper for 'dr find' command (legacy SDK compatibility)."""
        # Return stub if SDK not available (tests only)
        return _ToolStub("dr_find")

    def _create_dr_search_tool(self) -> Any:
        """Create tool wrapper for 'dr search' command (legacy SDK compatibility)."""
        # Return stub if SDK not available (tests only)
        return _ToolStub("dr_search")

    def _create_dr_trace_tool(self) -> Any:
        """Create tool wrapper for 'dr trace' command (legacy SDK compatibility)."""
        # Return stub if SDK not available (tests only)
        return _ToolStub("dr_trace")

    def _create_dr_architect_tool(self) -> Any:
        """Create tool that delegates to dr-architect agent (legacy SDK compatibility)."""
        # Return stub if SDK not available (tests only)
        return _ToolStub("delegate_to_architect")

    def _get_example_commands_for_task(self, task_description: str) -> List[str]:
        """
        Generate example DR commands based on task type.

        Args:
            task_description: Description of the modeling task

        Returns:
            List of example command strings relevant to the task
        """
        task_lower = task_description.lower()

        # API-related tasks
        if any(keyword in task_lower for keyword in ["api", "endpoint", "rest", "operation"]):
            return [
                "dr add api operation --name 'create-user'",
                "dr add api operation --name 'get-user-by-id'",
                "dr list api operation",
                "dr validate --layer api",
            ]

        # Business layer tasks
        elif any(keyword in task_lower for keyword in ["business", "service", "process"]):
            return [
                "dr add business service --name 'customer-service'",
                "dr add business service --name 'order-service'",
                "dr list business service",
                "dr validate --layer business",
            ]

        # Data model tasks
        elif any(keyword in task_lower for keyword in ["data", "entity", "schema", "model"]):
            return [
                "dr add data-model entity --name 'User'",
                "dr add data-model entity --name 'Order'",
                "dr list data-model entity",
                "dr validate --layer data-model",
            ]

        # Application layer tasks
        elif any(keyword in task_lower for keyword in ["application", "component", "app"]):
            return [
                "dr add application component --name 'user-management'",
                "dr list application component",
                "dr validate --layer application",
            ]

        # Technology layer tasks
        elif any(keyword in task_lower for keyword in ["technology", "infrastructure", "platform"]):
            return [
                "dr add technology node --name 'postgres-db'",
                "dr add technology node --name 'api-gateway'",
                "dr list technology node",
                "dr validate --layer technology",
            ]

        # Generic fallback
        else:
            return [
                "dr list <layer>  # List existing elements",
                "dr add <layer> <type> --name 'element-name'  # Add new element",
                "dr find <element-id>  # Get element details",
                "dr validate  # Validate entire model",
            ]

    async def _execute_cli(self, cmd_parts: List[str]) -> str:
        """
        Execute a DR CLI command and return results.

        Args:
            cmd_parts: Command parts list (e.g., ['dr', 'list', 'api'])

        Returns:
            JSON string with command results or error message
        """
        proc = None
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
                # Clean up subprocess on timeout
                await self._cleanup_subprocess(proc)
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
        finally:
            # Ensure process is cleaned up to prevent ResourceWarning
            if proc is not None and proc.returncode is None:
                await self._cleanup_subprocess(proc)

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
