"""Links command - Query, validate, and navigate cross-layer links.

This module implements the 'dr links' command group with subcommands for
working with cross-layer reference patterns.
"""

import json
from pathlib import Path
from typing import Optional

import click

from ..core.link_analyzer import LinkAnalyzer
from ..core.link_doc_generator import LinkDocGenerator
from ..core.link_registry import LinkRegistry
from ..core.manifest import ManifestManager
from ..validators.link_validator import LinkValidator


@click.group(name="links")
def links_group():
    """Query, validate, and navigate cross-layer links."""
    pass


@links_group.command(name="types")
@click.option("--layer", help="Filter by source or target layer (e.g., 06-api, 01-motivation)")
@click.option("--category", help="Filter by category (motivation, business, security, etc.)")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["json", "table", "markdown"]),
    default="table",
    help="Output format",
)
def types_command(layer: Optional[str], category: Optional[str], output_format: str):
    """List all available link types."""
    try:
        registry = LinkRegistry()

        # Get link types
        if layer:
            # Check if it's a source or target layer
            source_links = registry.get_link_types_by_source_layer(layer)
            target_links = registry.get_link_types_by_target_layer(layer)
            link_types = list(set(source_links + target_links))
        elif category:
            link_types = registry.get_link_types_by_category(category)
        else:
            link_types = registry.get_all_link_types()

        if not link_types:
            click.echo("No link types found for the specified filters.")
            return

        # Output in requested format
        if output_format == "json":
            output = [
                {
                    "id": lt.id,
                    "name": lt.name,
                    "category": lt.category,
                    "sourceLayers": lt.source_layers,
                    "targetLayer": lt.target_layer,
                    "fieldPaths": lt.field_paths,
                    "format": lt.format,
                }
                for lt in link_types
            ]
            click.echo(json.dumps(output, indent=2))

        elif output_format == "markdown":
            click.echo(registry.export_to_markdown_table(category))

        else:  # table
            click.echo(f"\n{'ID':<30} {'Name':<25} {'Category':<15} {'Format':<10}")
            click.echo("=" * 85)
            for lt in sorted(link_types, key=lambda x: (x.category, x.name)):
                click.echo(f"{lt.id:<30} {lt.name:<25} {lt.category:<15} {lt.format:<10}")
            click.echo(f"\nTotal: {len(link_types)} link types")

    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        click.echo("Make sure you're running from the repository root.", err=True)
        raise click.Abort()
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@links_group.command(name="list")
@click.option("--layer", help="Filter by source layer")
@click.option("--type", "link_type", help="Filter by link type ID")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["json", "table", "tree"]),
    default="table",
    help="Output format",
)
def list_command(layer: Optional[str], link_type: Optional[str], output_format: str):
    """List all link instances in the current model."""
    try:
        # Load manifest to get model data
        manifest_mgr = ManifestManager()
        _manifest = manifest_mgr.load()

        # Initialize registry and analyzer
        registry = LinkRegistry()
        _analyzer = LinkAnalyzer(registry)

        # This would need to load the actual model data
        # For now, placeholder
        click.echo("Note: This command requires a loaded model.", err=True)
        click.echo("Model loading integration is pending.", err=True)

        # TODO: Integrate with Model class to load actual data
        # model_data = load_model_from_manifest(manifest)
        # analyzer.analyze_model(model_data)

        # Filter and display links
        # if layer:
        #     links = [l for l in analyzer.links if l.source_layer == layer]
        # elif link_type:
        #     links = analyzer.get_links_by_type(link_type)
        # else:
        #     links = analyzer.links

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@links_group.command(name="find")
@click.argument("element-id")
@click.option(
    "--direction",
    type=click.Choice(["up", "down", "both"]),
    default="both",
    help="Link direction: up (incoming), down (outgoing), or both",
)
@click.option("--link-type", help="Filter by link type ID")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["json", "table"]),
    default="table",
    help="Output format",
)
def find_command(element_id: str, direction: str, link_type: Optional[str], output_format: str):
    """Find all links connected to an element."""
    try:
        # Load and analyze model
        registry = LinkRegistry()
        _analyzer = LinkAnalyzer(registry)

        # TODO: Load actual model
        click.echo(f"Finding links for element: {element_id}")
        click.echo(f"Direction: {direction}")
        if link_type:
            click.echo(f"Link type: {link_type}")

        click.echo("\nNote: Model loading integration is pending.", err=True)

        # TODO: Implement actual find logic
        # if direction in ('down', 'both'):
        #     outgoing = analyzer.get_links_from(element_id, link_type)
        # if direction in ('up', 'both'):
        #     incoming = analyzer.get_links_to(element_id, link_type)

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@links_group.command(name="validate")
@click.option("--layer", help="Validate only links in a specific layer")
@click.option("--type", "link_type", help="Validate only a specific link type")
@click.option("--strict", is_flag=True, help="Treat warnings as errors")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["text", "json"]),
    default="text",
    help="Output format",
)
def validate_command(
    layer: Optional[str], link_type: Optional[str], strict: bool, output_format: str
):
    """Validate all links in the model."""
    try:
        # Load registry and analyzer
        registry = LinkRegistry()
        _analyzer = LinkAnalyzer(registry)

        # TODO: Load actual model
        # model_data = load_model()
        # analyzer.analyze_model(model_data)

        # Create validator
        _validator = LinkValidator(registry, _analyzer, strict_mode=strict)

        # Run validation
        # issues = validator.validate_all()

        click.echo("Note: Model loading integration is pending.", err=True)

        # TODO: Implement actual validation display
        # if output_format == 'json':
        #     output = {
        #         'summary': validator.get_summary(),
        #         'issues': [...]
        #     }
        #     click.echo(json.dumps(output, indent=2))
        # else:
        #     validator.print_issues()
        #     summary = validator.get_summary()
        #     click.echo(f"\nValidation Summary:")
        #     click.echo(f"  Total issues: {summary['total_issues']}")
        #     click.echo(f"  Errors: {summary['errors']}")
        #     click.echo(f"  Warnings: {summary['warnings']}")
        #
        #     if validator.has_errors():
        #         raise click.Abort()

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@links_group.command(name="trace")
@click.argument("source-id")
@click.argument("target-id")
@click.option("--show-types", is_flag=True, help="Show link types in the path")
@click.option("--max-hops", type=int, default=10, help="Maximum number of hops")
def trace_command(source_id: str, target_id: str, show_types: bool, max_hops: int):
    """Find a path between two elements through links."""
    try:
        registry = LinkRegistry()
        _analyzer = LinkAnalyzer(registry)

        # TODO: Load actual model
        # model_data = load_model()
        # analyzer.analyze_model(model_data)

        # Find path
        # path = analyzer.find_path(source_id, target_id, max_hops)

        click.echo(f"Tracing path from {source_id} to {target_id}...")
        click.echo("Note: Model loading integration is pending.", err=True)

        # TODO: Display path
        # if path:
        #     if show_types:
        #         click.echo(path.get_path_description())
        #     else:
        #         click.echo(f"Path found with {path.total_distance} hops")
        # else:
        #     click.echo("No path found", err=True)

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@links_group.command(name="registry")
@click.option(
    "--format",
    "output_format",
    type=click.Choice(["json", "markdown", "html"]),
    default="markdown",
    help="Output format",
)
@click.option("--output", type=click.Path(), help="Output file (defaults to stdout)")
@click.option("--detailed", is_flag=True, help="Generate detailed documentation (markdown only)")
def registry_command(output_format: str, output: Optional[str], detailed: bool):
    """Display the full link registry."""
    try:
        registry = LinkRegistry()
        doc_generator = LinkDocGenerator(registry)

        # Generate output
        if output_format == "json":
            content = registry.export_to_json()
        elif output_format == "markdown":
            if detailed:
                content = doc_generator.generate_detailed_markdown()
            else:
                content = doc_generator.generate_markdown_summary()
        else:  # html
            if not output:
                click.echo("Error: HTML format requires --output option", err=True)
                raise click.Abort()

            output_path = Path(output)
            doc_generator.generate_html_documentation(output_path)
            click.echo(f"HTML documentation generated: {output_path}")

            # Show statistics
            stats = registry.get_statistics()
            click.echo("\n--- Registry Statistics ---")
            click.echo(f"Total link types: {stats['total_link_types']}")
            click.echo(f"Categories: {stats['total_categories']}")
            click.echo(f"Version: {stats['version']}")
            return

        # Write to file or stdout (for json/markdown)
        if output:
            output_path = Path(output)
            output_path.write_text(content)
            click.echo(f"Registry exported to {output_path}")
        else:
            click.echo(content)

        # Show statistics
        stats = registry.get_statistics()
        click.echo("\n--- Registry Statistics ---", err=True)
        click.echo(f"Total link types: {stats['total_link_types']}", err=True)
        click.echo(f"Categories: {stats['total_categories']}", err=True)
        click.echo(f"Version: {stats['version']}", err=True)

    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        click.echo("Make sure you're running from the repository root.", err=True)
        raise click.Abort()
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@links_group.command(name="stats")
def stats_command():
    """Show statistics about links in the current model."""
    try:
        registry = LinkRegistry()
        _analyzer = LinkAnalyzer(registry)

        # Show registry stats
        reg_stats = registry.get_statistics()
        click.echo("=== Link Registry Statistics ===\n")
        click.echo(f"Total link types: {reg_stats['total_link_types']}")
        click.echo(f"Categories: {reg_stats['total_categories']}")
        click.echo("\nLink types by category:")
        for category, count in sorted(reg_stats["category_counts"].items()):
            click.echo(f"  {category}: {count}")

        click.echo(f"\nSource layers: {', '.join(reg_stats['source_layers'])}")
        click.echo(f"Target layers: {', '.join(reg_stats['target_layers'])}")

        # TODO: Show analyzer stats when model is loaded
        # click.echo("\n=== Model Link Statistics ===\n")
        # model_stats = analyzer.get_statistics()
        # click.echo(f"Total links found: {model_stats['total_links']}")
        # click.echo(f"Total elements: {model_stats['total_elements']}")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()


@links_group.command(name="docs")
@click.option(
    "--output-dir",
    type=click.Path(),
    default="./docs/links",
    help="Output directory for generated documentation",
)
@click.option(
    "--formats",
    multiple=True,
    type=click.Choice(["markdown", "html", "mermaid", "quick-ref"]),
    default=["markdown", "html"],
    help="Documentation formats to generate (can specify multiple)",
)
@click.option("--category", help="Generate docs for specific category only")
def docs_command(output_dir: str, formats: tuple, category: Optional[str]):
    """Generate comprehensive link documentation.

    This command builds complete documentation for the cross-layer link registry
    in multiple formats. By default, it generates both markdown and HTML documentation.

    Examples:
        dr links docs
        dr links docs --output-dir ./build/docs
        dr links docs --formats markdown --formats html --formats mermaid
        dr links docs --category motivation
    """
    try:
        registry = LinkRegistry()
        doc_generator = LinkDocGenerator(registry)

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        click.echo(f"Generating link documentation in {output_path}")
        click.echo(f"Formats: {', '.join(formats)}\n")

        generated_files = []

        # Generate markdown documentation
        if "markdown" in formats:
            # Summary
            summary_file = output_path / "link-registry-summary.md"
            summary_content = doc_generator.generate_markdown_summary()
            summary_file.write_text(summary_content)
            generated_files.append(summary_file)
            click.echo(f"✓ Generated: {summary_file}")

            # Detailed
            detailed_file = output_path / "link-registry-detailed.md"
            detailed_content = doc_generator.generate_detailed_markdown()
            detailed_file.write_text(detailed_content)
            generated_files.append(detailed_file)
            click.echo(f"✓ Generated: {detailed_file}")

        # Generate HTML documentation
        if "html" in formats:
            html_file = output_path / "link-registry.html"
            doc_generator.generate_html_documentation(html_file)
            generated_files.append(html_file)
            click.echo(f"✓ Generated: {html_file}")

        # Generate Mermaid diagrams
        if "mermaid" in formats:
            if category:
                mermaid_file = output_path / f"link-diagram-{category}.mmd"
                mermaid_content = doc_generator.generate_mermaid_diagram(category)
                mermaid_file.write_text(mermaid_content)
                generated_files.append(mermaid_file)
                click.echo(f"✓ Generated: {mermaid_file}")
            else:
                # Generate diagram for each category
                for cat in registry.get_all_categories().keys():
                    mermaid_file = output_path / f"link-diagram-{cat}.mmd"
                    mermaid_content = doc_generator.generate_mermaid_diagram(cat)
                    mermaid_file.write_text(mermaid_content)
                    generated_files.append(mermaid_file)
                    click.echo(f"✓ Generated: {mermaid_file}")

                # Generate overall diagram
                mermaid_file = output_path / "link-diagram-all.mmd"
                mermaid_content = doc_generator.generate_mermaid_diagram()
                mermaid_file.write_text(mermaid_content)
                generated_files.append(mermaid_file)
                click.echo(f"✓ Generated: {mermaid_file}")

        # Generate quick reference
        if "quick-ref" in formats:
            quick_ref_file = output_path / "link-quick-reference.md"
            quick_ref_content = doc_generator.generate_quick_reference()
            quick_ref_file.write_text(quick_ref_content)
            generated_files.append(quick_ref_file)
            click.echo(f"✓ Generated: {quick_ref_file}")

        # Summary
        stats = registry.get_statistics()
        click.echo("\n=== Documentation Build Complete ===")
        click.echo(f"Generated {len(generated_files)} file(s)")
        click.echo(f"Output directory: {output_path.absolute()}")
        click.echo("\nRegistry contains:")
        click.echo(f"  {stats['total_link_types']} link types")
        click.echo(f"  {stats['total_categories']} categories")
        click.echo(f"  Version: {stats['version']}")

    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        click.echo("Make sure you're running from a directory with the link registry.", err=True)
        raise click.Abort()
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        raise click.Abort()
