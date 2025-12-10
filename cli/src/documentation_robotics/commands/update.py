"""
Update an existing element.
"""

from pathlib import Path

import click
import yaml
from rich.console import Console

console = Console()


@click.command(name="update-element")
@click.argument("element-id")
@click.option("--spec", type=click.File("r"), help="YAML/JSON spec file with updates")
@click.option("--set", "-s", multiple=True, help="Set property (key=value) - additive for arrays")
@click.option("--replace", "-r", multiple=True, help="Replace property completely (key=value)")
@click.option("--unset", "-u", multiple=True, help="Remove property entirely (key)")
@click.option("--remove", multiple=True, help="Remove specific value from array (key=value)")
@click.option("--dry-run", is_flag=True, help="Show what would be updated")
def update_element(
    element_id: str,
    spec: click.File,
    set: tuple,
    replace: tuple,
    unset: tuple,
    remove: tuple,
    dry_run: bool,
):
    """Update an existing element with smart array handling.

    The --set flag is ADDITIVE by default for array properties:
    - Array properties are automatically detected from schema and conventions
    - Multiple --set calls append to arrays without overwriting
    - Scalar properties are replaced as expected

    Examples:
        # Add to array property (additive)
        dr update-element app.component.viewer --set deployedOn=technology.framework.react
        dr update-element app.component.viewer --set deployedOn=technology.language.typescript

        # Replace property completely
        dr update-element app.component.viewer --replace status=deprecated

        # Remove specific value from array
        dr update-element app.component.viewer --remove deployedOn=technology.framework.react

        # Remove property entirely
        dr update-element app.component.viewer --unset deployedOn

        # Update from YAML file
        dr update-element api.endpoint.user-login --spec updates.yaml

        # Preview changes
        dr update-element ux.screen.dashboard --set priority=high --dry-run
    """

    # Load model (with changeset context if active)
    try:
        from .utils import load_model_with_changeset_context

        model = load_model_with_changeset_context(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Find element
    element = model.get_element(element_id)
    if not element:
        console.print(f"✗ Error: Element '{element_id}' not found", style="red bold")
        raise click.Abort()

    # Check that at least one operation is specified
    if not any([spec, set, replace, unset, remove]):
        console.print("[yellow]No updates specified[/yellow]")
        console.print("Use --set, --replace, --unset, --remove, or --spec to specify updates")
        return

    # Track all operations for reporting
    all_results = {}

    # Show element being updated
    console.print(f"\n[bold]Updating element: {element_id}[/bold]")

    # Process --unset operations
    if unset:
        try:
            unset_keys = list(unset)
            if dry_run:
                console.print(f"\n[yellow]Would unset properties:[/yellow] {', '.join(unset_keys)}")
            else:
                unset_results = element.unset(unset_keys)
                console.print("\n[bold cyan]Removed properties:[/bold cyan]")
                for key, old_value in unset_results.items():
                    console.print(f"  ✓ {key} (was: {old_value})")
                element.save()
        except ValueError as e:
            console.print(f"✗ Error in --unset: {e}", style="red bold")
            raise click.Abort()

    # Process --remove operations
    if remove:
        remove_updates = {}
        for prop in remove:
            if "=" not in prop:
                console.print(f"✗ Error: Invalid --remove format: {prop}", style="red bold")
                console.print("   Expected format: key=value")
                raise click.Abort()
            key, value = prop.split("=", 1)
            remove_updates[key] = value

        if dry_run:
            console.print("\n[yellow]Would remove from arrays:[/yellow]")
            for key, value in remove_updates.items():
                console.print(f"  • {key}: {value}")
        else:
            try:
                results = model.update_element(element_id, remove_updates, mode="remove")
                console.print("\n[bold cyan]Removed from arrays:[/bold cyan]")
                for key, values in results.items():
                    if values == ["(removed)"]:
                        console.print(f"  ✓ Removed property {key}")
                    elif values == ["(empty)"]:
                        console.print(f"  ✓ Removed from {key} (array now empty)")
                    else:
                        console.print(f"  ✓ Removed from {key}")
                        console.print(f"    Remaining values ({len(values)}):")
                        for val in values:
                            console.print(f"    • {val}")
                all_results.update(results)
            except ValueError as e:
                console.print(f"✗ Error in --remove: {e}", style="red bold")
                raise click.Abort()

    # Process --replace operations
    if replace:
        replace_updates = {}
        for prop in replace:
            if "=" not in prop:
                console.print(f"✗ Error: Invalid --replace format: {prop}", style="red bold")
                console.print("   Expected format: key=value")
                raise click.Abort()
            key, value = prop.split("=", 1)
            replace_updates[key] = value

        if dry_run:
            console.print("\n[yellow]Would replace properties:[/yellow]")
            console.print(yaml.dump(replace_updates, default_flow_style=False))
        else:
            try:
                results = model.update_element(element_id, replace_updates, mode="replace")
                console.print("\n[bold yellow]Replaced properties:[/bold yellow]")
                for key, values in results.items():
                    console.print(f"  ⚠ {key} = {values[0] if len(values) == 1 else values}")
                all_results.update(results)
            except ValueError as e:
                console.print(f"✗ Error in --replace: {e}", style="red bold")
                raise click.Abort()

    # Process --set operations (additive by default)
    set_updates = {}

    # Load from spec file if provided
    if spec:
        set_updates = yaml.safe_load(spec)

    # Apply individual property updates
    for prop in set:
        if "=" not in prop:
            console.print(f"✗ Error: Invalid --set format: {prop}", style="red bold")
            console.print("   Expected format: key=value")
            raise click.Abort()

        key, value = prop.split("=", 1)
        set_updates[key] = value

    if set_updates:
        if dry_run:
            console.print("\n[yellow]Would set properties (additive for arrays):[/yellow]")
            console.print(yaml.dump(set_updates, default_flow_style=False))
        else:
            try:
                results = model.update_element(element_id, set_updates, mode="add")
                console.print("\n[bold green]Set properties:[/bold green]")
                for key, values in results.items():
                    if len(values) == 1:
                        console.print(f"  ✓ {key} = {values[0]}")
                    else:
                        console.print(
                            f"  ✓ {key} (array with {len(values)} value{'s' if len(values) != 1 else ''}):"
                        )
                        for val in values:
                            console.print(f"    • {val}")
                all_results.update(results)
            except ValueError as e:
                console.print(f"✗ Error in --set: {e}", style="red bold")
                raise click.Abort()

    if dry_run:
        console.print("\n[yellow]Dry run - not saving[/yellow]")
    else:
        console.print(f"\n✓ Successfully updated element: {element_id}", style="green bold")
