"""
CLI entry point for dr tool.
"""

import os
from pathlib import Path

import click
from rich.console import Console

from . import __version__
from .commands import (
    add,
    changeset,
    claude,
    conformance,
    copilot,
    export,
    find,
    init,
    links,
    list_cmd,
    migrate,
    project,
    remove,
    search,
    trace,
    update,
    upgrade,
    validate,
    visualize,
)
from .core.upgrade_manager import UpgradeManager

console = Console()


@click.group()
@click.version_option(version=__version__)
@click.option("--verbose", is_flag=True, help="Verbose output")
@click.option("--no-upgrade-check", is_flag=True, help="Skip automatic upgrade check")
@click.pass_context
def cli(ctx: click.Context, verbose: bool, no_upgrade_check: bool) -> None:
    """Documentation Robotics - Architecture model management tool.

    The dr tool helps you manage federated architecture data models
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
    ctx.obj["verbose"] = verbose
    ctx.obj["no_upgrade_check"] = no_upgrade_check

    # Check for upgrades (skip for init, upgrade, version commands and if explicitly disabled)
    if not no_upgrade_check and ctx.invoked_subcommand not in ["init", "upgrade", "version"]:
        # Only check if we're in a DR project directory
        manifest_path = Path.cwd() / "documentation-robotics" / "model" / "manifest.yaml"
        if manifest_path.exists():
            try:
                manager = UpgradeManager()
                # Check silently - only prompt if upgrade is needed
                # Set auto=True to upgrade automatically without prompting
                # (can be controlled via environment variable)
                auto_upgrade = os.getenv("DR_AUTO_UPGRADE", "false").lower() == "true"
                manager.check_and_upgrade(auto=auto_upgrade)
            except Exception as e:
                if verbose:
                    console.print(f"[yellow]⚠[/] Upgrade check failed: {e}")


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
cli.add_command(conformance.conformance)
# Changeset management
cli.add_command(changeset.changeset)
# Claude Code integration
cli.add_command(claude.claude)
# GitHub Copilot integration
cli.add_command(copilot.copilot)
# Upgrade management
cli.add_command(upgrade.upgrade)
cli.add_command(upgrade.version_info)
# Link management
cli.add_command(links.links_group)
# Migration management
cli.add_command(migrate.migrate)
# Visualization
cli.add_command(visualize.visualize)


def main() -> None:
    """Main entry point."""
    try:
        cli()
    except Exception as e:
        console.print(f"[red bold]Error: {e}[/red bold]")
        raise


if __name__ == "__main__":
    main()
