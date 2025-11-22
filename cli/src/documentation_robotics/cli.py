"""
CLI entry point for dr tool.
"""
import click
from rich.console import Console
from .commands import init, add, find, list_cmd, search, update, remove, validate
# Phase 2 commands
from .commands import project, trace
# Phase 3 commands
from .commands import export

console = Console()


@click.group()
@click.version_option(version="0.1.0")
@click.option("--verbose", is_flag=True, help="Verbose output")
@click.pass_context
def cli(ctx: click.Context, verbose: bool) -> None:
    """Documentation Robotics - Architecture model management tool.

    The dr tool helps you manage federated architecture metadata models
    across 11 layers using standard specifications and custom extensions.

    Common commands:
      dr init <project-name>     Initialize a new model
      dr add <layer> <type>      Add an element to a layer
      dr find <element-id>       Find and display an element
      dr validate                Validate the entire model
      dr project <id> --to <layer>  Project element to another layer
      dr trace <id>              Trace element dependencies

    For more information, see: https://github.com/anthropics/documentation-robotics
    """
    ctx.ensure_object(dict)
    ctx.obj['verbose'] = verbose


# Register commands
cli.add_command(init.init)
cli.add_command(add.add)
cli.add_command(find.find)
cli.add_command(list_cmd.list_elements)
cli.add_command(search.search)
cli.add_command(update.update)
cli.add_command(remove.remove)
cli.add_command(validate.validate)
# Phase 2 commands
cli.add_command(project.project)
cli.add_command(project.project_all)
cli.add_command(trace.trace)
# Phase 3 commands
cli.add_command(export.export)


def main() -> None:
    """Main entry point."""
    try:
        cli()
    except Exception as e:
        console.print(f"[red bold]Error: {e}[/red bold]")
        raise


if __name__ == "__main__":
    main()
