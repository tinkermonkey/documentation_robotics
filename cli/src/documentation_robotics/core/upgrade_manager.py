"""
Upgrade manager for handling CLI version upgrades.

Handles automatic upgrades of project files when CLI version changes,
including schemas, Claude integration, and manifest updates.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import yaml
from packaging.version import Version
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.prompt import Confirm
from rich.table import Table

from .. import __version__ as CLI_VERSION
from .manifest import Manifest

console = Console()


class UpgradeManager:
    """Manages CLI version upgrades for projects."""

    def __init__(self, root_path: Optional[Path] = None):
        """Initialize the upgrade manager.

        Args:
            root_path: Project root directory
        """
        if root_path is None:
            root_path = Path.cwd()
        self.root_path = root_path
        self.manifest_path = root_path / "documentation-robotics" / "model" / "manifest.yaml"
        self.claude_version_path = root_path / ".claude" / ".dr-version"
        self.schemas_dir = root_path / ".dr" / "schemas"

    def check_and_upgrade(self, auto: bool = True, force: bool = False) -> bool:
        """Check if upgrade is needed and perform it.

        Args:
            auto: Perform upgrade automatically without prompting
            force: Force upgrade even if versions match

        Returns:
            True if upgrade was performed, False otherwise
        """
        # Check if project is initialized
        if not self.manifest_path.exists():
            # Not a DR project, skip upgrade check
            return False

        # Load manifest
        try:
            manifest = Manifest.load(self.manifest_path)
        except Exception as e:
            console.print(f"[yellow]⚠[/] Could not load manifest: {e}")
            return False

        # Get stored CLI version from manifest
        stored_version = manifest.data.get("cli_version")

        # Check if upgrade needed
        if not force:
            if stored_version == CLI_VERSION:
                # Already up to date
                return False

            if stored_version and Version(stored_version) > Version(CLI_VERSION):
                # Downgrade detected
                console.print(
                    f"[yellow]⚠[/] Project was created with newer CLI version "
                    f"({stored_version}) than current ({CLI_VERSION})"
                )
                if not Confirm.ask("Continue anyway?", default=False):
                    raise RuntimeError("CLI version mismatch")
                return False

        # Determine what needs upgrading
        upgrade_items = self._determine_upgrades(manifest, stored_version)

        if not upgrade_items and not force:
            return False

        # Show upgrade summary
        self._show_upgrade_summary(stored_version, CLI_VERSION, upgrade_items)

        # Prompt if not auto
        if not auto:
            if not Confirm.ask("\nProceed with upgrade?", default=True):
                console.print("Upgrade cancelled")
                return False

        # Perform upgrade
        self._perform_upgrade(manifest, upgrade_items)

        return True

    def _determine_upgrades(
        self, manifest: Manifest, stored_version: Optional[str]
    ) -> List[Dict[str, any]]:
        """Determine what needs to be upgraded.

        Args:
            manifest: Current manifest
            stored_version: Previously stored CLI version

        Returns:
            List of upgrade items
        """
        items = []

        # Always check manifest first (this will update the version)
        if self._manifest_needs_update(manifest):
            items.append(
                {
                    "type": "manifest",
                    "description": "Update manifest structure and metadata",
                    "action": self._upgrade_manifest,
                }
            )

        # Check schemas
        if self._schemas_need_update():
            items.append(
                {
                    "type": "schemas",
                    "description": "Update schema files to latest version",
                    "action": self._upgrade_schemas,
                }
            )

        # Check Claude integration
        if self._claude_needs_update():
            items.append(
                {
                    "type": "claude",
                    "description": "Update Claude Code integration files",
                    "action": self._upgrade_claude,
                }
            )

        # Check documentation
        if self._docs_need_update():
            items.append(
                {
                    "type": "documentation",
                    "description": "Update README and reference documentation",
                    "action": self._upgrade_docs,
                }
            )

        return items

    def _schemas_need_update(self) -> bool:
        """Check if schema files need updating."""
        if not self.schemas_dir.exists():
            return True

        # Check if any schema files are missing
        # Import from bundler to ensure we check for all files
        from ..schemas.bundler import ADDITIONAL_FILES, LAYER_SCHEMAS

        # Check layer schemas
        for schema_name in LAYER_SCHEMAS:
            if not (self.schemas_dir / schema_name).exists():
                return True

        # Check additional files (like link-registry.json)
        for filename in ADDITIONAL_FILES:
            if not (self.schemas_dir / filename).exists():
                return True

        return False

    def _claude_needs_update(self) -> bool:
        """Check if Claude integration needs updating."""
        if not self.claude_version_path.exists():
            # Not installed
            return False

        try:
            data = yaml.safe_load(self.claude_version_path.read_text())
            stored_version = data.get("version")
            if stored_version != CLI_VERSION:
                return True
        except Exception:
            return True

        return False

    def _manifest_needs_update(self, manifest: Manifest) -> bool:
        """Check if manifest needs updating."""
        # Check for required fields
        required_fields = ["cli_version", "spec_version", "schema"]

        for field in required_fields:
            if field not in manifest.data:
                return True

        # Check if version matches
        stored_version = manifest.data.get("cli_version")
        if stored_version and stored_version != CLI_VERSION:
            return True

        return False

    def _docs_need_update(self) -> bool:
        """Check if documentation needs updating."""
        readme_path = self.root_path / ".dr" / "README.md"
        return not readme_path.exists()

    def _show_upgrade_summary(
        self, from_version: Optional[str], to_version: str, items: List[Dict]
    ) -> None:
        """Show upgrade summary to user."""
        console.print("\n")
        console.print(
            Panel(
                f"[bold]Component Upgrade Available[/]\n\n"
                f"From: {from_version or 'unknown'}\n"
                f"To:   {to_version}\n\n"
                f"This will update {len(items)} component(s)",
                title="🔄 Upgrade",
                border_style="cyan",
            )
        )

        # Show items
        table = Table(show_header=False, box=None, padding=(0, 2))
        table.add_column("Item", style="cyan")
        table.add_column("Description", style="white")

        for item in items:
            table.add_row(f"• {item['type']}", item["description"])

        console.print(table)
        console.print()

    def _perform_upgrade(self, manifest: Manifest, items: List[Dict]) -> None:
        """Perform the upgrade.

        Args:
            manifest: Current manifest
            items: List of upgrade items
        """
        console.print("[bold]Performing upgrade...[/]\n")

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            for item in items:
                task = progress.add_task(f"Upgrading {item['type']}...", total=None)
                try:
                    item["action"](manifest)
                    progress.update(task, total=1, completed=1)
                    console.print(f"  [green]✓[/] {item['description']}")
                except Exception as e:
                    console.print(f"  [red]✗[/] Failed: {e}")
                    progress.update(task, total=1, completed=1)

        # Update manifest with new version
        manifest.data["cli_version"] = CLI_VERSION
        manifest.data["upgraded_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        manifest.save()

        console.print("\n[green bold]✓ Upgrade completed successfully![/]\n")

    def _upgrade_schemas(self, manifest: Manifest) -> None:
        """Upgrade schema files."""
        from ..commands.init import ModelInitializer

        # Use initializer to copy latest schemas
        initializer = ModelInitializer(
            root_path=self.root_path,
            project_name=manifest.project.get("name", "project"),
            template="basic",
            minimal=False,
            with_examples=False,
        )

        # Sync schemas - CLI manages .dr/ authoritatively
        initializer._create_schemas()

    def _upgrade_claude(self, manifest: Manifest) -> None:
        """Upgrade Claude integration files."""
        from ..commands.claude import ClaudeIntegrationManager

        manager = ClaudeIntegrationManager(self.root_path)

        # Update installed components
        manager.update(dry_run=False, force=True, show_progress=False)

    def _upgrade_manifest(self, manifest: Manifest) -> None:
        """Upgrade manifest structure."""
        from .. import __spec_version__

        # Add missing fields
        if "cli_version" not in manifest.data:
            manifest.data["cli_version"] = CLI_VERSION

        if "spec_version" not in manifest.data:
            manifest.data["spec_version"] = __spec_version__

        if "schema" not in manifest.data:
            manifest.data["schema"] = "documentation-robotics-v1"

        # Ensure upgrade history exists
        if "upgrade_history" not in manifest.data:
            manifest.data["upgrade_history"] = []

        # Add upgrade record
        manifest.data["upgrade_history"].append(
            {
                "from_version": manifest.data.get("version", "unknown"),
                "to_version": CLI_VERSION,
                "upgraded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        )

    def _upgrade_docs(self, manifest: Manifest) -> None:
        """Upgrade documentation files."""
        from ..commands.init import ModelInitializer

        initializer = ModelInitializer(
            root_path=self.root_path,
            project_name=manifest.project.get("name", "project"),
            template="basic",
            minimal=False,
            with_examples=False,
        )

        # Create documentation
        initializer._create_documentation()

    def get_version_info(self) -> Dict[str, str]:
        """Get version information.

        Returns:
            Dictionary with version info
        """
        info = {
            "cli_version": CLI_VERSION,
            "manifest_version": None,
            "claude_version": None,
        }

        # Get manifest version
        if self.manifest_path.exists():
            try:
                manifest = Manifest.load(self.manifest_path)
                info["manifest_version"] = manifest.data.get("cli_version")
            except Exception:
                pass

        # Get Claude version
        if self.claude_version_path.exists():
            try:
                data = yaml.safe_load(self.claude_version_path.read_text())
                info["claude_version"] = data.get("version")
            except Exception:
                pass

        return info

    def force_upgrade(self) -> None:
        """Force upgrade without version check."""
        self.check_and_upgrade(auto=False, force=True)
