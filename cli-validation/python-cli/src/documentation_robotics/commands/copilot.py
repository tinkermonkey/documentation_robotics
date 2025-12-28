"""
Manage GitHub Copilot integration files.
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
# 1. Check for development environment (files in integrations/github_copilot)
# 2. Fallback to package directory (files in copilot_integration)
DEV_ROOT = Path(__file__).parents[4] / "integrations" / "github_copilot"
PKG_ROOT = Path(__file__).parent.parent / "copilot_integration"

if DEV_ROOT.exists():
    INTEGRATION_ROOT = DEV_ROOT
else:
    INTEGRATION_ROOT = PKG_ROOT

# Target locations (relative to project root)
GITHUB_DIR = Path(".github")
AGENTS_DIR = GITHUB_DIR / "agents"
SKILLS_DIR = GITHUB_DIR / "skills"
VERSION_FILE = GITHUB_DIR / ".dr-copilot-version"


class CopilotIntegrationManager:
    """Manages GitHub Copilot integration files."""

    COMPONENTS = {
        "agents": {
            "source": "agents",
            "target": AGENTS_DIR,
            "description": "Agent definitions for Copilot",
            "prefix": "",
            "type": "files",
        },
        "skills": {
            "source": "skills",
            "target": SKILLS_DIR,
            "description": "Skills for Copilot",
            "prefix": "",
            "type": "directories",
        },
    }

    def __init__(self, root_path: Optional[Path] = None):
        """Initialize the manager.

        Args:
            root_path: Project root directory
        """
        self.root_path = root_path or Path.cwd()
        self.github_dir = self.root_path / GITHUB_DIR

    def install(
        self,
        components: Optional[List[str]] = None,
        force: bool = False,
        show_progress: bool = True,
    ) -> None:
        """Install Copilot integration files.

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

        # Create .github directory if needed
        if not self.github_dir.exists():
            self.github_dir.mkdir(parents=True)
            console.print("[green]✓[/] Created .github/ directory")

        components = components or list(self.COMPONENTS.keys())

        total_installed = 0
        errors = []

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
                    except Exception as e:
                        errors.append(f"{component}: {str(e)}")
                        progress.update(task, total=1, completed=1)
        else:
            for component in components:
                console.print(f"Installing {component}...")
                try:
                    count = self._install_component(component, force)
                    total_installed += count
                    console.print(f"   Installed {count} files", style="dim")
                except Exception as e:
                    errors.append(f"{component}: {str(e)}")

        # Create version file
        self._update_version_file()

        # Report status
        if errors:
            console.print("\n[red]✗[/] Installation completed with errors:")
            for error in errors:
                console.print(f"  - {error}")
        elif total_installed == 0:
            console.print(
                "\n[yellow]⚠[/] No files were installed. Check your installation or source paths."
            )
        else:
            console.print("\n[green]✓[/] Copilot integration installed successfully!")
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
            raise FileNotFoundError(f"Source directory not found: {source_dir}")

        count = 0

        # Handle different installation types
        if install_type == "files":
            # Install files directly in the target directory
            for source_file in source_dir.glob("*"):
                if not source_file.is_file():
                    continue

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

        elif install_type == "directories":
            # Install subdirectories with their contents
            for source_subdir in source_dir.iterdir():
                if not source_subdir.is_dir():
                    continue

                target_subdir = target_dir / source_subdir.name

                # Check if directory exists
                if target_subdir.exists() and not force:
                    if not Confirm.ask(
                        f"  {source_subdir.name}/ exists. Overwrite?", default=False
                    ):
                        console.print(f"  Skipped {source_subdir.name}/", style="dim")
                        continue
                    # Remove existing directory if overwriting
                    shutil.rmtree(target_subdir)

                # Copy directory
                shutil.copytree(source_subdir, target_subdir)
                file_count = len(list(target_subdir.rglob("*")))
                console.print(f"  [green]✓[/] {source_subdir.name}/ ({file_count} files)")
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
            console.print("[red]✗[/] Copilot integration not installed")
            console.print("Run [cyan]dr copilot install[/] first")
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
            console.print("[green]✓[/] All files are up to date")
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
            # Handle directory-based components
            for source_subdir in source_dir.iterdir():
                if not source_subdir.is_dir():
                    continue

                target_subdir = target_dir / source_subdir.name

                if not target_subdir.exists():
                    # New directory
                    updates.append(
                        {
                            "file": f"{source_subdir.name}/",
                            "status": "New",
                            "action": "Install",
                            "source": source_subdir,
                            "target": target_subdir,
                        }
                    )
                    continue

                # Check if any files in the directory have changed
                has_changes = False
                for source_file in source_subdir.rglob("*"):
                    if not source_file.is_file():
                        continue

                    rel_path = source_file.relative_to(source_subdir)
                    target_file = target_subdir / rel_path

                    if not target_file.exists():
                        has_changes = True
                        break

                    if self._compute_hash(source_file) != self._compute_hash(target_file):
                        has_changes = True
                        break

                if has_changes:
                    updates.append(
                        {
                            "file": f"{source_subdir.name}/",
                            "status": "Update",
                            "action": "Update",
                            "source": source_subdir,
                            "target": target_subdir,
                        }
                    )
        else:
            # Handle file-based components
            for source_file in source_dir.glob("*"):
                if not source_file.is_file():
                    continue

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
                    # Update needed
                    updates.append(
                        {
                            "file": target_name,
                            "status": "Update",
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

        if source.is_dir():
            # Handle directory updates
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)
            console.print(f"  [green]✓[/] Updated {update['file']}")
        else:
            # Handle file updates
            shutil.copy2(source, target)
            console.print(f"  [green]✓[/] Updated {target.name}")

    def remove(self, components: Optional[List[str]] = None, force: bool = False) -> None:
        """Remove installed files.

        Args:
            components: Components to remove (None = all)
            force: Remove without confirmation
        """
        if not self._is_installed():
            console.print("[yellow]⚠[/] Copilot integration not installed")
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
        install_type = config.get("type", "files")

        if not target_dir.exists():
            return

        if install_type == "directories":
            # Remove subdirectories
            for subdir in target_dir.iterdir():
                if subdir.is_dir():
                    shutil.rmtree(subdir)
                    console.print(f"  [red]✗[/] Removed {subdir.name}/")
        else:
            # Remove files with prefix
            for file in target_dir.glob(f"{prefix}*"):
                if file.is_file():
                    file.unlink()
                    console.print(f"  [red]✗[/] Removed {file.name}")

    def status(self) -> None:
        """Show installation status."""
        if not self._is_installed():
            console.print("[yellow]Copilot integration not installed[/]")
            console.print("Run [cyan]dr copilot install[/] to get started")
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
            install_type = config.get("type", "files")

            if not target_dir.exists():
                table.add_row(component, "0", "-")
                continue

            if install_type == "directories":
                # Count subdirectories for directory-based components
                items = [d for d in target_dir.iterdir() if d.is_dir()]
                # For modified count, check if any files in subdirs are modified
                modified_count = 0
                for subdir in items:
                    for f in subdir.rglob("*"):
                        if f.is_file() and self._is_modified(f, component, version_data):
                            modified_count += 1
                            break  # Only count once per subdirectory
            else:
                # Count files for file-based components
                items = [f for f in target_dir.glob(f"{prefix}*") if f.is_file()]
                modified_count = sum(
                    1 for f in items if self._is_modified(f, component, version_data)
                )

            table.add_row(
                component,
                str(len(items)),
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
            for file in target_dir.glob(f"{prefix}*"):
                if not file.is_file():
                    continue
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

            if install_type == "directories":
                # Handle directory-based components
                if source_dir.exists():
                    source_subdirs = {d.name for d in source_dir.iterdir() if d.is_dir()}
                else:
                    source_subdirs = set()

                # Check installed directories
                for installed_dir in target_dir.iterdir():
                    if not installed_dir.is_dir():
                        continue

                    if installed_dir.name not in source_subdirs:
                        obsolete_files.append(
                            {
                                "file": f"{installed_dir.name}/",
                                "path": installed_dir,
                                "type": "directory",
                                "component": component,
                            }
                        )
            else:
                # Handle file-based components
                if source_dir.exists():
                    source_files = {f.name for f in source_dir.glob("*") if f.is_file()}
                else:
                    source_files = set()

                # Check installed files (accounting for prefix)
                for installed_file in target_dir.glob(f"{prefix}*"):
                    if not installed_file.is_file():
                        continue

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
        if obsolete.get("type") == "directory":
            shutil.rmtree(path)
        else:
            path.unlink()
        console.print(f"  [red]✗[/] Removed obsolete {obsolete['file']}")

    def _print_next_steps(self) -> None:
        """Print helpful next steps."""
        console.print("\n[bold]Next steps:[/]")
        console.print("1. Agents are available in .github/agents/")
        console.print("2. Skills are available in .github/skills/")
        console.print("3. Run [cyan]dr copilot status[/] to see what's installed")


# CLI Commands


@click.group()
def copilot():
    """Manage GitHub Copilot integration."""
    pass


@copilot.command()
@click.option(
    "--skills-only",
    is_flag=True,
    help="Install only skills",
)
@click.option(
    "--agents-only",
    is_flag=True,
    help="Install only agents",
)
@click.option(
    "--force",
    is_flag=True,
    help="Overwrite existing files without prompting",
)
def install(skills_only, agents_only, force):
    """Install GitHub Copilot integration files."""
    manager = CopilotIntegrationManager()

    components = None
    if skills_only:
        components = ["skills"]
    elif agents_only:
        components = ["agents"]

    try:
        manager.install(components=components, force=force)
    except Exception as e:
        console.print(f"[red]✗ Error during installation: {e}[/]")
        raise click.Abort()


@copilot.command()
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
    """Update installed Copilot integration files."""
    manager = CopilotIntegrationManager()

    try:
        manager.update(dry_run=dry_run, force=force)
    except Exception as e:
        console.print(f"[red]✗ Error during update: {e}[/]")
        raise click.Abort()


@copilot.command()
@click.option(
    "--force",
    is_flag=True,
    help="Remove without confirmation",
)
@click.option(
    "--knowledge",
    is_flag=True,
    help="Remove only knowledge base",
)
@click.option(
    "--agents",
    is_flag=True,
    help="Remove only agents",
)
def remove(force, knowledge, agents):
    """Remove GitHub Copilot integration files."""
    manager = CopilotIntegrationManager()

    components = None
    if knowledge:
        components = ["knowledge"]
    elif agents:
        components = ["agents"]

    try:
        manager.remove(components=components, force=force)
    except Exception as e:
        console.print(f"[red]✗ Error during removal: {e}[/]")
        raise click.Abort()


@copilot.command()
def status():
    """Show GitHub Copilot integration status."""
    manager = CopilotIntegrationManager()
    manager.status()


@copilot.command(name="list")
def list_components():
    """List available components."""
    manager = CopilotIntegrationManager()
    manager.list_components()
