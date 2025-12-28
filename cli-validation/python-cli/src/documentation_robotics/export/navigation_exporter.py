"""
Export navigation layer to various formats (React Router, voice intents, etc.).
"""

import json
from pathlib import Path
from typing import Dict, List

from ..core.model import Model
from ..core.navigation import NavigationChannel, NavigationGraph, RouteGenerator
from .export_manager import BaseExporter, ExportOptions


class NavigationExporter(BaseExporter):
    """Export navigation definitions to various formats."""

    def __init__(self, model: Model, options: ExportOptions):
        super().__init__(model, options)
        self.navigation_layer = model.get_layer("navigation")

    def export(self) -> Path:
        """
        Export navigation layer to various formats.

        Returns:
            Path to exported files directory
        """
        output_dir = self.options.output_path
        self.export_all(output_dir)
        return output_dir

    def export_all(self, output_dir: Path) -> Dict[str, Path]:
        """Export navigation to all supported formats."""
        output_dir.mkdir(parents=True, exist_ok=True)

        results = {}

        # Check if navigation layer exists
        if not self.navigation_layer:
            return results

        # Load navigation graphs
        graphs = self._load_navigation_graphs()

        if not graphs:
            return results

        # Export to different formats
        for graph in graphs:
            # React Router routes
            react_path = output_dir / f"{graph.application}-react-routes.tsx"
            self.export_react_router(graph, react_path)
            results["react-router"] = react_path

            # Voice intents
            voice_path = output_dir / f"{graph.application}-voice-intents.json"
            self.export_voice_intents(graph, voice_path)
            results["voice-intents"] = voice_path

            # Chat event handlers
            chat_path = output_dir / f"{graph.application}-chat-handlers.js"
            self.export_chat_handlers(graph, chat_path)
            results["chat-handlers"] = chat_path

            # Route manifest (all channels)
            manifest_path = output_dir / f"{graph.application}-route-manifest.json"
            self.export_route_manifest(graph, manifest_path)
            results["route-manifest"] = manifest_path

            # Navigation documentation
            docs_path = output_dir / f"{graph.application}-navigation-docs.md"
            self.export_navigation_docs(graph, docs_path)
            results["navigation-docs"] = docs_path

        return results

    def _load_navigation_graphs(self) -> List[NavigationGraph]:
        """Load all navigation graphs from the navigation layer."""
        graphs = []

        if not self.navigation_layer:
            return graphs

        # Find all navigation YAML files in navigation layer
        nav_files = Path(self.navigation_layer.path).glob("*.yaml")

        for nav_file in nav_files:
            try:
                graph = NavigationGraph.from_yaml(nav_file)
                graphs.append(graph)
            except Exception as e:
                print(f"Warning: Failed to load navigation graph from {nav_file}: {e}")

        return graphs

    def export_react_router(self, graph: NavigationGraph, output_path: Path) -> None:
        """Export React Router v6 route definitions."""
        content = RouteGenerator.generate_react_router_routes(graph)
        output_path.write_text(content)

    def export_voice_intents(self, graph: NavigationGraph, output_path: Path) -> None:
        """Export voice intent definitions (Alexa/Google Assistant format)."""
        intents = RouteGenerator.generate_voice_intents(graph)

        # Create Alexa-compatible interaction model
        interaction_model = {
            "interactionModel": {
                "languageModel": {
                    "invocationName": graph.application.replace("-", " "),
                    "intents": [
                        {
                            "name": intent_name,
                            "slots": intent_data.get("slots", []),
                            "samples": intent_data.get("samples", []),
                        }
                        for intent_name, intent_data in intents.items()
                    ],
                }
            }
        }

        with open(output_path, "w") as f:
            json.dump(interaction_model, f, indent=2)

    def export_chat_handlers(self, graph: NavigationGraph, output_path: Path) -> None:
        """Export chat event handler definitions."""
        content = RouteGenerator.generate_chat_event_handlers(graph)
        output_path.write_text(content)

    def export_route_manifest(self, graph: NavigationGraph, output_path: Path) -> None:
        """Export complete route manifest with all channel information."""
        manifest = {
            "version": graph.version,
            "application": graph.application,
            "description": graph.description,
            "routes": [],
            "guards": [],
            "statistics": {
                "total_routes": len(graph.routes),
                "web_routes": len(graph.get_routes_for_channel(NavigationChannel.WEB)),
                "voice_routes": len(graph.get_routes_for_channel(NavigationChannel.VOICE)),
                "chat_routes": len(graph.get_routes_for_channel(NavigationChannel.CHAT)),
                "sms_routes": len(graph.get_routes_for_channel(NavigationChannel.SMS)),
                "multi_channel_routes": len(graph.get_multi_channel_routes()),
                "authenticated_routes": len(graph.get_authenticated_routes()),
            },
        }

        # Add route information
        for route in graph.routes.values():
            route_info = {
                "identifier": route.identifier,
                "name": route.name,
                "type": route.route_type.value,
                "channels": [c.value for c in route.get_supported_channels()],
                "addressing": route.addressing.to_dict() if route.addressing else {},
                "requires_auth": route.requires_authentication(),
                "guards": route.guards,
            }

            if route.parent:
                route_info["parent"] = route.parent
            if route.redirect_to:
                route_info["redirect_to"] = route.redirect_to
            if route.experience:
                route_info["experience"] = route.experience

            manifest["routes"].append(route_info)

        # Add guard information
        for guard in graph.guards.values():
            guard_info = {
                "name": guard.name,
                "type": guard.guard_type.value,
                "condition": guard.condition_expression,
                "on_deny": guard.on_deny_action.value,
                "is_async": guard.is_async,
            }
            manifest["guards"].append(guard_info)

        with open(output_path, "w") as f:
            json.dump(manifest, f, indent=2)

    def export_navigation_docs(self, graph: NavigationGraph, output_path: Path) -> None:
        """Export navigation documentation in Markdown format."""
        lines = [
            f"# Navigation Documentation: {graph.application}",
            "",
            f"**Version:** {graph.version}",
            "",
        ]

        if graph.description:
            lines.extend(
                [
                    "## Overview",
                    "",
                    graph.description,
                    "",
                ]
            )

        # Statistics
        lines.extend(
            [
                "## Statistics",
                "",
                f"- **Total Routes:** {len(graph.routes)}",
                f"- **Web Routes:** {len(graph.get_routes_for_channel(NavigationChannel.WEB))}",
                f"- **Voice Routes:** {len(graph.get_routes_for_channel(NavigationChannel.VOICE))}",
                f"- **Chat Routes:** {len(graph.get_routes_for_channel(NavigationChannel.CHAT))}",
                f"- **SMS Routes:** {len(graph.get_routes_for_channel(NavigationChannel.SMS))}",
                f"- **Multi-Channel Routes:** {len(graph.get_multi_channel_routes())}",
                f"- **Authenticated Routes:** {len(graph.get_authenticated_routes())}",
                f"- **Total Guards:** {len(graph.guards)}",
                f"- **Total Transitions:** {len(graph.transitions)}",
                f"- **Total Flows:** {len(graph.flows)}",
                "",
            ]
        )

        # Routes by channel
        lines.extend(
            [
                "## Routes by Channel",
                "",
            ]
        )

        for channel in NavigationChannel:
            channel_routes = graph.get_routes_for_channel(channel)
            if channel_routes:
                lines.append(f"### {channel.value.upper()} Channel")
                lines.append("")
                lines.append("| Route ID | Name | Type | Addressing |")
                lines.append("|----------|------|------|------------|")

                for route in channel_routes:
                    addressing = ""
                    if channel == NavigationChannel.WEB:
                        addressing = route.get_url_pattern() or "-"
                    elif channel == NavigationChannel.VOICE:
                        addressing = route.get_intent_name() or "-"
                    elif channel == NavigationChannel.CHAT:
                        addressing = route.get_event_name() or "-"
                    elif channel == NavigationChannel.SMS:
                        addressing = route.get_keyword() or "-"

                    lines.append(
                        f"| `{route.identifier}` | {route.name} | {route.route_type.value} | `{addressing}` |"
                    )

                lines.append("")

        # Multi-channel routes
        multi_routes = graph.get_multi_channel_routes()
        if multi_routes:
            lines.extend(
                [
                    "## Multi-Channel Routes",
                    "",
                    "These routes are accessible through multiple channels:",
                    "",
                    "| Route ID | Name | Channels | Addressing |",
                    "|----------|------|----------|------------|",
                ]
            )

            for route in multi_routes:
                channels = ", ".join([c.value for c in route.get_supported_channels()])
                addressing_parts = []
                if route.get_url_pattern():
                    addressing_parts.append(f"URL: `{route.get_url_pattern()}`")
                if route.get_intent_name():
                    addressing_parts.append(f"Intent: `{route.get_intent_name()}`")
                if route.get_event_name():
                    addressing_parts.append(f"Event: `{route.get_event_name()}`")
                if route.get_keyword():
                    addressing_parts.append(f"Keyword: `{route.get_keyword()}`")

                addressing_str = "<br>".join(addressing_parts)

                lines.append(
                    f"| `{route.identifier}` | {route.name} | {channels} | {addressing_str} |"
                )

            lines.append("")

        # Navigation guards
        if graph.guards:
            lines.extend(
                [
                    "## Navigation Guards",
                    "",
                    "| Guard Name | Type | Condition | On Deny |",
                    "|------------|------|-----------|---------|",
                ]
            )

            for guard in sorted(graph.guards.values(), key=lambda g: g.order):
                condition_preview = (
                    guard.condition_expression[:50] + "..."
                    if len(guard.condition_expression) > 50
                    else guard.condition_expression
                )
                on_deny = f"{guard.on_deny_action.value}"
                if guard.deny_target:
                    on_deny += f" → `{guard.deny_target}`"

                lines.append(
                    f"| `{guard.name}` | {guard.guard_type.value} | `{condition_preview}` | {on_deny} |"
                )

            lines.append("")

        # Authentication-required routes
        auth_routes = graph.get_authenticated_routes()
        if auth_routes:
            lines.extend(
                [
                    "## Authenticated Routes",
                    "",
                    "The following routes require authentication:",
                    "",
                ]
            )

            for route in auth_routes:
                lines.append(f"- **`{route.identifier}`** ({route.name})")
                if route.guards:
                    lines.append(f"  - Guards: {', '.join(f'`{g}`' for g in route.guards)}")
                if route.meta and route.meta.roles:
                    lines.append(f"  - Required Roles: {', '.join(route.meta.roles)}")
                if route.meta and route.meta.permissions:
                    lines.append(f"  - Required Permissions: {', '.join(route.meta.permissions)}")

            lines.append("")

        # Navigation transitions
        if graph.transitions:
            lines.extend(
                [
                    "## Navigation Transitions",
                    "",
                    "| From | To | Trigger | Guards |",
                    "|------|----|---------| -------|",
                ]
            )

            for transition in graph.transitions:
                from_route = graph.get_route(transition.from_route)
                to_route = graph.get_route(transition.to_route)
                from_name = from_route.name if from_route else transition.from_route
                to_name = to_route.name if to_route else transition.to_route
                guards_str = (
                    ", ".join(f"`{g}`" for g in transition.guards) if transition.guards else "-"
                )

                lines.append(f"| {from_name} | {to_name} | {transition.trigger} | {guards_str} |")

            lines.append("")

        # Navigation flows
        if graph.flows:
            lines.extend(
                [
                    "## Navigation Flows",
                    "",
                ]
            )

            for flow in graph.flows.values():
                lines.append(f"### {flow.name}")
                lines.append("")

                if flow.description:
                    lines.append(flow.description)
                    lines.append("")

                if flow.realizes_process:
                    lines.append(f"**Realizes Process:** `{flow.realizes_process}`")
                    lines.append("")

                if flow.realizes_services:
                    lines.append(
                        f"**Realizes Services:** {', '.join(f'`{s}`' for s in flow.realizes_services)}"
                    )
                    lines.append("")

                lines.append(f"**Steps:** {len(flow.steps)}")
                lines.append("")

                lines.append("| Step | Route | Description |")
                lines.append("|------|-------|-------------|")

                for step in flow.steps:
                    sequence = step.get("sequence", "")
                    route_id = step.get("route", "")
                    step_name = step.get("name", "")
                    route = graph.get_route(route_id) if route_id else None
                    route_name = route.name if route else route_id

                    lines.append(f"| {sequence} | {route_name} | {step_name} |")

                lines.append("")

        # Validation report
        errors = graph.validate_references()
        lines.extend(
            [
                "## Validation",
                "",
            ]
        )

        if errors:
            lines.append(f"⚠️  **{len(errors)} validation error(s) found:**")
            lines.append("")
            for error in errors:
                lines.append(f"- {error}")
        else:
            lines.append("✅ All references are valid")

        lines.append("")

        output_path.write_text("\n".join(lines))
