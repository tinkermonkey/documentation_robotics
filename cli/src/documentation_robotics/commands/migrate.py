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
from ..core.transformations import MigrationError

console = Console()


@click.command(name="migrate")
@click.option(
    "--dry-run",
    is_flag=True,
    help="Preview changes without applying (shows detailed migration plan)",
)
@click.option(
    "--force",
    is_flag=True,
    help="Apply migrations without confirmation prompt (for automation)",
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
def migrate(dry_run: bool, force: bool, to_version: str, model_dir: str, output_format: str):
    """Migrate model to latest specification version.

    This command automatically detects your model's current version and
    applies all necessary migrations to bring it up to the latest version
    (or a specified target version).

    By default, the command shows the migration plan and prompts for confirmation
    before applying changes. Use --dry-run to preview without prompting.

    Examples:
        # Apply migrations (with confirmation prompt)
        dr migrate

        # Apply migrations without confirmation (for automation)
        dr migrate --force

        # Preview migrations without applying
        dr migrate --dry-run

        # Migrate to specific version
        dr migrate --to-version 0.5.0

        # Preview migration to specific version
        dr migrate --to-version 0.5.0 --dry-run
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

        # Display current state
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

        # Execute migration
        if dry_run:
            _display_dry_run_results(registry, model_path, current_version, target)
        else:
            _apply_migrations(
                registry, manifest_mgr, model_path, current_version, target, force=force
            )

    except MigrationError:
        # MigrationError already handled above
        raise click.Abort()
    except Exception as e:
        console.print(f"[red]Unexpected error: {e}[/red]")
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
    console.print("  Run [cyan]dr migrate[/cyan] (with confirmation)")
    console.print("  Run [cyan]dr migrate --force[/cyan] (skip confirmation)")


def _apply_migrations(
    registry: MigrationRegistry,
    manifest_mgr: ManifestManager,
    model_path: Path,
    from_version: str,
    to_version: str,
    force: bool = False,
):
    """Apply migrations to upgrade the model.

    Args:
        registry: MigrationRegistry instance
        manifest_mgr: ManifestManager instance
        model_path: Path to model directory
        from_version: Current version
        to_version: Target version
        force: Skip confirmation prompt
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

    # Confirm before applying (unless --force)
    if not force:
        console.print()
        if not click.confirm("This will modify your model files. Continue?", default=False):
            console.print("[yellow]Migration cancelled.[/yellow]")
            raise click.Abort()

    # Apply migrations
    console.print("\n[bold]Applying migrations...[/bold]")

    try:
        results = registry.apply_migrations(
            model_path=model_path,
            from_version=from_version,
            to_version=to_version,
            dry_run=False,
            validate=True,
        )
    except MigrationError as e:
        console.print(f"\n[red]✗ Migration failed:[/red] {e}")
        if e.file_path:
            console.print(f"[yellow]File:[/yellow] {e.file_path}")
        if e.element_id:
            console.print(f"[yellow]Element ID:[/yellow] {e.element_id}")
        if e.transformation:
            console.print(f"[yellow]Transformation:[/yellow] {e.transformation}")

        console.print("\n[bold]To restore your model:[/bold]")
        console.print("  [cyan]git restore .[/cyan]")
        console.print(
            "\n[dim]Your model has been modified. Use git to restore it before retrying.[/dim]"
        )
        raise click.Abort()

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

        # Sync schemas to match new spec version
        try:
            from .init import ModelInitializer

            console.print("\n[bold]Syncing schemas...[/bold]")
            initializer = ModelInitializer(
                root_path=model_path.parent.parent,  # Go up from model/ to project root
                project_name=manifest.project.get("name", ""),
                template="basic",
                minimal=False,
                with_examples=False,
            )
            initializer._create_schemas()
            console.print("[green]✓ Schemas synced[/green]")
        except Exception as e:
            console.print(f"[yellow]⚠ Could not sync schemas: {e}[/yellow]")

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

        # Show comprehensive version status
        from ..core.version_checker import VersionChecker

        console.print()
        checker = VersionChecker(root_path=model_path.parent.parent)
        result = checker.check_all_versions()
        checker.display_version_status(result)
    else:
        console.print("[yellow]⚠ No migrations were applied.[/yellow]")
