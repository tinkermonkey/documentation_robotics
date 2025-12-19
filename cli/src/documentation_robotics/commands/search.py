"""
Search for elements across layers.
"""

from pathlib import Path

import click
from rich.console import Console

from ..utils.output import print_element_table

console = Console()


@click.command()
@click.option("--layer", help="Filter by layer")
@click.option("--type", "element_type", help="Filter by element type")
@click.option("--name", "name_pattern", help="Filter by name pattern (supports wildcards)")
@click.option("--property", "-p", multiple=True, help="Filter by property (key=value)")
@click.option("--output", type=click.Choice(["table", "yaml", "json"]), default="table")
@click.option("--limit", type=int, help="Limit number of results")
@click.option("--has-source-ref", is_flag=True, help="Filter to entities with source references")
@click.option("--no-source-ref", is_flag=True, help="Filter to entities without source references")
@click.option(
    "--source-provenance",
    type=click.Choice(["extracted", "manual", "inferred", "generated"]),
    help="Filter by source reference provenance",
)
def search(
    layer: str,
    element_type: str,
    name_pattern: str,
    property: tuple,
    output: str,
    limit: int,
    has_source_ref: bool,
    no_source_ref: bool,
    source_provenance: str,
):
    """Search for elements across layers."""

    # Validate conflicting options
    if has_source_ref and no_source_ref:
        console.print(
            "✗ Error: Cannot use both --has-source-ref and --no-source-ref",
            style="red bold",
        )
        raise click.Abort()

    if source_provenance and no_source_ref:
        console.print(
            "✗ Error: Cannot use --source-provenance with --no-source-ref",
            style="red bold",
        )
        raise click.Abort()

    # Load model (with changeset context if active)
    try:
        from .utils import load_model_with_changeset_context

        model = load_model_with_changeset_context(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    # Parse properties
    properties = {}
    for prop in property:
        if "=" not in prop:
            console.print(f"✗ Error: Invalid property format: {prop}", style="red bold")
            console.print("   Expected format: key=value")
            raise click.Abort()

        key, value = prop.split("=", 1)
        properties[key] = value

    # Search
    elements = model.find_elements(
        layer=layer, element_type=element_type, name_pattern=name_pattern, **properties
    )

    # Apply source reference filters
    from ..utils.source_ref_utils import filter_elements_by_source

    if no_source_ref:
        elements = filter_elements_by_source(elements, has_source_ref=False)
    elif has_source_ref:
        elements = filter_elements_by_source(elements, has_source_ref=True, provenance=source_provenance)
    elif source_provenance:
        # If only provenance is specified without has_source_ref, still apply the filter
        elements = filter_elements_by_source(elements, has_source_ref=True, provenance=source_provenance)

    # Apply limit
    if limit:
        elements = elements[:limit]

    # Display results
    if not elements:
        console.print("[yellow]No elements found matching criteria[/yellow]")
        return

    console.print(f"\n[bold]Search Results[/bold] - {len(elements)} element(s) found\n")

    if output == "table":
        print_element_table(elements)
    elif output == "yaml":
        import yaml

        for element in elements:
            console.print(yaml.dump({element.id: element.to_dict()}, default_flow_style=False))
    elif output == "json":
        import json

        data = {e.id: e.to_dict() for e in elements}
        console.print(json.dumps(data, indent=2))
