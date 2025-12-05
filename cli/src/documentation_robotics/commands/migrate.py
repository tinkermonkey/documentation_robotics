"""Migrate command - Migrate models to new specification versions.

This module implements the 'dr migrate' command for automatically
migrating models from their current version to the latest version.
"""

from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..core.manifest import ManifestManager
from ..core.migration_registry import MigrationRegistry

console = Console()


@click.command(name="migrate")
@click.option(
    "--check",
    "mode",
    flag_value="check",
    help="Check what migrations are needed (default behavior)",
)
@click.option(
    "--dry-run",
    "mode",
    flag_value="dry-run",
    help="Show what would be migrated without applying changes",
)
@click.option(
    "--apply", "mode", flag_value="apply", help="Apply all migrations to upgrade to latest version"
)
@click.option("--to-version", type=str, help="Migrate to a specific version (defaults to latest)")
@click.option(
    "--model-dir",
    type=click.Path(exists=True),
    default="./documentation-robotics/model",
    help="Model directory path",
)
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["text", "json"]),
    default="text",
    help="Output format",
)
def migrate(mode: str, to_version: str, model_dir: str, output_format: str):
    """Migrate model to latest specification version.

    This command automatically detects your model's current version and
    applies all necessary migrations to bring it up to the latest version
    (or a specified target version).

    Examples:
        # Check what migrations are needed
        dr migrate
        dr migrate --check

        # Preview changes without applying
        dr migrate --dry-run

        # Apply all migrations to latest version
        dr migrate --apply

        # Migrate to specific version
        dr migrate --apply --to-version 1.0.0
    """
    try:
        model_path = Path(model_dir)
        manifest_path = model_path / "manifest.yaml"

        if not manifest_path.exists():
            console.print(f"[red]Error: Model manifest not found: {manifest_path}[/red]")
            console.print(
                "\n[yellow]Are you in a Documentation Robotics project directory?[/yellow]"
            )
            console.print("Initialize a project with: [cyan]dr init <project-name>[/cyan]")
            raise click.Abort()

        # Load manifest to get current version
        manifest_mgr = ManifestManager()
        manifest = manifest_mgr.load()
        current_version = manifest.specification_version

        # Initialize migration registry
        registry = MigrationRegistry()
        latest_version = registry.get_latest_version()

        # Default mode is check
        if mode is None:
            mode = "check"

        # Display current state
        if mode in ["check", "dry-run"]:
            _display_current_state(current_version, latest_version, to_version)

        # Check if migration is needed
        target = to_version or latest_version
        migration_path = registry.get_migration_path(current_version, target)

        if not migration_path:
            console.print(f"\n[green]✓ Your model is already at version {current_version}[/green]")
            if to_version and to_version != current_version:
                console.print(
                    f"[yellow]Note: Target version {to_version} is not newer than current version[/yellow]"
                )
            else:
                console.print("[green]No migrations needed![/green]")
            return

        # Execute based on mode
        if mode == "check":
            _display_check_results(registry, current_version, target)
        elif mode == "dry-run":
            _display_dry_run_results(registry, model_path, current_version, target)
        elif mode == "apply":
            _apply_migrations(registry, manifest_mgr, model_path, current_version, target)

    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")
        import traceback

        traceback.print_exc()
        raise click.Abort()


def _display_current_state(current: str, latest: str, target: str):
    """Display current model state.

    Args:
        current: Current version
        latest: Latest available version
        target: Target version (or None)
    """
    console.print(f"\n[bold]Current Model Version:[/bold] [cyan]{current}[/cyan]")
    console.print(f"[bold]Latest Available Version:[/bold] [cyan]{latest}[/cyan]")
    if target:
        console.print(f"[bold]Target Version:[/bold] [cyan]{target}[/cyan]")


def _display_check_results(registry: MigrationRegistry, from_version: str, to_version: str):
    """Display check results (summary of needed migrations).

    Args:
        registry: MigrationRegistry instance
        from_version: Current version
        to_version: Target version
    """
    summary = registry.get_migration_summary(from_version, to_version)

    console.print(
        Panel(
            f"[yellow]{summary['migrations_needed']} migration(s) needed to upgrade "
            f"from v{from_version} to v{to_version}[/yellow]",
            title="Migration Check",
            border_style="yellow",
        )
    )

    if summary["migrations_needed"] > 0:
        table = Table(title="Migration Path")
        table.add_column("Step", style="cyan", justify="right")
        table.add_column("From", style="yellow")
        table.add_column("To", style="green")
        table.add_column("Description")

        for i, migration in enumerate(summary["migrations"], 1):
            table.add_row(str(i), migration["from"], migration["to"], migration["description"])

        console.print(table)

        console.print("\n[bold]Next steps:[/bold]")
        console.print("  1. Preview changes: [cyan]dr migrate --dry-run[/cyan]")
        console.print("  2. Apply migrations: [cyan]dr migrate --apply[/cyan]")
        console.print("  3. Update Claude integration: [cyan]dr claude update[/cyan]")
        console.print("  4. Validate result: [cyan]dr validate --validate-links[/cyan]")


def _display_dry_run_results(
    registry: MigrationRegistry, model_path: Path, from_version: str, to_version: str
):
    """Display dry-run results (detailed preview of changes).

    Args:
        registry: MigrationRegistry instance
        model_path: Path to model directory
        from_version: Current version
        to_version: Target version
    """
    from ..core.link_migrator import LinkMigrator
    from ..core.link_registry import LinkRegistry

    summary = registry.get_migration_summary(from_version, to_version)

    console.print(
        Panel(
            f"[yellow]Preview: {summary['migrations_needed']} migration(s) "
            f"from v{from_version} to v{to_version}[/yellow]",
            title="Dry Run",
            border_style="yellow",
        )
    )

    # Show each migration step
    for i, migration in enumerate(summary["migrations"], 1):
        console.print(f"\n[bold cyan]Step {i}: {migration['from']} → {migration['to']}[/bold cyan]")
        console.print(f"[dim]{migration['description']}[/dim]")

        # For link migrations, show detailed changes
        if "link" in migration["description"].lower() or migration["to"] == "1.0.0":
            try:
                link_registry = LinkRegistry()
                migrator = LinkMigrator(link_registry, model_path)
                migrations = migrator.analyze_model()

                if migrations:
                    console.print(f"\n  Found {len(migrations)} changes:")

                    # Group by file
                    by_file = {}
                    for m in migrations:
                        file_str = str(m.file_path)
                        if file_str not in by_file:
                            by_file[file_str] = []
                        by_file[file_str].append(m)

                    # Show first few files
                    for file_path, file_migrations in list(by_file.items())[:3]:
                        console.print(f"\n  [cyan]{Path(file_path).name}[/cyan]")
                        for m in file_migrations[:2]:
                            console.print(f"    • {m.element_id}: {m.old_field} → {m.new_field}")

                        if len(file_migrations) > 2:
                            console.print(f"    ... and {len(file_migrations) - 2} more")

                    if len(by_file) > 3:
                        console.print(f"\n  ... and {len(by_file) - 3} more files")
                else:
                    console.print("  [green]✓ No changes needed for this step[/green]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Could not preview: {e}[/yellow]")

    console.print("\n[bold]To apply these migrations:[/bold]")
    console.print("  Run [cyan]dr migrate --apply[/cyan]")


def _apply_migrations(
    registry: MigrationRegistry,
    manifest_mgr: ManifestManager,
    model_path: Path,
    from_version: str,
    to_version: str,
):
    """Apply migrations to upgrade the model.

    Args:
        registry: MigrationRegistry instance
        manifest_mgr: ManifestManager instance
        model_path: Path to model directory
        from_version: Current version
        to_version: Target version
    """
    summary = registry.get_migration_summary(from_version, to_version)

    console.print(
        Panel(
            f"[yellow]Migrating from v{from_version} to v{to_version}[/yellow]\n"
            f"[yellow]{summary['migrations_needed']} migration step(s) will be applied[/yellow]",
            title="Applying Migrations",
            border_style="yellow",
        )
    )

    # Show migration path
    for i, migration in enumerate(summary["migrations"], 1):
        console.print(f"  {i}. {migration['from']} → {migration['to']}: {migration['description']}")

    # Confirm before applying
    console.print()
    if not click.confirm("This will modify your model files. Continue?", default=False):
        console.print("[yellow]Migration cancelled.[/yellow]")
        raise click.Abort()

    # Apply migrations
    console.print("\n[bold]Applying migrations...[/bold]")

    results = registry.apply_migrations(
        model_path=model_path, from_version=from_version, to_version=to_version, dry_run=False
    )

    # Display results
    if results["applied"]:
        console.print(
            f"\n[green]✓ Successfully applied {len(results['applied'])} migration(s)[/green]"
        )

        for i, applied in enumerate(results["applied"], 1):
            console.print(f"  {i}. {applied['from']} → {applied['to']}")
            if "changes" in applied:
                changes = applied["changes"]
                if changes.get("migrations_applied", 0) > 0:
                    console.print(
                        f"     Modified {changes.get('files_modified', 0)} file(s), "
                        f"{changes.get('migrations_applied', 0)} change(s)"
                    )

        # Update manifest
        manifest = manifest_mgr.load()
        manifest.specification_version = results["target_version"]
        manifest_mgr.save()

        console.print(f"\n[green]✓ Updated manifest to v{results['target_version']}[/green]")

        # Update Claude integration if installed
        try:
            from .claude import ClaudeIntegrationManager

            claude_mgr = ClaudeIntegrationManager()
            if claude_mgr._is_installed():
                console.print("\n[bold]Updating Claude integration...[/bold]")
                claude_mgr.update(force=True, show_progress=True)
        except Exception as e:
            console.print(f"[yellow]⚠ Could not update Claude integration: {e}[/yellow]")

        console.print("\n[bold]Next steps:[/bold]")
        console.print("  1. Review changes: [cyan]git diff[/cyan]")
        console.print("  2. Validate model: [cyan]dr validate --validate-links[/cyan]")
        console.print("  3. Test your application")
        console.print("  4. Commit changes: [cyan]git add . && git commit[/cyan]")
    else:
        console.print("[yellow]⚠ No migrations were applied.[/yellow]")
