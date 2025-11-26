"""
Validate the model.
"""

import json
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from ..core.link_analyzer import LinkAnalyzer
from ..core.link_registry import LinkRegistry
from ..core.model import Model
from ..validators.link_validator import LinkValidator, ValidationSeverity

console = Console()


@click.command()
@click.option("--layer", help="Validate specific layer only")
@click.option("--element", help="Validate specific element only")
@click.option("--strict", is_flag=True, help="Strict validation mode")
@click.option("--validate-links", is_flag=True, help="Validate cross-layer links")
@click.option("--strict-links", is_flag=True, help="Treat link warnings as errors")
@click.option("--output", type=click.Choice(["text", "json"]), default="text")
def validate(
    layer: str, element: str, strict: bool, validate_links: bool, strict_links: bool, output: str
):
    """Validate the model.

    This command validates the model structure, schemas, and optionally cross-layer links.

    Link validation is opt-in via --validate-links. By default, link issues are warnings.
    Use --strict-links to treat link warnings as errors.
    """

    # Load model
    try:
        model = Model(Path.cwd())
    except FileNotFoundError:
        console.print("✗ Error: No model found in current directory", style="red bold")
        raise click.Abort()

    console.print("[bold]Validating model...[/bold]\n")

    # Perform standard validation
    result = model.validate(strict=strict)

    # Perform link validation if requested
    link_issues = []
    if validate_links:
        console.print("[bold]Validating cross-layer links...[/bold]\n")
        try:
            registry = LinkRegistry()
            analyzer = LinkAnalyzer(registry)

            # Analyze the model to discover links
            model_data = model.to_dict()
            analyzer.analyze_model(model_data)

            # Validate discovered links
            validator = LinkValidator(registry, analyzer, strict_mode=strict_links)
            link_issues = validator.validate_all()

            if link_issues:
                console.print(f"Found {len(link_issues)} link validation issue(s)\n")
            else:
                console.print("[green]✓ All links are valid[/green]\n")
        except FileNotFoundError as e:
            console.print(f"[yellow]⚠ Link validation skipped: {e}[/yellow]\n")
        except Exception as e:
            console.print(f"[red]✗ Link validation error: {e}[/red]\n")

    # Display results
    if output == "text":
        _display_text_results(result, model, link_issues if validate_links else None)
    elif output == "json":
        result_dict = result.to_dict()
        if validate_links and link_issues:
            result_dict["link_issues"] = [
                {
                    "severity": issue.severity.value,
                    "type": issue.issue_type,
                    "message": issue.message,
                    "source_id": issue.link_instance.source_id,
                    "field_path": issue.link_instance.field_path,
                    "suggestion": issue.suggestion,
                }
                for issue in link_issues
            ]
        console.print(json.dumps(result_dict, indent=2))

    # Update manifest
    has_link_errors = (
        any(issue.severity == ValidationSeverity.ERROR for issue in link_issues)
        if link_issues
        else False
    )
    if result.is_valid() and not has_link_errors:
        model.manifest.update_validation_status("passed")
        model.manifest.save()
    else:
        model.manifest.update_validation_status("failed")
        model.manifest.save()

    # Exit with appropriate code
    if not result.is_valid() or has_link_errors:
        raise click.exceptions.Exit(1)


def _display_text_results(result, model, link_issues=None):
    """Display validation results in text format.

    Args:
        result: ValidationResult from model.validate()
        model: Model object
        link_issues: Optional list of ValidationIssue from LinkValidator
    """

    # Summary table
    table = Table(title="Validation Summary")
    table.add_column("Layer", style="cyan")
    table.add_column("Elements", justify="right")
    table.add_column("Errors", justify="right", style="red")
    table.add_column("Warnings", justify="right", style="yellow")
    table.add_column("Status", justify="center")

    for layer_name, layer in model.layers.items():
        errors = len([e for e in result.errors if e.layer == layer_name])
        warnings = len([w for w in result.warnings if w.layer == layer_name])

        status = "✓" if errors == 0 else "✗"
        status_style = "green" if errors == 0 else "red"

        table.add_row(
            layer_name,
            str(len(layer.elements)),
            str(errors),
            str(warnings),
            f"[{status_style}]{status}[/{status_style}]",
        )

    console.print(table)

    # Show errors
    if result.errors:
        console.print("\n[bold red]Schema Errors:[/bold red]")
        for error in result.errors:
            console.print(f"  ✗ [{error.layer}] {error.element_id}: {error.message}")
            if error.fix_suggestion:
                console.print(f"     Fix: {error.fix_suggestion}")

    # Show warnings
    if result.warnings:
        console.print("\n[bold yellow]Schema Warnings:[/bold yellow]")
        for warning in result.warnings:
            console.print(f"  ⚠  [{warning.layer}] {warning.element_id}: {warning.message}")

    # Show link validation issues
    if link_issues:
        link_errors = [issue for issue in link_issues if issue.severity == ValidationSeverity.ERROR]
        link_warnings = [
            issue for issue in link_issues if issue.severity == ValidationSeverity.WARNING
        ]

        if link_errors:
            console.print("\n[bold red]Link Errors:[/bold red]")
            for issue in link_errors:
                console.print(f"  ✗ {issue.link_instance.source_id} -> {issue.field_path}")
                console.print(f"     {issue.message}")
                if issue.suggestion:
                    console.print(f"     Suggestion: {issue.suggestion}")

        if link_warnings:
            console.print("\n[bold yellow]Link Warnings:[/bold yellow]")
            for issue in link_warnings:
                console.print(f"  ⚠  {issue.link_instance.source_id} -> {issue.field_path}")
                console.print(f"     {issue.message}")
                if issue.suggestion:
                    console.print(f"     Suggestion: {issue.suggestion}")

    # Overall status
    console.print()
    link_error_count = (
        len([i for i in link_issues if i.severity == ValidationSeverity.ERROR])
        if link_issues
        else 0
    )
    link_warning_count = (
        len([i for i in link_issues if i.severity == ValidationSeverity.WARNING])
        if link_issues
        else 0
    )

    total_errors = len(result.errors) + link_error_count
    total_warnings = len(result.warnings) + link_warning_count

    if result.is_valid() and link_error_count == 0:
        console.print("✓ [green bold]Validation passed[/green bold]")
        if total_warnings > 0:
            console.print(f"   {total_warnings} warning(s)")
    else:
        console.print("✗ [red bold]Validation failed[/red bold]")
        console.print(f"   {total_errors} error(s), {total_warnings} warning(s)")
