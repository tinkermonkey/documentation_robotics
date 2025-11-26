"""
Changeset commands - manage changesets for tracking model changes.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.table import Table

from ..core.changeset_manager import ChangesetManager
from ..core.element import Element
from ..core.model import Model

console = Console()


@click.group()
def changeset():
    """Manage changesets for tracking model changes."""
    pass


@changeset.command()
@click.argument("name")
@click.option(
    "--type",
    "changeset_type",
    default="feature",
    help="Changeset type (feature, bugfix, exploration)",
)
@click.option("--description", default="", help="Description of the changeset")
@click.option("--no-activate", is_flag=True, help="Don't set as active changeset")
def create(name: str, changeset_type: str, description: str, no_activate: bool):
    """Create a new changeset."""
    try:
        manager = ChangesetManager(Path.cwd())
        changeset_id = manager.create(
            name=name,
            changeset_type=changeset_type,
            description=description,
            set_active=not no_activate,
        )

        if not no_activate:
            console.print(f"✓ Created and activated changeset: {changeset_id}", style="green")
            console.print("  All commands will now work in this changeset", style="dim")
        else:
            console.print(f"✓ Created changeset: {changeset_id}", style="green")
            console.print(f"  Use 'dr changeset switch {changeset_id}' to activate", style="dim")

    except Exception as e:
        console.print(f"✗ Error creating changeset: {e}", style="red bold")
        raise click.Abort()


@changeset.command(name="list")
@click.option("--status", help="Filter by status (active, applied, abandoned)")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def list_changesets(status: Optional[str], output_json: bool):
    """List all changesets."""
    try:
        manager = ChangesetManager(Path.cwd())
        changesets = manager.list(status_filter=status)

        if output_json:
            click.echo(json.dumps(changesets, indent=2))
            return

        if not changesets:
            console.print("No changesets found", style="yellow")
            return

        # Display as rich table
        active_id = manager.get_active()
        table = Table(title="Changesets")
        table.add_column("ID", style="cyan")
        table.add_column("Name")
        table.add_column("Status")
        table.add_column("Type")
        table.add_column("Changes", justify="right")

        for cs in changesets:
            style = "bold green" if cs["id"] == active_id else ""
            marker = "► " if cs["id"] == active_id else "  "

            # Color status
            status_str = cs["status"]
            if cs["status"] == "active":
                status_str = f"[green]{status_str}[/green]"
            elif cs["status"] == "applied":
                status_str = f"[blue]{status_str}[/blue]"
            elif cs["status"] == "abandoned":
                status_str = f"[dim]{status_str}[/dim]"

            table.add_row(
                marker + cs["id"],
                cs["name"],
                status_str,
                cs["type"],
                str(cs["elements_count"]),
                style=style,
            )

        console.print(table)

        # Show active changeset note
        if active_id:
            console.print(f"\n[dim]Active: {active_id}[/dim]")

    except Exception as e:
        console.print(f"✗ Error listing changesets: {e}", style="red bold")
        raise click.Abort()


@changeset.command()
@click.argument("changeset_id")
def switch(changeset_id: str):
    """Switch to a different changeset."""
    try:
        manager = ChangesetManager(Path.cwd())

        # Check if changeset exists
        if not manager.changeset_exists(changeset_id):
            console.print(f"✗ Changeset '{changeset_id}' not found", style="red bold")
            raise click.Abort()

        # Set as active
        manager.set_active(changeset_id)

        # Load changeset to show info
        cs = manager.load_changeset(changeset_id)

        console.print(f"✓ Switched to changeset: {changeset_id}", style="green")
        console.print(f"  {cs.metadata.name}", style="dim")
        console.print(f"  {cs.get_element_count()} changes", style="dim")

    except Exception as e:
        console.print(f"✗ Error switching changeset: {e}", style="red bold")
        raise click.Abort()


@changeset.command()
@click.argument("changeset_id", required=False)
@click.option("--verbose", "-v", is_flag=True, help="Show detailed information")
def status(changeset_id: Optional[str], verbose: bool):
    """Show changeset status and changes."""
    try:
        manager = ChangesetManager(Path.cwd())

        # If no ID provided, use active changeset
        if not changeset_id:
            changeset_id = manager.get_active()
            if not changeset_id:
                console.print("No active changeset", style="yellow")
                console.print("  Create one with: dr changeset create <name>", style="dim")
                return

        # Load changeset
        cs = manager.load_changeset(changeset_id)

        # Display header
        console.print(f"\n[bold]{cs.metadata.name}[/bold]")
        console.print(f"ID: {cs.id}")
        console.print(f"Type: {cs.metadata.type}")

        # Color status
        status_str = cs.metadata.status
        if cs.metadata.status == "active":
            status_str = f"[green]{status_str}[/green]"
        elif cs.metadata.status == "applied":
            status_str = f"[blue]{status_str}[/blue]"
        elif cs.metadata.status == "abandoned":
            status_str = f"[dim]{status_str}[/dim]"

        console.print(f"Status: {status_str}")

        if cs.metadata.description:
            console.print(f"Description: {cs.metadata.description}")

        console.print(f"Created: {cs.metadata.created_at.strftime('%Y-%m-%d %H:%M:%S')}")
        console.print(f"Updated: {cs.metadata.updated_at.strftime('%Y-%m-%d %H:%M:%S')}")

        # Display changes summary
        console.print("\n[bold]Changes:[/bold]")
        summary = cs.metadata.summary
        console.print(f"  Added: {summary.get('elements_added', 0)}")
        console.print(f"  Updated: {summary.get('elements_updated', 0)}")
        console.print(f"  Deleted: {summary.get('elements_deleted', 0)}")

        if cs.get_affected_layers():
            console.print(f"  Layers: {', '.join(cs.get_affected_layers())}")

        # Display recent changes
        changes = cs.get_changes()
        if changes:
            console.print("\n[bold]Recent changes:[/bold]")
            # Show last 10 changes (or all if verbose)
            display_changes = changes if verbose else changes[-10:]

            for change in display_changes:
                # Color by operation
                op_str = change.operation
                if change.operation == "add":
                    op_str = f"[green]{op_str:6}[/green]"
                elif change.operation == "update":
                    op_str = f"[yellow]{op_str:6}[/yellow]"
                elif change.operation == "delete":
                    op_str = f"[red]{op_str:6}[/red]"

                console.print(f"  {op_str} {change.element_id}")

            if not verbose and len(changes) > 10:
                console.print(
                    f"\n  ... and {len(changes) - 10} more. Use --verbose to see all.", style="dim"
                )

    except Exception as e:
        console.print(f"✗ Error showing status: {e}", style="red bold")
        raise click.Abort()


@changeset.command()
@click.argument("changeset_id", required=False)
@click.option("--preview", is_flag=True, help="Preview changes without applying")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt")
def apply(changeset_id: Optional[str], preview: bool, yes: bool):
    """Apply changeset changes to main model."""
    try:
        manager = ChangesetManager(Path.cwd())

        # If no ID provided, use active changeset
        if not changeset_id:
            changeset_id = manager.get_active()
            if not changeset_id:
                console.print("No active changeset to apply", style="yellow")
                return

        # Load changeset
        cs = manager.load_changeset(changeset_id)

        # Show what will be applied
        console.print(f"\n[bold]Changeset: {cs.metadata.name}[/bold]")
        console.print(f"Status: {cs.metadata.status}")
        console.print(f"Changes to apply: {cs.get_element_count()}")

        # Display changes
        console.print("\n[bold]Changes:[/bold]")
        for change in cs.get_changes():
            op_str = change.operation
            if change.operation == "add":
                op_str = f"[green]{op_str:6}[/green]"
            elif change.operation == "update":
                op_str = f"[yellow]{op_str:6}[/yellow]"
            elif change.operation == "delete":
                op_str = f"[red]{op_str:6}[/red]"

            console.print(f"  {op_str} {change.element_id}")

        # Preview mode - just show and exit
        if preview:
            console.print("\n[dim]Preview mode - no changes applied[/dim]")
            return

        # Confirm unless --yes flag
        if not yes:
            if not click.confirm("\nApply these changes to main model?"):
                console.print("Cancelled", style="yellow")
                return

        # Apply changes to main model
        console.print("\n[bold]Applying changes...[/bold]")
        main_model = Model(Path.cwd())

        applied_count = 0
        errors = []

        for change in cs.get_changes():
            try:
                if change.operation == "add":
                    element = Element(
                        id=change.element_id,
                        element_type=change.element_type,
                        layer=change.layer,
                        data=change.data or {},
                    )
                    main_model.add_element(change.layer, element)
                    applied_count += 1

                elif change.operation == "update":
                    main_model.update_element(change.element_id, change.after or {})
                    applied_count += 1

                elif change.operation == "delete":
                    main_model.remove_element(change.element_id)
                    applied_count += 1

            except Exception as e:
                errors.append(f"{change.element_id}: {e}")

        # Save main model
        main_model.save()

        # Update changeset status
        cs.metadata.status = "applied"
        cs.metadata.updated_at = datetime.now(timezone.utc)
        cs.save()

        # Update registry
        manager.update_changeset_status(changeset_id, "applied")

        # Clear active changeset
        manager.clear_active()

        # Display results
        console.print(f"\n✓ Applied {applied_count} changes", style="green")

        if errors:
            console.print("\n[yellow]Warnings:[/yellow]")
            for error in errors:
                console.print(f"  {error}", style="yellow")

        console.print(f"\nChangeset '{changeset_id}' marked as applied", style="dim")

    except Exception as e:
        console.print(f"\n✗ Error applying changeset: {e}", style="red bold")
        raise click.Abort()


@changeset.command()
@click.argument("changeset_id")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt")
def abandon(changeset_id: str, yes: bool):
    """Mark changeset as abandoned."""
    try:
        manager = ChangesetManager(Path.cwd())

        # Check if changeset exists
        if not manager.changeset_exists(changeset_id):
            console.print(f"✗ Changeset '{changeset_id}' not found", style="red bold")
            raise click.Abort()

        # Load changeset
        cs = manager.load_changeset(changeset_id)

        # Show info
        console.print(f"\n[bold]Changeset: {cs.metadata.name}[/bold]")
        console.print(f"ID: {changeset_id}")
        console.print(f"Changes: {cs.get_element_count()}")

        # Confirm unless --yes flag
        if not yes:
            if not click.confirm("\nMark this changeset as abandoned?"):
                console.print("Cancelled", style="yellow")
                return

        # Update status
        manager.update_changeset_status(changeset_id, "abandoned")

        # Clear active if this was active
        if manager.get_active() == changeset_id:
            manager.clear_active()

        console.print(f"✓ Changeset '{changeset_id}' marked as abandoned", style="yellow")
        console.print("  Changes can still be viewed but won't be applied", style="dim")

    except Exception as e:
        console.print(f"✗ Error abandoning changeset: {e}", style="red bold")
        raise click.Abort()


@changeset.command()
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt")
def clear(yes: bool):
    """Clear the active changeset (work in main model)."""
    try:
        manager = ChangesetManager(Path.cwd())

        active = manager.get_active()
        if not active:
            console.print("No active changeset", style="yellow")
            return

        # Confirm unless --yes flag
        if not yes:
            if not click.confirm(f"\nClear active changeset '{active}' and work in main model?"):
                console.print("Cancelled", style="yellow")
                return

        manager.clear_active()
        console.print("✓ Cleared active changeset", style="green")
        console.print("  Now working in main model", style="dim")

    except Exception as e:
        console.print(f"✗ Error clearing changeset: {e}", style="red bold")
        raise click.Abort()


@changeset.command()
@click.argument("changeset_id")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt")
def delete(changeset_id: str, yes: bool):
    """Delete a changeset permanently."""
    try:
        manager = ChangesetManager(Path.cwd())

        # Check if changeset exists
        if not manager.changeset_exists(changeset_id):
            console.print(f"✗ Changeset '{changeset_id}' not found", style="red bold")
            raise click.Abort()

        # Load changeset
        cs = manager.load_changeset(changeset_id)

        # Show warning
        console.print("\n[bold red]WARNING: This will permanently delete the changeset![/bold red]")
        console.print(f"\nChangeset: {cs.metadata.name}")
        console.print(f"ID: {changeset_id}")
        console.print(f"Changes: {cs.get_element_count()}")

        # Confirm unless --yes flag
        if not yes:
            if not click.confirm("\nPermanently delete this changeset?"):
                console.print("Cancelled", style="yellow")
                return

        # Delete changeset
        manager.delete_changeset(changeset_id)

        console.print(f"✓ Deleted changeset '{changeset_id}'", style="green")

    except Exception as e:
        console.print(f"✗ Error deleting changeset: {e}", style="red bold")
        raise click.Abort()


@changeset.command()
@click.argument("changeset_a")
@click.argument("changeset_b", required=False)
@click.option("--json", "output_json", is_flag=True, help="Output as JSON")
def diff(changeset_a: str, changeset_b: Optional[str], output_json: bool):
    """Compare two changesets or a changeset with main model.

    Examples:
        dr changeset diff feature-a feature-b    # Compare two changesets
        dr changeset diff feature-a              # Compare with main model
    """
    try:
        manager = ChangesetManager(Path.cwd())

        # Check if changesets exist
        if not manager.changeset_exists(changeset_a):
            console.print(f"✗ Changeset '{changeset_a}' not found", style="red bold")
            raise click.Abort()

        if changeset_b and not manager.changeset_exists(changeset_b):
            console.print(f"✗ Changeset '{changeset_b}' not found", style="red bold")
            raise click.Abort()

        # Get diff
        diff_result = manager.diff_changesets(changeset_a, changeset_b)

        # JSON output
        if output_json:
            click.echo(json.dumps(diff_result, indent=2))
            return

        # Display diff
        console.print("\n[bold]Comparing Changesets[/bold]")
        console.print(
            f"A: {diff_result['changeset_a']['name']} ({diff_result['changeset_a']['id']})"
        )
        console.print(
            f"B: {diff_result['changeset_b']['name']} ({diff_result['changeset_b']['id']})"
        )

        # Show conflicts if any
        if diff_result["has_conflicts"]:
            console.print(
                f"\n[bold red]⚠ Conflicts detected ({len(diff_result['modified_in_both'])})[/bold red]"
            )
            table = Table(title="Conflicting Changes")
            table.add_column("Element ID", style="yellow")
            table.add_column("Operation in A", style="cyan")
            table.add_column("Operation in B", style="cyan")
            table.add_column("Layer")

            for conflict in diff_result["modified_in_both"]:
                table.add_row(
                    conflict["element_id"],
                    conflict["operation_a"],
                    conflict["operation_b"],
                    conflict["layer"],
                )

            console.print(table)

        # Show unique to A
        if diff_result["only_in_a"]:
            console.print(
                f"\n[bold green]Only in {diff_result['changeset_a']['name']} ({len(diff_result['only_in_a'])})[/bold green]"
            )
            for change in diff_result["only_in_a"]:
                op_str = change["operation"]
                if change["operation"] == "add":
                    op_str = f"[green]{op_str}[/green]"
                elif change["operation"] == "delete":
                    op_str = f"[red]{op_str}[/red]"
                elif change["operation"] == "update":
                    op_str = f"[yellow]{op_str}[/yellow]"

                console.print(f"  {op_str:15} {change['element_id']}")

        # Show unique to B
        if diff_result["only_in_b"]:
            console.print(
                f"\n[bold blue]Only in {diff_result['changeset_b']['name']} ({len(diff_result['only_in_b'])})[/bold blue]"
            )
            for change in diff_result["only_in_b"]:
                op_str = change["operation"]
                if change["operation"] == "add":
                    op_str = f"[green]{op_str}[/green]"
                elif change["operation"] == "delete":
                    op_str = f"[red]{op_str}[/red]"
                elif change["operation"] == "update":
                    op_str = f"[yellow]{op_str}[/yellow]"

                console.print(f"  {op_str:15} {change['element_id']}")

        # Show same in both
        if diff_result["same_in_both"]:
            console.print(f"\n[dim]Same in both ({len(diff_result['same_in_both'])})[/dim]")
            for change in diff_result["same_in_both"][:5]:  # Show first 5
                console.print(f"  {change['operation']:6} {change['element_id']}", style="dim")

            if len(diff_result["same_in_both"]) > 5:
                console.print(f"  ... and {len(diff_result['same_in_both']) - 5} more", style="dim")

        # Summary
        console.print("\n[bold]Summary:[/bold]")
        console.print(f"  Conflicts: {len(diff_result['modified_in_both'])}")
        console.print(f"  Only in A: {len(diff_result['only_in_a'])}")
        console.print(f"  Only in B: {len(diff_result['only_in_b'])}")
        console.print(f"  Same: {len(diff_result['same_in_both'])}")

    except Exception as e:
        console.print(f"✗ Error comparing changesets: {e}", style="red bold")
        raise click.Abort()
