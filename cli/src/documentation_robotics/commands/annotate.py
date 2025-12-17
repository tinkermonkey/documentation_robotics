"""
Annotation management commands.
"""

from datetime import datetime
from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel
from rich.tree import Tree

from ..core.annotations import (
    Annotation,
    AnnotationRegistry,
    AnnotationStore,
    generate_annotation_id,
)
from ..utils.entity_uri import EntityUriParser
from ..utils.user_identity import ensure_username
from .utils import load_model_with_changeset_context

console = Console()


@click.group()
def annotate():
    """Manage annotations on model entities and attributes."""
    pass


@annotate.command()
@click.argument("entity_uri")
@click.argument("message")
@click.option(
    "--project-dir",
    type=click.Path(exists=True),
    default=".",
    help="Path to documentation robotics project",
)
def add(entity_uri: str, message: str, project_dir: str):
    """Add annotation to an entity or attribute.

    ENTITY_URI format: layer.type.name or layer.type.name#properties.path

    MESSAGE: Annotation text (supports markdown)

    Examples:

      dr annotate add motivation.goal.deliver-value "Should this be split?"

      dr annotate add api.operation.get-users#responses.200 "Add pagination"
    """
    project_path = Path(project_dir).resolve()

    # Load model to validate entity URI
    try:
        model = load_model_with_changeset_context(project_path)
    except FileNotFoundError:
        console.print("[red]✗ Error: No model found in current directory[/red]")
        console.print("   Run 'dr init <project-name>' first")
        raise click.Abort()

    # Validate entity URI exists
    if not EntityUriParser.validate(entity_uri, model):
        console.print(f"[red]✗ Error: Entity URI not found: {entity_uri}[/red]")
        raise click.Abort()

    # Ensure user identity
    username = ensure_username(project_path)

    # Generate annotation ID
    annotation_id = generate_annotation_id()

    # Create annotation
    annotation = Annotation(
        id=annotation_id,
        entity_uri=entity_uri,
        timestamp=datetime.utcnow().isoformat() + "Z",
        user=username,
        message=message,
        parent_id=None,
    )

    # Save to user's store
    store = AnnotationStore(username, project_path)
    store.add_annotation(annotation)

    console.print(
        Panel(
            f"[green]✓[/green] Annotation added: {annotation_id}\n"
            f"Entity: {entity_uri}\n"
            f"User: {username}",
            title="Annotation Created",
        )
    )


@annotate.command()
@click.argument("annotation_id")
@click.argument("message")
@click.option(
    "--project-dir",
    type=click.Path(exists=True),
    default=".",
    help="Path to documentation robotics project",
)
def reply(annotation_id: str, message: str, project_dir: str):
    """Reply to an annotation or previous reply.

    ANNOTATION_ID: ID of annotation or reply to respond to

    MESSAGE: Reply text (supports markdown)

    Example:

      dr annotate reply ann-abc123 "I agree, let's split it"
    """
    project_path = Path(project_dir).resolve()

    # Load registry to find parent annotation
    registry = AnnotationRegistry(project_path)
    registry.load_all()

    parent = registry.get_annotation(annotation_id)
    if not parent:
        console.print(f"[red]✗ Error: Annotation not found: {annotation_id}[/red]")
        raise click.Abort()

    # Ensure user identity
    username = ensure_username(project_path)

    # Generate reply ID
    reply_id = generate_annotation_id()

    # Create reply (uses same entity_uri as parent)
    reply_annotation = Annotation(
        id=reply_id,
        entity_uri=parent.entity_uri,
        timestamp=datetime.utcnow().isoformat() + "Z",
        user=username,
        message=message,
        parent_id=annotation_id,  # Links to parent
    )

    # Save to user's store
    store = AnnotationStore(username, project_path)
    store.add_annotation(reply_annotation)

    console.print(
        Panel(
            f"[green]✓[/green] Reply added: {reply_id}\n"
            f"In reply to: {annotation_id}\n"
            f"User: {username}",
            title="Reply Created",
        )
    )


@annotate.command(name="list")
@click.option("--entity-uri", help="Filter by entity URI")
@click.option("--all", "show_all", is_flag=True, help="Show all annotations")
@click.option(
    "--project-dir",
    type=click.Path(exists=True),
    default=".",
    help="Path to documentation robotics project",
)
def list_annotations(entity_uri: str, show_all: bool, project_dir: str):
    """List annotations, optionally filtered by entity.

    Examples:

      dr annotate list --all

      dr annotate list --entity-uri motivation.goal.deliver-value
    """
    project_path = Path(project_dir).resolve()

    # Require either --all or --entity-uri
    if not show_all and not entity_uri:
        console.print("[red]✗ Error: Must specify either --all or --entity-uri[/red]")
        raise click.Abort()

    # Load all annotations
    registry = AnnotationRegistry(project_path)
    registry.load_all()

    # Filter annotations
    if entity_uri:
        annotations = registry.get_by_entity_uri(entity_uri)
        title = f"Annotations for {entity_uri}"
    else:
        annotations = registry.get_all()
        title = "All Annotations"

    if not annotations:
        console.print("[yellow]No annotations found[/yellow]")
        return

    # Group by root annotations (those without parent_id)
    roots = [a for a in annotations if a.parent_id is None]

    # Sort roots by timestamp
    roots.sort(key=lambda a: a.timestamp)

    # Display each thread
    for root in roots:
        tree = _build_thread_tree(root, registry)
        console.print(Panel(tree, title=title, expand=False))
        console.print()  # Add spacing between threads


def _build_thread_tree(annotation: Annotation, registry: AnnotationRegistry) -> Tree:
    """Build Rich tree visualization of annotation thread.

    Args:
        annotation: Root annotation to build tree from
        registry: Annotation registry to find replies

    Returns:
        Rich Tree object representing the thread hierarchy
    """
    # Format the annotation node
    tree = Tree(
        f"[bold]{annotation.user}[/bold] [dim]({annotation.timestamp})[/dim] [dim]{annotation.id}[/dim]\n"
        f"{annotation.message}"
    )

    # Find replies to this annotation
    replies = registry.get_replies(annotation.id)

    # Sort replies by timestamp
    replies.sort(key=lambda a: a.timestamp)

    # Recursively build subtrees for each reply
    for reply in replies:
        subtree = _build_thread_tree(reply, registry)
        tree.add(subtree)

    return tree
