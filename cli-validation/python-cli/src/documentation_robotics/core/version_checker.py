"""
Universal version checking for DR components.

This module provides centralized version checking across all DR components:
- Schema files in .dr/schemas/
- Model specification version
- Claude Code integration
- GitHub Copilot integration

The VersionChecker displays a unified status table after update/migrate operations,
helping users identify outdated components and providing actionable suggestions.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml
from rich.console import Console
from rich.table import Table

from ..versions import CLI_VERSION, SPEC_VERSION


@dataclass
class ComponentStatus:
    """Status of a single component."""

    component: str
    display_name: str
    installed: bool
    current_version: Optional[str]
    expected_version: str
    needs_update: bool
    update_command: Optional[str]


@dataclass
class VersionCheckResult:
    """Comprehensive version check result."""

    schema: ComponentStatus
    model: ComponentStatus
    claude: ComponentStatus
    copilot: ComponentStatus

    @property
    def all_up_to_date(self) -> bool:
        """Check if all installed components are current."""
        return all(
            not status.needs_update
            for status in [self.schema, self.model, self.claude, self.copilot]
            if status.installed
        )

    @property
    def suggestions(self) -> list[str]:
        """Get list of suggested update commands."""
        suggestions = []
        for status in [self.schema, self.model, self.claude, self.copilot]:
            if status.installed and status.needs_update and status.update_command:
                suggestions.append(status.update_command)
        return suggestions


class VersionChecker:
    """Universal version checking for DR components."""

    def __init__(self, root_path: Optional[Path] = None):
        """Initialize version checker.

        Args:
            root_path: Project root directory (defaults to current directory)
        """
        self.root_path = root_path or Path.cwd()
        self.console = Console()

    def check_all_versions(self) -> VersionCheckResult:
        """Check all component versions.

        Returns:
            VersionCheckResult with status of all components
        """
        return VersionCheckResult(
            schema=self._check_schema_version(),
            model=self._check_model_version(),
            claude=self._check_claude_version(),
            copilot=self._check_copilot_version(),
        )

    def display_version_status(self, result: VersionCheckResult) -> None:
        """Display formatted status table with suggestions.

        Args:
            result: Version check result to display
        """
        # Create table
        table = Table(title="Version Status", show_header=True, header_style="bold")
        table.add_column("Component", style="cyan", no_wrap=True)
        table.add_column("Current", style="yellow")
        table.add_column("Expected", style="green")
        table.add_column("Status", justify="center")

        # Add rows for each component
        for status in [result.schema, result.model, result.claude, result.copilot]:
            if not status.installed:
                table.add_row(
                    status.display_name,
                    "[dim]not installed[/]",
                    "-",
                    "[dim]-[/]",
                )
            elif status.needs_update:
                table.add_row(
                    status.display_name,
                    status.current_version or "[dim]unknown[/]",
                    status.expected_version,
                    "[yellow]⚠[/]",
                )
            else:
                table.add_row(
                    status.display_name,
                    status.current_version or status.expected_version,
                    status.expected_version,
                    "[green]✓[/]",
                )

        self.console.print(table)

        # Show suggestions if any components need updates
        if result.suggestions:
            self.console.print("\n[bold]Suggested updates:[/]")
            for suggestion in result.suggestions:
                self.console.print(f"  • {suggestion}")
        elif all(not s.installed for s in [result.claude, result.copilot]):
            # All installed components are up to date
            pass  # Table already shows the status
        else:
            self.console.print("\n[green]✓ All components are up to date[/]")

    def _check_schema_version(self) -> ComponentStatus:
        """Check .dr/schemas/.manifest.json spec_version.

        Returns:
            ComponentStatus for schema files
        """
        manifest_path = self.root_path / ".dr" / "schemas" / ".manifest.json"

        if not manifest_path.exists():
            return ComponentStatus(
                component="schema",
                display_name="Schema version",
                installed=False,
                current_version=None,
                expected_version=SPEC_VERSION,
                needs_update=False,
                update_command=None,
            )

        try:
            with open(manifest_path) as f:
                data = json.load(f)
                current = data.get("spec_version", "unknown")

            needs_update = current != SPEC_VERSION
            update_cmd = (
                f"Run 'dr update' to sync schemas to spec v{SPEC_VERSION}" if needs_update else None
            )

            return ComponentStatus(
                component="schema",
                display_name="Schema version",
                installed=True,
                current_version=current,
                expected_version=SPEC_VERSION,
                needs_update=needs_update,
                update_command=update_cmd,
            )
        except (json.JSONDecodeError, KeyError, OSError) as e:
            # Corrupted or malformed manifest
            return ComponentStatus(
                component="schema",
                display_name="Schema version",
                installed=True,
                current_version="error",
                expected_version=SPEC_VERSION,
                needs_update=True,
                update_command=f"Run 'dr update' to fix schema files (error: {type(e).__name__})",
            )

    def _check_model_version(self) -> ComponentStatus:
        """Check manifest.yaml spec_version.

        Returns:
            ComponentStatus for model specification
        """
        manifest_path = self.root_path / "documentation-robotics" / "model" / "manifest.yaml"

        if not manifest_path.exists():
            return ComponentStatus(
                component="model",
                display_name="Model version",
                installed=False,
                current_version=None,
                expected_version=SPEC_VERSION,
                needs_update=False,
                update_command=None,
            )

        try:
            with open(manifest_path) as f:
                data = yaml.safe_load(f)
                current = data.get("spec_version", "unknown")

            needs_update = current != SPEC_VERSION
            update_cmd = (
                f"Run 'dr migrate' to update model to spec v{SPEC_VERSION}"
                if needs_update
                else None
            )

            return ComponentStatus(
                component="model",
                display_name="Model version",
                installed=True,
                current_version=current,
                expected_version=SPEC_VERSION,
                needs_update=needs_update,
                update_command=update_cmd,
            )
        except (yaml.YAMLError, KeyError, OSError) as e:
            # Corrupted or malformed manifest
            return ComponentStatus(
                component="model",
                display_name="Model version",
                installed=True,
                current_version="error",
                expected_version=SPEC_VERSION,
                needs_update=True,
                update_command=f"Check manifest.yaml (error: {type(e).__name__})",
            )

    def _check_claude_version(self) -> ComponentStatus:
        """Check .claude/.dr-version version.

        Returns:
            ComponentStatus for Claude integration
        """
        version_path = self.root_path / ".claude" / ".dr-version"

        if not version_path.exists():
            return ComponentStatus(
                component="claude",
                display_name="Claude integration",
                installed=False,
                current_version=None,
                expected_version=CLI_VERSION,
                needs_update=False,
                update_command=None,
            )

        try:
            with open(version_path) as f:
                data = yaml.safe_load(f)
                current = data.get("version", "unknown")

            needs_update = current != CLI_VERSION
            update_cmd = (
                "Run 'dr claude update' to sync Claude integration" if needs_update else None
            )

            return ComponentStatus(
                component="claude",
                display_name="Claude integration",
                installed=True,
                current_version=current,
                expected_version=CLI_VERSION,
                needs_update=needs_update,
                update_command=update_cmd,
            )
        except (yaml.YAMLError, KeyError, OSError) as e:
            # Corrupted or malformed version file
            return ComponentStatus(
                component="claude",
                display_name="Claude integration",
                installed=True,
                current_version="error",
                expected_version=CLI_VERSION,
                needs_update=True,
                update_command=f"Run 'dr claude update --force' to fix (error: {type(e).__name__})",
            )

    def _check_copilot_version(self) -> ComponentStatus:
        """Check .github/.dr-copilot-version version.

        Returns:
            ComponentStatus for Copilot integration
        """
        version_path = self.root_path / ".github" / ".dr-copilot-version"

        if not version_path.exists():
            return ComponentStatus(
                component="copilot",
                display_name="Copilot integration",
                installed=False,
                current_version=None,
                expected_version=CLI_VERSION,
                needs_update=False,
                update_command=None,
            )

        try:
            with open(version_path) as f:
                data = yaml.safe_load(f)
                current = data.get("version", "unknown")

            needs_update = current != CLI_VERSION
            update_cmd = (
                "Run 'dr copilot update' to sync Copilot integration" if needs_update else None
            )

            return ComponentStatus(
                component="copilot",
                display_name="Copilot integration",
                installed=True,
                current_version=current,
                expected_version=CLI_VERSION,
                needs_update=needs_update,
                update_command=update_cmd,
            )
        except (yaml.YAMLError, KeyError, OSError) as e:
            # Corrupted or malformed version file
            return ComponentStatus(
                component="copilot",
                display_name="Copilot integration",
                installed=True,
                current_version="error",
                expected_version=CLI_VERSION,
                needs_update=True,
                update_command=f"Run 'dr copilot update --force' to fix (error: {type(e).__name__})",
            )
