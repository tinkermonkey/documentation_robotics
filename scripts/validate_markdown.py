#!/usr/bin/env python3
"""Validate markdown layer specifications.

This script validates that markdown layer specifications conform to the correct format
and can be successfully parsed into JSON schemas.

Usage:
    # Validate all layers
    python scripts/validate_markdown.py --all

    # Validate specific layer
    python scripts/validate_markdown.py --layer 02-business-layer

    # Validate link registry synchronization
    python scripts/validate_markdown.py --validate-links
"""

import argparse
import sys
from pathlib import Path
from typing import List, Optional

# Add scripts directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from generators.markdown_parser import MarkdownLayerParser  # noqa: E402

try:
    from rich.console import Console  # noqa: E402
    from rich.table import Table  # noqa: E402

    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False


class MarkdownValidator:
    """Validator for markdown layer specifications."""

    def __init__(self, root_dir: Optional[Path] = None):
        """Initialize the validator.

        Args:
            root_dir: Root directory of the project (defaults to auto-detect)
        """
        if root_dir is None:
            # Auto-detect: script is in scripts/, root is 1 level up
            script_dir = Path(__file__).parent
            root_dir = script_dir.parent

        self.root_dir = root_dir
        self.spec_dir = root_dir / "spec"
        self.layers_dir = self.spec_dir / "layers"
        self.schemas_dir = self.spec_dir / "schemas"
        self.link_registry_path = self.spec_dir / "schemas" / "link-registry.json"

        self.parser = MarkdownLayerParser()

        if RICH_AVAILABLE:
            self.console = Console()
        else:
            self.console = None

    def discover_layers(self) -> List[Path]:
        """Discover all layer markdown files.

        Returns:
            List of paths to layer markdown files, sorted by layer number
        """
        if not self.layers_dir.exists():
            raise FileNotFoundError(f"Layers directory not found: {self.layers_dir}")

        layers = sorted(self.layers_dir.glob("*.md"))

        # Filter out non-layer files (README, etc.)
        import re

        layers = [layer for layer in layers if re.match(r"\d{2}-[\w-]+\.md", layer.name)]

        return layers

    def validate_layer(self, markdown_path: Path) -> dict:
        """Validate a single layer markdown file.

        Args:
            markdown_path: Path to markdown layer file

        Returns:
            Dictionary with validation results
        """
        layer_name = markdown_path.stem
        result = {
            "layer": layer_name,
            "markdown_path": str(markdown_path),
            "status": "success",
            "warnings": [],
            "errors": [],
        }

        try:
            # Read markdown content
            content = markdown_path.read_text(encoding="utf-8")

            # Attempt to parse the markdown
            layer_spec = self.parser.parse(markdown_path)
            result["entities_found"] = len(layer_spec.entities)

            # Validate basic structure
            if not layer_spec.layer_name:
                result["warnings"].append("Layer name is empty")

            if not layer_spec.description:
                result["warnings"].append("Layer description is empty")

            if not layer_spec.entities:
                result["warnings"].append("No entities defined in layer")

            # Validate each entity
            for entity_name, entity_def in layer_spec.entities.items():
                if not entity_def.description:
                    result["warnings"].append(
                        f"Entity '{entity_name}' has no description"
                    )

                if not entity_def.attributes:
                    result["warnings"].append(
                        f"Entity '{entity_name}' has no attributes defined"
                    )

            # Validate Integration Points section
            self._validate_integration_points(content, result)

            # Validate Example Model section
            self._validate_example_model(content, result)

        except ValueError as e:
            result["status"] = "error"
            result["errors"].append(f"Parse error: {str(e)}")
            import traceback

            result["traceback"] = traceback.format_exc()

        except Exception as e:
            result["status"] = "error"
            result["errors"].append(f"Unexpected error: {str(e)}")
            import traceback

            result["traceback"] = traceback.format_exc()

        return result

    def _validate_integration_points(self, content: str, result: dict):
        """Validate Integration Points section exists and has proper format.

        Args:
            content: Markdown file content
            result: Result dictionary to append warnings/errors
        """
        import re

        # Check if Integration Points section exists
        if "## Integration Points" not in content:
            result["warnings"].append(
                "Missing '## Integration Points' section - cross-layer relationships should be documented"
            )
            return

        # Extract Integration Points section
        section_match = re.search(
            r'## Integration Points\s*\n(.*?)(?=\n## |$)',
            content,
            re.DOTALL
        )

        if section_match:
            section_content = section_match.group(1)

            # Check for subsections (To/From other layers)
            if not re.search(r'### To |### From ', section_content):
                result["warnings"].append(
                    "Integration Points section exists but has no subsections (### To/From LayerName)"
                )

            # Check for relationship documentation format
            # Should have: "**SourceEntity** predicate **TargetEntity** (property.name property)"
            relationship_pattern = r'\*\*\w+\*\*.+?\*\*\w+\*\*.+?\(.+?property\)'
            relationships_found = len(re.findall(relationship_pattern, section_content))

            if relationships_found == 0 and len(section_content.strip()) > 50:
                result["warnings"].append(
                    "Integration Points section may not follow standard format: "
                    "**SourceEntity** verb **TargetEntity** (property.name property)"
                )

    def _validate_example_model(self, content: str, result: dict):
        """Validate Example Model section exists and has well-formed XML.

        Args:
            content: Markdown file content
            result: Result dictionary to append warnings/errors
        """
        import re

        # Check if Example Model section exists
        if "## Example Model" not in content:
            result["warnings"].append(
                "Missing '## Example Model' section - concrete usage examples should be provided"
            )
            return

        # Extract Example Model section
        section_match = re.search(
            r'## Example Model\s*\n(.*?)(?=\n## |$)',
            content,
            re.DOTALL
        )

        if section_match:
            section_content = section_match.group(1)

            # Check for XML code block
            xml_blocks = re.findall(r'```xml\n(.*?)\n```', section_content, re.DOTALL)

            if not xml_blocks:
                result["warnings"].append(
                    "Example Model section exists but has no XML code blocks (```xml)"
                )
                return

            # Validate XML is well-formed (basic check)
            for xml_content in xml_blocks:
                # Check for basic XML structure
                if '<element' not in xml_content:
                    result["warnings"].append(
                        "Example Model XML should contain <element> tags"
                    )

                # Check for property tags with cross-layer fields
                property_tags = re.findall(r'<property key="([^"]+)"', xml_content)

                if not property_tags:
                    result["warnings"].append(
                        "Example Model XML has no <property> tags - "
                        "cross-layer relationships should be demonstrated"
                    )
                else:
                    # Check if properties match expected patterns (layer.field-name)
                    cross_layer_props = [p for p in property_tags if '.' in p]
                    if not cross_layer_props:
                        result["warnings"].append(
                            "Example Model has properties but none appear to be cross-layer "
                            "(expected format: layer.field-name)"
                        )

                # Basic XML balance check
                open_tags = xml_content.count('<element')
                close_tags = xml_content.count('</element>')
                if open_tags != close_tags:
                    result["errors"].append(
                        f"Example Model XML appears malformed: "
                        f"{open_tags} <element> tags but {close_tags} </element> tags"
                    )
                    result["status"] = "error"

    def validate_all(self) -> List[dict]:
        """Validate all layer markdown files.

        Returns:
            List of result dictionaries
        """
        layers = self.discover_layers()
        results = []

        for layer_path in layers:
            result = self.validate_layer(layer_path)
            results.append(result)

        return results

    def validate_link_registry(self) -> dict:
        """Validate link registry is synchronized with layer specifications.

        Returns:
            Dictionary with validation results
        """
        result = {
            "status": "success",
            "warnings": [],
            "errors": [],
        }

        if not self.link_registry_path.exists():
            result["status"] = "error"
            result["errors"].append(
                f"Link registry not found: {self.link_registry_path}"
            )
            return result

        # Load link registry
        import json

        try:
            with open(self.link_registry_path, "r", encoding="utf-8") as f:
                link_registry = json.load(f)

            # Basic validation
            if "linkTypes" not in link_registry:
                result["errors"].append("Link registry missing 'linkTypes' key")
                result["status"] = "error"
            else:
                links_count = len(link_registry["linkTypes"])
                result["links_count"] = links_count

                if links_count == 0:
                    result["warnings"].append("Link registry has no link types defined")

        except json.JSONDecodeError as e:
            result["status"] = "error"
            result["errors"].append(f"Invalid JSON in link registry: {str(e)}")
        except Exception as e:
            result["status"] = "error"
            result["errors"].append(f"Error reading link registry: {str(e)}")

        return result

    def _print(self, message: str):
        """Print message using rich or plain print.

        Args:
            message: Message to print
        """
        if self.console:
            self.console.print(message)
        else:
            print(message)

    def _print_error(self, message: str):
        """Print error message.

        Args:
            message: Error message
        """
        if self.console:
            self.console.print(f"[red]{message}[/red]")
        else:
            print(f"ERROR: {message}")

    def _print_success(self, message: str):
        """Print success message.

        Args:
            message: Success message
        """
        if self.console:
            self.console.print(f"[green]{message}[/green]")
        else:
            print(f"SUCCESS: {message}")

    def _print_warning(self, message: str):
        """Print warning message.

        Args:
            message: Warning message
        """
        if self.console:
            self.console.print(f"[yellow]{message}[/yellow]")
        else:
            print(f"WARNING: {message}")

    def print_results(self, results: List[dict]):
        """Print validation results.

        Args:
            results: List of result dictionaries
        """
        if self.console:
            # Rich table output
            table = Table(title="Markdown Validation Results")
            table.add_column("Layer", style="cyan")
            table.add_column("Entities", justify="right", style="magenta")
            table.add_column("Status", style="green")
            table.add_column("Warnings", justify="right", style="yellow")
            table.add_column("Errors", justify="right", style="red")

            for result in results:
                status = "✓" if result["status"] == "success" else "✗"
                status_style = "green" if result["status"] == "success" else "red"

                table.add_row(
                    result["layer"],
                    str(result.get("entities_found", 0)),
                    f"[{status_style}]{status}[/{status_style}]",
                    str(len(result.get("warnings", []))),
                    str(len(result.get("errors", []))),
                )

            self.console.print(table)

            # Print warnings
            for result in results:
                if result.get("warnings"):
                    self.console.print(f"\n[yellow]Warnings for {result['layer']}:[/yellow]")
                    for warning in result["warnings"]:
                        self.console.print(f"  - {warning}")

            # Print errors
            for result in results:
                if result.get("errors"):
                    self.console.print(f"\n[red]Errors for {result['layer']}:[/red]")
                    for error in result["errors"]:
                        self.console.print(f"  - {error}")
                    if result.get("traceback"):
                        self.console.print(f"\n[dim]{result['traceback']}[/dim]")

        else:
            # Plain output
            print("\nMarkdown Validation Results:")
            print("-" * 80)
            for result in results:
                status = "SUCCESS" if result["status"] == "success" else "ERROR"
                print(
                    f"{result['layer']}: {status} "
                    f"({result.get('entities_found', 0)} entities, "
                    f"{len(result.get('warnings', []))} warnings, "
                    f"{len(result.get('errors', []))} errors)"
                )
                if result.get("warnings"):
                    for warning in result["warnings"]:
                        print(f"  WARNING: {warning}")
                if result.get("errors"):
                    for error in result["errors"]:
                        print(f"  ERROR: {error}")

        # Summary
        success_count = sum(1 for r in results if r["status"] == "success")
        total_count = len(results)

        if success_count == total_count:
            self._print_success(
                f"\n✓ All {total_count} layer specifications are valid"
            )
        else:
            self._print_error(
                f"\n✗ {total_count - success_count} of {total_count} layers have errors"
            )


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Validate markdown layer specifications",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Mode selection (mutually exclusive)
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--all", action="store_true", help="Validate all layer specifications"
    )
    mode_group.add_argument(
        "--layer",
        type=str,
        help="Validate specific layer (e.g., 02-business-layer)",
    )
    mode_group.add_argument(
        "--validate-links",
        action="store_true",
        help="Validate link registry synchronization",
    )

    # Options
    parser.add_argument(
        "--root-dir", type=Path, help="Project root directory (auto-detected)"
    )

    args = parser.parse_args()

    # Create validator
    validator = MarkdownValidator(root_dir=args.root_dir)

    # Execute based on mode
    if args.validate_links:
        # Validate link registry
        validator._print(
            "[bold]Validating link registry...[/bold]"
            if RICH_AVAILABLE
            else "Validating link registry..."
        )
        result = validator.validate_link_registry()

        if result["status"] == "success":
            validator._print_success(
                f"✓ Link registry is valid ({result.get('links_count', 0)} links)"
            )
            if result.get("warnings"):
                for warning in result["warnings"]:
                    validator._print_warning(f"  {warning}")
            sys.exit(0)
        else:
            validator._print_error("✗ Link registry validation failed")
            for error in result["errors"]:
                validator._print_error(f"  {error}")
            sys.exit(1)

    elif args.all:
        # Validate all layers
        validator._print(
            "[bold]Validating all layer specifications...[/bold]"
            if RICH_AVAILABLE
            else "Validating all layer specifications..."
        )

        results = validator.validate_all()
        validator.print_results(results)

        # Exit with error if any failed
        if any(r["status"] == "error" for r in results):
            sys.exit(1)

    elif args.layer:
        # Validate specific layer
        layer_name = args.layer
        if not layer_name.endswith(".md"):
            layer_name += ".md"

        markdown_path = validator.layers_dir / layer_name

        if not markdown_path.exists():
            validator._print_error(f"Layer not found: {markdown_path}")
            sys.exit(1)

        validator._print(
            f"[bold]Validating {args.layer}...[/bold]"
            if RICH_AVAILABLE
            else f"Validating {args.layer}..."
        )

        result = validator.validate_layer(markdown_path)
        validator.print_results([result])

        if result["status"] == "error":
            sys.exit(1)

    else:
        # No mode specified
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
