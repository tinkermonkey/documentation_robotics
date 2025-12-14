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

# Determine integration root
# 1. Check for development environment (files in integrations/claude_code)
# 2. Fallback to package directory (files in claude_integration)
DEV_ROOT = Path(__file__).parents[4] / "integrations" / "claude_code"
PKG_ROOT = Path(__file__).parent.parent / "claude_integration"

if DEV_ROOT.exists():
    INTEGRATION_ROOT = DEV_ROOT
else:
    INTEGRATION_ROOT = PKG_ROOT

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

    def __init__(self, root_path: Optional[Path] = None):
        """Initialize the manager.

        Args:
            root_path: Project root directory
        """
        self.root_path = root_path or Path.cwd()
        self.claude_dir = self.root_path / CLAUDE_DIR

    def install(
        self,
        components: Optional[List[str]] = None,
        force: bool = False,
        show_progress: bool = True,
    ) -> None:
        """Install Claude integration files.

        Args:
            components: List of components to install (None = all)
            force: Overwrite existing files without prompting
            show_progress: Show progress bar
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
        total_installed = 0

        # Install each component
        if show_progress:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                for component in components:
                    task = progress.add_task(f"Installing {component}...", total=None)
                    try:
                        count = self._install_component(component, force)
                        total_installed += count
                        progress.update(task, total=1, completed=1)
                        console.print(f"   Installed {count} files", style="dim")
                    except FileNotFoundError as e:
                        console.print(f"   [red]✗[/] {e}")
        else:
            for component in components:
                console.print(f"Installing {component}...")
                try:
                    count = self._install_component(component, force)
                    total_installed += count
                    console.print(f"   Installed {count} files", style="dim")
                except FileNotFoundError as e:
                    console.print(f"   [red]✗[/] {e}")

        if total_installed == 0:
            raise click.ClickException(
                "Installation failed: No files were installed. Please check your installation."
            )

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
            raise FileNotFoundError(f"Source directory not found: {source_dir}")

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

    def update(
        self, dry_run: bool = False, force: bool = False, show_progress: bool = True
    ) -> None:
        """Update installed files and remove obsolete ones.

        Args:
            dry_run: Show what would be updated without making changes
            force: Update all files without prompting
            show_progress: Show progress bar
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

        # Check for obsolete files to remove
        obsolete_files = self._detect_obsolete_files()

        if not updates and not obsolete_files:
            # Show summary even when up-to-date
            table = Table(title="Integration Status")
            table.add_column("Component", style="cyan")
            table.add_column("Files", style="green")
            table.add_column("Status", style="green")

            for component, config in self.COMPONENTS.items():
                target_dir = self.root_path / config["target"]
                if not target_dir.exists():
                    continue

                # Count files
                install_type = config.get("type", "files")
                if install_type == "directories":
                    file_count = sum(
                        1 for d in target_dir.iterdir() if d.is_dir() for _ in d.glob("*")
                    )
                elif install_type == "mixed":
                    file_count = sum(1 for _ in target_dir.rglob("*") if _.is_file())
                else:
                    file_count = len(list(target_dir.glob(f"{config['prefix']}*.md")))

                if file_count > 0:
                    table.add_row(component, str(file_count), "✓ Up to date")

            console.print(table)
            console.print("\n[green]✓[/] All files are up to date")
            return

        # Show what will change
        if updates or obsolete_files:
            table = Table(title="Planned Changes")
            table.add_column("File", style="cyan")
            table.add_column("Status", style="yellow")
            table.add_column("Action", style="green")

            for update in updates:
                table.add_row(
                    update["file"],
                    update["status"],
                    update["action"],
                )

            for obsolete in obsolete_files:
                table.add_row(
                    obsolete["file"],
                    "Obsolete",
                    "Remove",
                )

            console.print(table)

        if dry_run:
            console.print("\n[yellow]Dry run - no changes made[/]")
            return

        if not force and not Confirm.ask("\nProceed with updates?", default=True):
            console.print("Update cancelled")
            return

        # Apply updates
        if show_progress:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                # Update existing files
                for update in updates:
                    task = progress.add_task(f"Updating {update['file']}...", total=None)
                    self._apply_update(update, force)
                    progress.update(task, total=1, completed=1)

                # Remove obsolete files
                for obsolete in obsolete_files:
                    task = progress.add_task(f"Removing {obsolete['file']}...", total=None)
                    self._remove_obsolete_file(obsolete)
                    progress.update(task, total=1, completed=1)
        else:
            # Update existing files
            for update in updates:
                console.print(f"Updating {update['file']}...")
                self._apply_update(update, force)

            # Remove obsolete files
            for obsolete in obsolete_files:
                console.print(f"Removing {obsolete['file']}...")
                self._remove_obsolete_file(obsolete)

        # Update version file
        self._update_version_file()

        summary_parts = []
        if updates:
            summary_parts.append(f"{len(updates)} updated")
        if obsolete_files:
            summary_parts.append(f"{len(obsolete_files)} removed")

        console.print(f"\n[green]✓[/] Changes applied successfully ({', '.join(summary_parts)})")

        # Show comprehensive version status
        from ..core.version_checker import VersionChecker

        console.print()
        checker = VersionChecker()
        result = checker.check_all_versions()
        checker.display_version_status(result)

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
        install_type = config.get("type", "files")

        if not source_dir.exists():
            return updates

        if install_type == "directories":
            # Check skills (directory-based components)
            for skill_dir in source_dir.iterdir():
                if not skill_dir.is_dir():
                    continue

                target_skill = target_dir / skill_dir.name

                for source_file in skill_dir.iterdir():
                    if not source_file.is_file():
                        continue

                    target_file = target_skill / source_file.name
                    display_name = f"{skill_dir.name}/{source_file.name}"

                    if not target_file.exists():
                        updates.append(
                            {
                                "file": display_name,
                                "status": "New",
                                "action": "Install",
                                "source": source_file,
                                "target": target_file,
                            }
                        )
                        continue

                    # Check if modified
                    current_hash = self._compute_hash(target_file)
                    source_hash = self._compute_hash(source_file)

                    if source_hash != current_hash:
                        updates.append(
                            {
                                "file": display_name,
                                "status": "Updated",
                                "action": "Update",
                                "source": source_file,
                                "target": target_file,
                            }
                        )

        elif install_type == "mixed":
            # Check templates (mixed file types with subdirectories)
            for source_file in source_dir.rglob("*"):
                if not source_file.is_file():
                    continue

                rel_path = source_file.relative_to(source_dir)
                target_file = target_dir / rel_path
                display_name = str(rel_path)

                if not target_file.exists():
                    updates.append(
                        {
                            "file": display_name,
                            "status": "New",
                            "action": "Install",
                            "source": source_file,
                            "target": target_file,
                        }
                    )
                    continue

                # Check if modified
                current_hash = self._compute_hash(target_file)
                source_hash = self._compute_hash(source_file)

                if source_hash != current_hash:
                    updates.append(
                        {
                            "file": display_name,
                            "status": "Updated",
                            "action": "Update",
                            "source": source_file,
                            "target": target_file,
                        }
                    )

        else:  # "files" - default behavior for .md files
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
                source_hash = self._compute_hash(source_file)

                if source_hash != current_hash:
                    # Update needed (either new version or user modified)
                    updates.append(
                        {
                            "file": target_name,
                            "status": "Updated",
                            "action": "Update",
                            "source": source_file,
                            "target": target_file,
                        }
                    )

        return updates

    def _apply_update(self, update: dict, force: bool) -> None:
        """Apply an update.

        Args:
            update: Update information
            force: Force update
        """
        source = update["source"]
        target = update["target"]

        # Ensure target directory exists
        target.parent.mkdir(parents=True, exist_ok=True)

        # Copy file
        shutil.copy2(source, target)

        # Make shell scripts executable
        if source.suffix == ".sh":
            target.chmod(target.stat().st_mode | 0o111)

        action = "Installed" if update["status"] == "New" else "Updated"
        console.print(f"  [green]✓[/] {action} {update['file']}")

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

    def _detect_obsolete_files(self) -> List[Dict[str, any]]:
        """Detect files that exist locally but not in source (obsolete files).

        Returns:
            List of obsolete file information
        """
        obsolete_files = []

        for component, config in self.COMPONENTS.items():
            target_dir = self.root_path / config["target"]
            source_dir = INTEGRATION_ROOT / config["source"]
            prefix = config.get("prefix", "")
            install_type = config.get("type", "files")

            if not target_dir.exists():
                continue

            # Get files from source (what should exist)
            if install_type == "directories":
                # For skills: check subdirectories
                if source_dir.exists():
                    source_dirs = {d.name for d in source_dir.iterdir() if d.is_dir()}
                else:
                    source_dirs = set()

                # Check installed directories
                for installed_dir in target_dir.iterdir():
                    if installed_dir.is_dir() and installed_dir.name not in source_dirs:
                        obsolete_files.append(
                            {
                                "file": f"{component}/{installed_dir.name}/",
                                "path": installed_dir,
                                "type": "directory",
                                "component": component,
                            }
                        )

            elif install_type == "files":
                # For agents/commands: check .md files
                if source_dir.exists():
                    source_files = {f.name for f in source_dir.glob("*.md")}
                else:
                    source_files = set()

                # Check installed files (accounting for prefix)
                for installed_file in target_dir.glob(f"{prefix}*.md"):
                    # Remove prefix to get the base filename
                    base_name = (
                        installed_file.name[len(prefix) :] if prefix else installed_file.name
                    )
                    if base_name not in source_files:
                        obsolete_files.append(
                            {
                                "file": installed_file.name,
                                "path": installed_file,
                                "type": "file",
                                "component": component,
                            }
                        )

        return obsolete_files

    def _remove_obsolete_file(self, obsolete: dict) -> None:
        """Remove an obsolete file or directory.

        Args:
            obsolete: Obsolete file/directory information
        """
        path = obsolete["path"]

        if obsolete["type"] == "directory":
            # Remove directory and contents
            shutil.rmtree(path)
            console.print(f"  [red]✗[/] Removed obsolete {obsolete['file']}")
        else:
            # Remove file
            path.unlink()
            console.print(f"  [red]✗[/] Removed obsolete {obsolete['file']}")

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
        # Disable progress spinner when prompts might be needed
        # to avoid UI conflicts between spinner and Confirm.ask()
        show_progress = force
        manager.install(components=components, force=force, show_progress=show_progress)
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
        # Disable progress spinner when prompts might be needed
        # to avoid UI conflicts between spinner and Confirm.ask()
        show_progress = force or dry_run
        manager.update(dry_run=dry_run, force=force, show_progress=show_progress)
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
