"""
Conformance command for displaying specification conformance information.
"""
import json
import click
from ..spec_version import get_conformance_statement, SPEC_VERSION, CONFORMANCE_LEVEL
from ..utils.output import print_success, print_info, print_table


@click.command()
@click.option(
    "--format",
    type=click.Choice(["text", "json", "yaml"]),
    default="text",
    help="Output format",
)
def conformance(format):
    """Display specification conformance information."""
    statement = get_conformance_statement()

    if format == "json":
        click.echo(json.dumps(statement, indent=2))
    elif format == "yaml":
        import yaml

        click.echo(yaml.dump(statement, default_flow_style=False))
    else:
        # Text format
        print_success("Documentation Robotics CLI Conformance Statement")
        print_info(
            f"\nImplementation: {statement['implementation']['name']} "
            f"v{statement['implementation']['version']}"
        )
        print_info(
            f"Specification: {statement['specification']['name']} "
            f"v{statement['specification']['version']}"
        )
        print_info(f"Conformance Level: {statement['specification']['conformanceLevel']}")

        click.echo("\n📋 Implemented Layers:")
        layer_data = []
        for layer, info in statement["layers"].items():
            status = "✅ Yes" if info["implemented"] else "❌ No"
            layer_data.append([layer, info["standard"], status])

        print_table(["Layer", "Standard", "Implemented"], layer_data)

        click.echo("\n⚙️  Capabilities:")
        for capability, value in statement["capabilities"].items():
            if isinstance(value, list):
                click.echo(f"  • {capability}: {', '.join(value)}")
            else:
                status = "✅" if value else "❌"
                click.echo(f"  • {capability}: {status}")

        click.echo(f"\n📖 Specification: {statement['specification']['url']}")
        click.echo(f"💾 Repository: {statement['implementation']['repository']}")
        click.echo(f"📜 License: {statement['implementation']['license']}")
