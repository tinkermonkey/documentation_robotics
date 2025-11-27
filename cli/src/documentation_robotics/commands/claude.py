"""
Manage Claude Code integration files.
"""

import hashlib
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import click
import yaml
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.prompt import Confirm
from rich.table import Table

console = Console()

# Package data location
INTEGRATION_ROOT = Path(__file__).parent.parent / "claude_integration"

# Target locations (relative to project root)
CLAUDE_DIR = Path(".claude")
KNOWLEDGE_DIR = CLAUDE_DIR / "knowledge"
COMMANDS_DIR = CLAUDE_DIR / "commands"
AGENTS_DIR = CLAUDE_DIR / "agents"
VERSION_FILE = CLAUDE_DIR / ".dr-version"


class ClaudeIntegrationManager:
    """Manages Claude Code integration files."""

    COMPONENTS = {
        "reference_sheets": {
            "source": "reference_sheets",
            "target": KNOWLEDGE_DIR,
            "description": "Reference documentation for agents",
            "prefix": "dr-",
            "type": "files",
        },
        "commands": {
            "source": "commands",
            "target": COMMANDS_DIR,
            "description": "Slash commands for DR workflows",
            "prefix": "",
            "type": "files",
        },
        "agents": {
            "source": "agents",
            "target": AGENTS_DIR,
            "description": "Specialized sub-agent definitions",
            "prefix": "",
            "type": "files",
        },
        "skills": {
            "source": "skills",
            "target": CLAUDE_DIR / "skills",
            "description": "Auto-activating capabilities",
            "prefix": "",
            "type": "directories",
        },
        "templates": {
            "source": "templates",
            "target": CLAUDE_DIR / "templates",
            "description": "Customization templates and examples",
            "prefix": "",
            "type": "mixed",
        },
    }

    def __init__(self, root_path: Path = Path.cwd()):
        """Initialize the manager.

        Args:
            root_path: Project root directory
        """
        self.root_path = root_path
        self.claude_dir = root_path / CLAUDE_DIR

    def install(
        self,
        components: Optional[List[str]] = None,
        force: bool = False,
    ) -> None:
        """Install Claude integration files.

        Args:
            components: List of components to install (None = all)
            force: Overwrite existing files without prompting
        """
        # Validate components
        if components:
            invalid = set(components) - set(self.COMPONENTS.keys())
            if invalid:
                console.print(f"[red]✗[/] Invalid components: {', '.join(invalid)}")
                console.print(f"   Valid: {', '.join(self.COMPONENTS.keys())}")
                return

        # Create .claude directory if needed
        if not self.claude_dir.exists():
            self.claude_dir.mkdir(parents=True)
            console.print("[green]✓[/] Created .claude/ directory")

        components = components or list(self.COMPONENTS.keys())

        # Install each component
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            for component in components:
                task = progress.add_task(f"Installing {component}...", total=None)
                count = self._install_component(component, force)
                progress.update(task, completed=True)
                console.print(f"   Installed {count} files", style="dim")

        # Create version file
        self._update_version_file()

        # Success message
        console.print("\n[green]✓[/] Claude integration installed successfully!")
        self._print_next_steps()

    def _install_component(self, component: str, force: bool) -> int:
        """Install a specific component.

        Args:
            component: Component name
            force: Overwrite without prompting

        Returns:
            Number of files installed
        """
        config = self.COMPONENTS[component]
        source_dir = INTEGRATION_ROOT / config["source"]
        target_dir = self.root_path / config["target"]
        prefix = config["prefix"]
        install_type = config.get("type", "files")

        # Create target directory
        if not target_dir.exists():
            target_dir.mkdir(parents=True)

        # Check if source exists
        if not source_dir.exists():
            console.print(f"[yellow]⚠[/] Source directory not found: {source_dir}")
            return 0

        count = 0

        # Handle different installation types
        if install_type == "directories":
            # Install directory structures (e.g., skills with subdirectories)
            for skill_dir in source_dir.iterdir():
                if skill_dir.is_dir():
                    target_skill = target_dir / skill_dir.name
                    target_skill.mkdir(parents=True, exist_ok=True)

                    for skill_file in skill_dir.iterdir():
                        target_file = target_skill / skill_file.name

                        # Check if file exists
                        if target_file.exists() and not force:
                            if not Confirm.ask(
                                f"  {skill_dir.name}/{skill_file.name} exists. Overwrite?",
                                default=False,
                            ):
                                continue

                        # Copy file
                        shutil.copy2(skill_file, target_file)
                        console.print(f"  [green]✓[/] {skill_dir.name}/{skill_file.name}")
                        count += 1

        elif install_type == "mixed":
            # Install all files (mixed types: .md, .json, .sh, etc.)
            for source_file in source_dir.rglob("*"):
                if source_file.is_file():
                    # Calculate relative path
                    rel_path = source_file.relative_to(source_dir)
                    target_file = target_dir / rel_path

                    # Create parent directories
                    target_file.parent.mkdir(parents=True, exist_ok=True)

                    # Check if file exists
                    if target_file.exists() and not force:
                        if not Confirm.ask(f"  {rel_path} exists. Overwrite?", default=False):
                            continue

                    # Copy file
                    shutil.copy2(source_file, target_file)
                    # Make shell scripts executable
                    if source_file.suffix == ".sh":
                        target_file.chmod(target_file.stat().st_mode | 0o111)
                    console.print(f"  [green]✓[/] {rel_path}")
                    count += 1

        else:  # "files" - default behavior
            # Install .md files
            for source_file in source_dir.glob("*.md"):
                target_file = target_dir / f"{prefix}{source_file.name}"

                # Check if file exists
                if target_file.exists() and not force:
                    if not Confirm.ask(f"  {target_file.name} exists. Overwrite?", default=False):
                        console.print(f"  Skipped {source_file.name}", style="dim")
                        continue

                # Copy file
                shutil.copy2(source_file, target_file)
                console.print(f"  [green]✓[/] {source_file.name}")
                count += 1

        return count

    def update(self, dry_run: bool = False, force: bool = False) -> None:
        """Update installed files.

        Args:
            dry_run: Show what would be updated without making changes
            force: Update all files without prompting
        """
        if not self._is_installed():
            console.print("[red]✗[/] Claude integration not installed")
            console.print("Run [cyan]dr claude install[/] first")
            return

        # Load version data
        version_data = self._load_version_file()

        # Check for updates
        updates = []
        for component in self.COMPONENTS.keys():
            changes = self._check_updates(component, version_data)
            updates.extend(changes)

        if not updates:
            console.print("[green]✓[/] All files are up to date")
            return

        # Show what will change
        table = Table(title="Available Updates")
        table.add_column("File", style="cyan")
        table.add_column("Status", style="yellow")
        table.add_column("Action", style="green")

        for update in updates:
            table.add_row(
                update["file"],
                update["status"],
                update["action"],
            )

        console.print(table)

        if dry_run:
            console.print("\n[yellow]Dry run - no changes made[/]")
            return

        if not force and not Confirm.ask("\nProceed with updates?", default=True):
            console.print("Update cancelled")
            return

        # Apply updates
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            for update in updates:
                if update["action"] == "Skip (keep)":
                    console.print(f"[yellow]⊘[/] Skipped {update['file']} (modified)")
                    continue

                task = progress.add_task(f"Updating {update['file']}...", total=None)
                self._apply_update(update, force)
                progress.update(task, completed=True)

        # Update version file
        self._update_version_file()
        console.print("\n[green]✓[/] Updates applied successfully")

    def _check_updates(self, component: str, version_data: dict) -> List[Dict[str, str]]:
        """Check for updates in a component.

        Args:
            component: Component name
            version_data: Current version data

        Returns:
            List of updates needed
        """
        updates = []
        config = self.COMPONENTS[component]
        source_dir = INTEGRATION_ROOT / config["source"]
        target_dir = self.root_path / config["target"]
        prefix = config["prefix"]

        if not source_dir.exists():
            return updates

        for source_file in source_dir.glob("*.md"):
            target_file = target_dir / f"{prefix}{source_file.name}"
            target_name = target_file.name

            if not target_file.exists():
                # New file
                updates.append(
                    {
                        "file": target_name,
                        "status": "New",
                        "action": "Install",
                        "source": source_file,
                        "target": target_file,
                    }
                )
                continue

            # Check if modified
            current_hash = self._compute_hash(target_file)
            stored_hash = (
                version_data.get("components", {})
                .get(component, {})
                .get(target_name, {})
                .get("hash")
            )

            source_hash = self._compute_hash(source_file)

            if stored_hash and current_hash != stored_hash:
                # User modified
                updates.append(
                    {
                        "file": target_name,
                        "status": "Modified",
                        "action": "Skip (keep)",
                        "source": source_file,
                        "target": target_file,
                    }
                )
            elif source_hash != current_hash:
                # New version available
                updates.append(
                    {
                        "file": target_name,
                        "status": "New version",
                        "action": "Update",
                        "source": source_file,
                        "target": target_file,
                    }
                )
            else:
                # Unchanged
                pass

        return updates

    def _apply_update(self, update: dict, force: bool) -> None:
        """Apply an update.

        Args:
            update: Update information
            force: Force update
        """
        source = update["source"]
        target = update["target"]

        # Backup if exists and modified
        if target.exists() and update["status"] == "Modified":
            if not force:
                return
            backup = target.with_suffix(f"{target.suffix}.bak")
            shutil.copy2(target, backup)
            console.print(f"  [yellow]Backup:[/] {backup.name}", style="dim")

        # Copy file
        shutil.copy2(source, target)
        console.print(f"  [green]✓[/] Updated {target.name}")

    def remove(self, components: Optional[List[str]] = None, force: bool = False) -> None:
        """Remove installed files.

        Args:
            components: Components to remove (None = all)
            force: Remove without confirmation
        """
        if not self._is_installed():
            console.print("[yellow]⚠[/] Claude integration not installed")
            return

        components = components or list(self.COMPONENTS.keys())

        if not force:
            console.print(f"This will remove: {', '.join(components)}")
            if not Confirm.ask("Continue?", default=False):
                console.print("Removal cancelled")
                return

        # Remove components
        for component in components:
            self._remove_component(component)

        # Remove version file if all components removed
        if set(components) == set(self.COMPONENTS.keys()):
            if VERSION_FILE.exists():
                (self.root_path / VERSION_FILE).unlink()

        console.print("[green]✓[/] Removed successfully")

    def _remove_component(self, component: str) -> None:
        """Remove a specific component.

        Args:
            component: Component name
        """
        config = self.COMPONENTS[component]
        target_dir = self.root_path / config["target"]
        prefix = config["prefix"]

        if not target_dir.exists():
            return

        # Remove files with prefix
        for file in target_dir.glob(f"{prefix}*.md"):
            file.unlink()
            console.print(f"  [red]✗[/] Removed {file.name}")

    def status(self) -> None:
        """Show installation status."""
        if not self._is_installed():
            console.print("[yellow]Claude integration not installed[/]")
            console.print("Run [cyan]dr claude install[/] to get started")
            return

        version_data = self._load_version_file()

        # Header
        console.print("[bold]Installation Status[/]")
        console.print(f"Version: {version_data.get('version', 'unknown')}")
        console.print(f"Installed: {version_data.get('installed_at', 'unknown')}\n")

        # Component table
        table = Table()
        table.add_column("Component", style="cyan")
        table.add_column("Files", style="green")
        table.add_column("Modified", style="yellow")

        for component, config in self.COMPONENTS.items():
            target_dir = self.root_path / config["target"]
            prefix = config["prefix"]

            if not target_dir.exists():
                table.add_row(component, "0", "-")
                continue

            files = list(target_dir.glob(f"{prefix}*.md"))
            modified_count = sum(1 for f in files if self._is_modified(f, component, version_data))

            table.add_row(
                component,
                str(len(files)),
                str(modified_count) if modified_count > 0 else "-",
            )

        console.print(table)

    def list_components(self) -> None:
        """List available components."""
        table = Table(title="Available Components")
        table.add_column("Component", style="cyan")
        table.add_column("Description", style="white")

        for component, config in self.COMPONENTS.items():
            table.add_row(component, config["description"])

        console.print(table)

    def _is_installed(self) -> bool:
        """Check if integration is installed."""
        return (self.root_path / VERSION_FILE).exists()

    def _load_version_file(self) -> dict:
        """Load version tracking file."""
        version_path = self.root_path / VERSION_FILE
        if version_path.exists():
            return yaml.safe_load(version_path.read_text())
        return {}

    def _update_version_file(self) -> None:
        """Update version tracking file."""
        from .. import __version__

        data = {
            "version": __version__,
            "installed_at": datetime.now().isoformat(),
            "components": {},
        }

        for component, config in self.COMPONENTS.items():
            target_dir = self.root_path / config["target"]
            prefix = config["prefix"]

            if not target_dir.exists():
                continue

            files = {}
            for file in target_dir.glob(f"{prefix}*.md"):
                files[file.name] = {
                    "hash": self._compute_hash(file),
                    "modified": False,
                }
            data["components"][component] = files

        version_path = self.root_path / VERSION_FILE
        version_path.parent.mkdir(parents=True, exist_ok=True)
        version_path.write_text(yaml.dump(data, default_flow_style=False))

    def _compute_hash(self, file_path: Path) -> str:
        """Compute file hash."""
        return hashlib.sha256(file_path.read_bytes()).hexdigest()[:8]

    def _is_modified(self, file_path: Path, component: str, version_data: dict) -> bool:
        """Check if file has been modified by user."""
        file_info = version_data.get("components", {}).get(component, {}).get(file_path.name, {})
        stored_hash = file_info.get("hash")

        if not stored_hash:
            return False

        current_hash = self._compute_hash(file_path)
        return current_hash != stored_hash

    def _print_next_steps(self) -> None:
        """Print helpful next steps."""
        console.print("\n[bold]Next steps:[/]")
        console.print("1. Reference sheets are available in .claude/knowledge/")
        console.print("2. Try slash commands: [cyan]/dr-init[/], [cyan]/dr-model[/]")
        console.print("3. Run [cyan]dr claude status[/] to see what's installed")
        console.print("\n[dim]Note: Restart Claude Code to load new files[/]")


# CLI Commands


@click.group()
def claude():
    """Manage Claude Code integration."""
    pass


@claude.command()
@click.option(
    "--reference-only",
    is_flag=True,
    help="Install only reference sheets",
)
@click.option(
    "--commands-only",
    is_flag=True,
    help="Install only slash commands",
)
@click.option(
    "--agents-only",
    is_flag=True,
    help="Install only agent definitions",
)
@click.option(
    "--force",
    is_flag=True,
    help="Overwrite existing files without prompting",
)
def install(reference_only, commands_only, agents_only, force):
    """Install Claude Code integration files."""
    manager = ClaudeIntegrationManager()

    components = None
    if reference_only:
        components = ["reference_sheets"]
    elif commands_only:
        components = ["commands"]
    elif agents_only:
        components = ["agents"]

    try:
        manager.install(components=components, force=force)
    except Exception as e:
        console.print(f"[red]✗ Error during installation: {e}[/]")
        raise click.Abort()


@claude.command()
@click.option(
    "--dry-run",
    is_flag=True,
    help="Show what would be updated without making changes",
)
@click.option(
    "--force",
    is_flag=True,
    help="Update all files without prompting",
)
def update(dry_run, force):
    """Update installed Claude integration files."""
    manager = ClaudeIntegrationManager()

    try:
        manager.update(dry_run=dry_run, force=force)
    except Exception as e:
        console.print(f"[red]✗ Error during update: {e}[/]")
        raise click.Abort()


@claude.command()
@click.option(
    "--force",
    is_flag=True,
    help="Remove without confirmation",
)
@click.option(
    "--commands",
    "component_commands",
    is_flag=True,
    help="Remove only slash commands",
)
@click.option(
    "--reference",
    is_flag=True,
    help="Remove only reference sheets",
)
@click.option(
    "--agents",
    "component_agents",
    is_flag=True,
    help="Remove only agents",
)
def remove(force, component_commands, reference, component_agents):
    """Remove Claude Code integration files."""
    manager = ClaudeIntegrationManager()

    components = None
    if component_commands:
        components = ["commands"]
    elif reference:
        components = ["reference_sheets"]
    elif component_agents:
        components = ["agents"]

    try:
        manager.remove(components=components, force=force)
    except Exception as e:
        console.print(f"[red]✗ Error during removal: {e}[/]")
        raise click.Abort()


@claude.command()
def status():
    """Show Claude Code integration status."""
    manager = ClaudeIntegrationManager()
    manager.status()


@claude.command(name="list")
def list_components():
    """List available components."""
    manager = ClaudeIntegrationManager()
    manager.list_components()
