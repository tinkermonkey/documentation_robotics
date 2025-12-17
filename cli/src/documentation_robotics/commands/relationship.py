"""Relationship command group - Manage intra-layer relationships with predicates.

This module implements the 'dr relationship' command group with subcommands for
adding, listing, removing, and validating relationships between elements with
explicit semantic predicates.
"""

import json
from pathlib import Path
from typing import Optional

import click
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from ..core.model import Model
from ..core.relationship_registry import RelationshipRegistry
from ..validators.predicate_validator import PredicateValidator

console = Console()


@click.group(name="relationship")
def relationship():
    """Manage relationships between elements with semantic predicates.

    This command group provides operations for working with intra-layer relationships
    using the semantic relationship taxonomy from spec v0.6.0.

    Examples:
        dr relationship add api.endpoint.create-user accesses data.entity.user
        dr relationship list api.endpoint.create-user
        dr relationship remove api.endpoint.create-user accesses data.entity.user
        dr relationship validate
    """
    pass


@relationship.command("add")
@click.argument("source_id")
@click.argument("predicate")
@click.argument("target_id")
@click.option(
    "--skip-validation",
    is_flag=True,
    help="Skip predicate validation (not recommended)",
)
@click.option(
    "--suggest-inverse",
    is_flag=True,
    default=True,
    help="Suggest adding inverse relationship (default: enabled)",
)
@click.option(
    "--verbose",
    is_flag=True,
    help="Show detailed error information including stack traces",
)
def add_relationship(
    source_id: str, predicate: str, target_id: str, skip_validation: bool, suggest_inverse: bool, verbose: bool
):
    """Add a relationship between two elements with an explicit predicate.

    Creates a directed relationship from source to target using a semantic predicate
    from the relationship taxonomy. The predicate must be valid for the source element's
    layer, and both source and target elements must exist.

    Examples:
        # API endpoint accesses data entity
        dr relationship add api.endpoint.create-user accesses data.entity.user

        # Application component realizes business service
        dr relationship add app.component.auth-service realizes business.service.authentication

        # Data entity aggregates other entities
        dr relationship add data.entity.order aggregates data.entity.order-item

    Args:
        source_id: Source element ID (format: layer.type.name)
        predicate: Semantic predicate (e.g., "accesses", "realizes", "composes")
        target_id: Target element ID (format: layer.type.name)
    """
    try:
        # Load model
        root_path = Path.cwd()
        model = Model(root_path)

        # Validate source element exists
        source = model.get_element(source_id)
        if not source:
            console.print(f"[red]✗[/] Error: Source element '{source_id}' not found", style="bold")
            console.print("\n[dim]Use 'dr find {source_id}' to search for elements[/dim]")
            raise click.Abort()

        # Validate target element exists
        target = model.get_element(target_id)
        if not target:
            console.print(f"[red]✗[/] Error: Target element '{target_id}' not found", style="bold")
            console.print("\n[dim]Use 'dr find {target_id}' to search for elements[/dim]")
            raise click.Abort()

        # Validate predicate (unless skipped)
        if not skip_validation:
            registry = RelationshipRegistry()
            validator = PredicateValidator(registry, strict_mode=False)

            # Check predicate exists
            pred_result = validator.validate_predicate_exists(predicate)
            if pred_result.errors:
                console.print(f"[red]✗[/] Error: Unknown predicate '{predicate}'", style="bold")

                # Show available predicates for this layer
                available = validator.list_predicates_for_layer(source.layer)
                if available:
                    console.print(f"\n[yellow]Available predicates for layer {source.layer}:[/]")
                    for pred in available[:10]:  # Show first 10
                        rel_info = validator.get_relationship_info(pred)
                        console.print(f"  • {pred:<20} ({rel_info['category']})")
                    if len(available) > 10:
                        console.print(f"  ... and {len(available) - 10} more")
                raise click.Abort()

            # Check predicate is valid for layer
            layer_result = validator.validate_predicate_for_layer(
                predicate, source.layer, source_id
            )
            if layer_result.errors:
                for error in layer_result.errors:
                    console.print(f"[red]✗[/] {error.message}", style="bold")

                # Show available predicates for this layer
                available = validator.list_predicates_for_layer(source.layer)
                if available:
                    console.print(f"\n[yellow]Available predicates for layer {source.layer}:[/]")
                    for pred in available[:10]:
                        rel_info = validator.get_relationship_info(pred)
                        console.print(f"  • {pred:<20} ({rel_info['category']})")
                    if len(available) > 10:
                        console.print(f"  ... and {len(available) - 10} more")
                raise click.Abort()

        # Determine relationship type
        rel_type = "cross-layer" if source.layer != target.layer else "intra-layer"

        # Add relationship to model
        relationship = {
            "targetId": target_id,
            "predicate": predicate,
            "type": rel_type,
        }

        model.add_relationship(source_id, relationship)
        model.save()

        console.print(
            f"[green]✓[/] Added relationship: {source_id} --\\[{predicate}]--> {target_id}",
            style="bold"
        )

        # Suggest inverse relationship if enabled
        if suggest_inverse and not skip_validation:
            # Reuse registry from earlier validation
            inverse = registry.get_inverse_predicate(predicate)
            if inverse:
                rel_type_obj = registry.get_predicate(predicate)
                if rel_type_obj and rel_type_obj.is_bidirectional:
                    console.print(
                        f"\n[yellow]💡 Suggestion:[/] This is a bidirectional relationship. "
                        f"Consider adding the inverse:"
                    )
                    console.print(f"   dr relationship add {target_id} {inverse} {source_id}")

    except FileNotFoundError as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        console.print("\n[dim]Make sure you're in a DR project directory[/dim]")
        if verbose:
            import traceback
            console.print("\n[dim]Stack trace:[/dim]")
            console.print(traceback.format_exc())
        raise click.Abort()
    except Exception as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        if verbose:
            import traceback
            console.print("\n[dim]Stack trace:[/dim]")
            console.print(traceback.format_exc())
        raise click.Abort()


@relationship.command("list")
@click.argument("element_id")
@click.option(
    "--direction",
    type=click.Choice(["outgoing", "incoming", "both"]),
    default="both",
    help="Relationship direction to display",
)
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["table", "json"]),
    default="table",
    help="Output format",
)
@click.option(
    "--predicate",
    help="Filter by specific predicate",
)
def list_relationships(element_id: str, direction: str, output_format: str, predicate: Optional[str]):
    """List all relationships for an element.

    Displays both outgoing relationships (from this element) and incoming relationships
    (to this element) with their semantic predicates and metadata.

    Examples:
        # List all relationships for an element
        dr relationship list api.endpoint.create-user

        # List only outgoing relationships
        dr relationship list api.endpoint.create-user --direction outgoing

        # List in JSON format
        dr relationship list api.endpoint.create-user --format json

        # Filter by predicate
        dr relationship list data.entity.user --predicate "accessed-by"

    Args:
        element_id: Element ID to query (format: layer.type.name)
    """
    try:
        # Load model
        root_path = Path.cwd()
        model = Model(root_path)

        # Validate element exists
        element = model.get_element(element_id)
        if not element:
            console.print(f"[red]✗[/] Error: Element '{element_id}' not found", style="bold")
            raise click.Abort()

        # Get outgoing relationships
        outgoing = []
        if direction in ["outgoing", "both"]:
            outgoing = model.get_relationships(element_id)
            if predicate:
                outgoing = [r for r in outgoing if r.get("predicate") == predicate]

        # Get incoming relationships
        incoming = []
        if direction in ["incoming", "both"]:
            incoming = model.find_incoming_relationships(element_id)
            if predicate:
                incoming = [r for r in incoming if r.get("predicate") == predicate]

        # Output results
        if output_format == "json":
            output = {
                "elementId": element_id,
                "outgoing": outgoing,
                "incoming": incoming,
            }
            console.print(json.dumps(output, indent=2))
        else:
            # Table format
            console.print(f"\n[bold]Relationships for {element_id}:[/]\n")

            if outgoing:
                console.print("[bold]Outgoing:[/]")
                table = Table(show_header=True, header_style="bold magenta")
                table.add_column("Target ID", style="cyan", width=40)
                table.add_column("Predicate", style="green", width=20)
                table.add_column("Type", style="yellow", width=15)

                for rel in outgoing:
                    table.add_row(
                        rel["targetId"],
                        rel.get("predicate", "unknown"),
                        rel.get("type", "cross-layer"),
                    )
                console.print(table)

            if incoming:
                console.print("\n[bold]Incoming:[/]")
                table = Table(show_header=True, header_style="bold magenta")
                table.add_column("Source ID", style="cyan", width=40)
                table.add_column("Predicate", style="green", width=20)
                table.add_column("Type", style="yellow", width=15)

                for rel in incoming:
                    table.add_row(
                        rel["sourceId"],
                        rel.get("predicate", "unknown"),
                        rel.get("type", "cross-layer"),
                    )
                console.print(table)

            if not outgoing and not incoming:
                console.print("[dim]No relationships found[/]")

    except FileNotFoundError as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        raise click.Abort()
    except Exception as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        raise click.Abort()


@relationship.command("remove")
@click.argument("source_id")
@click.argument("predicate")
@click.argument("target_id")
@click.option(
    "--remove-inverse",
    is_flag=True,
    help="Also remove inverse relationship if it exists",
)
def remove_relationship(
    source_id: str, predicate: str, target_id: str, remove_inverse: bool
):
    """Remove a relationship between two elements.

    Deletes the specified relationship. Optionally also removes the inverse relationship
    if it exists (for bidirectional relationships).

    Examples:
        # Remove a specific relationship
        dr relationship remove api.endpoint.create-user accesses data.entity.user

        # Remove both forward and inverse relationships
        dr relationship remove api.endpoint.create-user accesses data.entity.user --remove-inverse

    Args:
        source_id: Source element ID (format: layer.type.name)
        predicate: Predicate of the relationship to remove
        target_id: Target element ID (format: layer.type.name)
    """
    try:
        # Load model
        root_path = Path.cwd()
        model = Model(root_path)

        # Remove relationship
        removed = model.remove_relationship(source_id, predicate, target_id)
        if not removed:
            console.print(
                f"[red]✗[/] Error: Relationship not found: "
                f"{source_id} --\\[{predicate}]--> {target_id}",
                style="bold"
            )
            raise click.Abort()

        console.print(
            f"[green]✓[/] Removed relationship: {source_id} --\\[{predicate}]--> {target_id}",
            style="bold"
        )

        # Remove inverse if requested (before saving to ensure transactional behavior)
        inverse_removed = False
        if remove_inverse:
            registry = RelationshipRegistry()
            inverse = registry.get_inverse_predicate(predicate)
            if inverse:
                inverse_removed = model.remove_relationship(target_id, inverse, source_id)
                if inverse_removed:
                    console.print(
                        f"[green]✓[/] Removed inverse: {target_id} --\\[{inverse}]--> {source_id}",
                        style="bold"
                    )
                else:
                    console.print(
                        f"[yellow]⚠[/] Note: Inverse relationship not found: "
                        f"{target_id} --\\[{inverse}]--> {source_id}"
                    )

        # Save once after all operations complete (transactional)
        model.save()

    except FileNotFoundError as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        raise click.Abort()
    except Exception as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        raise click.Abort()


@relationship.command("validate")
@click.option(
    "--fix-inverse",
    is_flag=True,
    help="Automatically add missing inverse relationships",
)
@click.option(
    "--strict",
    is_flag=True,
    help="Treat warnings as errors",
)
def validate_relationships(fix_inverse: bool, strict: bool):
    """Validate all relationships in the model.

    Performs comprehensive validation of all relationships including:
    - Predicate existence and validity
    - Layer-specific predicate constraints
    - Inverse consistency for bidirectional relationships
    - Cardinality constraints

    Examples:
        # Validate all relationships
        dr relationship validate

        # Validate and auto-fix missing inverses
        dr relationship validate --fix-inverse

        # Strict mode (warnings become errors)
        dr relationship validate --strict
    """
    try:
        # Load model
        root_path = Path.cwd()
        model = Model(root_path)

        # Initialize validator
        registry = RelationshipRegistry()
        validator = PredicateValidator(registry, strict_mode=strict)

        console.print("\n[bold]Validating relationships...[/]\n")

        # Track statistics
        total_relationships = 0
        total_errors = 0
        total_warnings = 0
        fixed_inverses = 0

        # Validate relationships for each element
        for layer in model.layers.values():
            for element in layer.elements.values():
                relationships = model.get_relationships(element.id)
                total_relationships += len(relationships)

                for rel in relationships:
                    target_id = rel.get("targetId")
                    predicate = rel.get("predicate", "unknown")

                    # Validate relationship
                    result = validator.validate_relationship(
                        element.id,
                        target_id,
                        predicate,
                        element.layer,
                        model,
                    )

                    # Display errors
                    for error in result.errors:
                        console.print(f"[red]✗ ERROR:[/] {error.message}")
                        total_errors += 1

                    # Display warnings
                    for warning in result.warnings:
                        console.print(f"[yellow]⚠ WARNING:[/] {warning.message}")
                        total_warnings += 1

                        # Fix missing inverse if requested
                        if fix_inverse and "inverse" in warning.message.lower():
                            rel_type = registry.get_predicate(predicate)
                            if rel_type and rel_type.is_bidirectional:
                                inverse = rel_type.inverse_predicate
                                # Check if inverse already exists
                                target_rels = model.get_relationships(target_id)
                                has_inverse = any(
                                    r.get("targetId") == element.id and r.get("predicate") == inverse
                                    for r in target_rels
                                )
                                if not has_inverse:
                                    # Add inverse relationship
                                    inverse_rel = {
                                        "targetId": element.id,
                                        "predicate": inverse,
                                        "type": rel.get("type", "cross-layer"),
                                    }
                                    model.add_relationship(target_id, inverse_rel)
                                    console.print(
                                        f"  [green]✓ Fixed:[/] Added inverse "
                                        f"{target_id} --\\[{inverse}]--> {element.id}"
                                    )
                                    fixed_inverses += 1

        # Save if we fixed any inverses
        if fixed_inverses > 0:
            model.save()

        # Summary
        console.print(f"\n[bold]Validation Summary:[/]")
        console.print(f"  Total relationships: {total_relationships}")
        console.print(f"  Errors: [red]{total_errors}[/]")
        console.print(f"  Warnings: [yellow]{total_warnings}[/]")
        if fixed_inverses > 0:
            console.print(f"  Fixed inverses: [green]{fixed_inverses}[/]")

        if total_errors > 0:
            console.print("\n[red bold]✗ Validation failed with errors[/]")
            raise click.Abort()
        elif total_warnings > 0 and strict:
            console.print("\n[yellow bold]✗ Validation failed with warnings (strict mode)[/]")
            raise click.Abort()
        else:
            console.print("\n[green bold]✓ Validation passed[/]")

    except FileNotFoundError as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        raise click.Abort()
    except Exception as e:
        console.print(f"[red]✗[/] Error: {e}", style="bold")
        raise click.Abort()
