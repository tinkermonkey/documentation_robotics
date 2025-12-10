"""
Update project files to match current CLI version.
"""

from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from ..core.upgrade_manager import UpgradeManager

console = Console()


@click.command(name="update")
@click.option(
    "--force",
    is_flag=True,
    help="Force update even if versions match",
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Show what would be updated without making changes",
)
def update_project(force: bool, dry_run: bool):
    """Update project files to match current CLI version.

    This command checks if the CLI has been updated and synchronizes:
    - Schema files in .dr/schemas/
    - Claude Code integration files
    - GitHub Copilot integration files
    - Manifest structure
    - Documentation files

    By default, you'll be prompted before changes are made.
    Use --force to update without prompting.

    Examples:
        # Check and update project (with confirmation)
        dr update

        # Preview what would be updated
        dr update --dry-run

        # Update without confirmation
        dr update --force
    """
    # Check if we're in a DR project
    manifest_path = Path.cwd() / "documentation-robotics" / "model" / "manifest.yaml"
    if not manifest_path.exists():
        console.print("[red]✗[/] Not in a Documentation Robotics project directory")
        console.print("Run [cyan]dr init[/] to create a new project")
        raise click.Abort()

    manager = UpgradeManager()

    if dry_run:
        # Show what would be updated
        console.print("[bold]Checking for available updates...[/]\n")

        info = manager.get_version_info()
        table = Table(title="Version Information")
        table.add_column("Component", style="cyan")
        table.add_column("Version", style="green")

        table.add_row("CLI", info["cli_version"])
        table.add_row("Project", info["manifest_version"] or "unknown")

        if info["claude_version"]:
            table.add_row("Claude Integration", info["claude_version"])

        console.print(table)
        console.print()

        # This will show what needs updating
        try:
            manager.check_and_upgrade(auto=False, force=True)
        except Exception as e:
            console.print(f"[red]✗[/] Error: {e}")
            raise click.Abort()
    else:
        # Perform update
        try:
            upgraded = manager.check_and_upgrade(auto=True, force=force)

            if not upgraded and not force:
                console.print("[green]✓[/] Project is already up to date")

            # Show comprehensive version status after update
            if upgraded or force:
                from ..core.version_checker import VersionChecker

                console.print()
                checker = VersionChecker()
                result = checker.check_all_versions()
                checker.display_version_status(result)

        except Exception as e:
            console.print(f"[red]✗[/] Update failed: {e}")
            raise click.Abort()


@click.command(name="version")
def version_info():
    """Show version information."""
    manifest_path = Path.cwd() / "documentation-robotics" / "model" / "manifest.yaml"
    if not manifest_path.exists():
        console.print("[yellow]⚠[/] Not in a Documentation Robotics project")
        return

    manager = UpgradeManager()
    info = manager.get_version_info()

    table = Table(title="Version Information")
    table.add_column("Component", style="cyan", no_wrap=True)
    table.add_column("Version", style="green")
    table.add_column("Status", style="yellow")

    # CLI version
    table.add_row("CLI", info["cli_version"], "current")

    # Project version
    manifest_version = info["manifest_version"]
    if manifest_version:
        if manifest_version == info["cli_version"]:
            status = "✓ up to date"
            style = "green"
        else:
            status = "⚠ upgrade available"
            style = "yellow"
        table.add_row("Project", manifest_version, f"[{style}]{status}[/]")
    else:
        table.add_row("Project", "unknown", "[red]✗ no version[/]")

    # Claude integration
    claude_version = info["claude_version"]
    if claude_version:
        if claude_version == info["cli_version"]:
            status = "✓ up to date"
            style = "green"
        else:
            status = "⚠ upgrade available"
            style = "yellow"
        table.add_row("Claude Integration", claude_version, f"[{style}]{status}[/]")

    console.print(table)

    # Show update hint if needed
    if manifest_version and manifest_version != info["cli_version"]:
        console.print("\n[yellow]Run [cyan]dr update[/] to update your project[/]")
