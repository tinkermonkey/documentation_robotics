"""
Export manager - orchestrates export operations.
"""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Type


class ExportFormat(Enum):
    """Supported export formats."""

    ARCHIMATE = "archimate"
    OPENAPI = "openapi"
    JSON_SCHEMA = "schema"
    PLANTUML = "plantuml"
    MARKDOWN = "markdown"
    GRAPHML = "graphml"


@dataclass
class ExportOptions:
    """Options for export operations."""

    format: ExportFormat
    output_path: Path
    layer_filter: Optional[str] = None
    element_type_filter: Optional[str] = None
    include_metadata: bool = True
    validate_output: bool = True
    overwrite: bool = False


class BaseExporter:
    """Base class for all exporters."""

    def __init__(self, model, options: ExportOptions):
        """
        Initialize exporter.

        Args:
            model: The architecture model
            options: Export options
        """
        self.model = model
        self.options = options

    def export(self) -> Path:
        """
        Perform export. Must be implemented by subclasses.

        Returns:
            Path to exported file(s)
        """
        raise NotImplementedError

    def validate_output(self, output_path: Path) -> bool:
        """
        Validate exported output.

        Args:
            output_path: Path to exported file

        Returns:
            True if valid, False otherwise
        """
        # Default: just check file exists
        return output_path.exists()


class ExportManager:
    """
    Manages export operations.

    Coordinates different exporters and provides unified export interface.
    """

    def __init__(self, model):
        """
        Initialize export manager.

        Args:
            model: The architecture model
        """
        self.model = model
        self.exporters: Dict[ExportFormat, Type[BaseExporter]] = {}
        self._register_exporters()

    def _register_exporters(self) -> None:
        """Register all available exporters."""
        try:
            from .archimate_exporter import ArchiMateExporter

            self.exporters[ExportFormat.ARCHIMATE] = ArchiMateExporter
        except ImportError:
            pass

        try:
            from .openapi_exporter import OpenAPIExporter

            self.exporters[ExportFormat.OPENAPI] = OpenAPIExporter
        except ImportError:
            pass

        try:
            from .schema_exporter import JSONSchemaExporter

            self.exporters[ExportFormat.JSON_SCHEMA] = JSONSchemaExporter
        except ImportError:
            pass

        try:
            from .plantuml_exporter import PlantUMLExporter

            self.exporters[ExportFormat.PLANTUML] = PlantUMLExporter
        except ImportError:
            pass

        try:
            from .markdown_exporter import MarkdownExporter

            self.exporters[ExportFormat.MARKDOWN] = MarkdownExporter
        except ImportError:
            pass

        try:
            from .graphml_exporter import GraphMLExporter

            self.exporters[ExportFormat.GRAPHML] = GraphMLExporter
        except ImportError:
            pass

    def export(self, format: ExportFormat, output_path: Optional[Path] = None, **kwargs) -> Path:
        """
        Export model to specified format.

        Args:
            format: Export format
            output_path: Optional output path (default: specs/{format}/)
            **kwargs: Additional export options

        Returns:
            Path to exported file(s)
        """
        # Get exporter class
        exporter_class = self.exporters.get(format)
        if not exporter_class:
            raise ValueError(f"Unsupported export format: {format}")

        # Determine output path
        if not output_path:
            output_path = self._get_default_output_path(format)

        # Create export options
        options = ExportOptions(format=format, output_path=output_path, **kwargs)

        # Create exporter and export
        exporter = exporter_class(self.model, options)
        result_path = exporter.export()

        # Validate output if requested
        if options.validate_output:
            if not exporter.validate_output(result_path):
                raise ValueError(f"Exported file failed validation: {result_path}")

        return result_path

    def _get_default_output_path(self, format: ExportFormat) -> Path:
        """Get default output path for format."""
        # Get specs path from model
        if hasattr(self.model, "specs_path"):
            base_path = self.model.specs_path
        else:
            # Fallback to current directory
            base_path = Path.cwd() / "specs"

        format_paths = {
            ExportFormat.ARCHIMATE: base_path / "archimate" / "model.archimate",
            ExportFormat.OPENAPI: base_path / "openapi",
            ExportFormat.JSON_SCHEMA: base_path / "schemas",
            ExportFormat.PLANTUML: base_path / "diagrams",
            ExportFormat.MARKDOWN: base_path / "docs",
            ExportFormat.GRAPHML: base_path / "graphs" / "model.graphml",
        }

        return format_paths.get(format, base_path)

    def export_all(
        self, formats: Optional[List[ExportFormat]] = None, output_dir: Optional[Path] = None
    ) -> Dict[ExportFormat, Path]:
        """
        Export to multiple formats.

        Args:
            formats: List of formats (default: all)
            output_dir: Base output directory

        Returns:
            Dictionary mapping format to output path
        """
        if formats is None:
            formats = list(ExportFormat)

        results = {}

        for format in formats:
            try:
                output_path = self.export(format, output_dir)
                results[format] = output_path
            except Exception as e:
                print(f"Warning: Failed to export {format.value}: {e}")

        return results
