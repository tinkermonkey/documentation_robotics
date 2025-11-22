"""Tests for export manager."""
import pytest
from pathlib import Path
from documentation_robotics.export.export_manager import (
    ExportManager,
    ExportFormat,
    ExportOptions,
    BaseExporter,
)


def test_export_format_enum():
    """Test ExportFormat enum."""
    assert ExportFormat.ARCHIMATE.value == "archimate"
    assert ExportFormat.OPENAPI.value == "openapi"
    assert ExportFormat.JSON_SCHEMA.value == "schema"
    assert ExportFormat.PLANTUML.value == "plantuml"
    assert ExportFormat.MARKDOWN.value == "markdown"
    assert ExportFormat.GRAPHML.value == "graphml"


def test_export_options_creation():
    """Test ExportOptions dataclass."""
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE,
        output_path=Path("/tmp/test.xml"),
        layer_filter="business",
        validate_output=True,
    )

    assert options.format == ExportFormat.ARCHIMATE
    assert options.output_path == Path("/tmp/test.xml")
    assert options.layer_filter == "business"
    assert options.validate_output is True


def test_export_manager_initialization(initialized_model):
    """Test ExportManager initialization."""
    export_mgr = ExportManager(initialized_model)

    assert export_mgr.model == initialized_model
    assert isinstance(export_mgr.exporters, dict)
    # Should have registered some exporters
    assert len(export_mgr.exporters) > 0


def test_export_manager_get_default_output_path(initialized_model):
    """Test default output path generation."""
    export_mgr = ExportManager(initialized_model)

    # Test ArchiMate path
    path = export_mgr._get_default_output_path(ExportFormat.ARCHIMATE)
    assert "archimate" in str(path)
    assert path.name == "model.archimate"

    # Test OpenAPI path
    path = export_mgr._get_default_output_path(ExportFormat.OPENAPI)
    assert "openapi" in str(path)

    # Test PlantUML path
    path = export_mgr._get_default_output_path(ExportFormat.PLANTUML)
    assert "diagrams" in str(path)


class MockExporter(BaseExporter):
    """Mock exporter for testing."""

    def export(self) -> Path:
        """Mock export."""
        self.options.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.options.output_path.write_text("mock export")
        return self.options.output_path

    def validate_output(self, output_path: Path) -> bool:
        """Mock validation."""
        return output_path.exists()


def test_base_exporter_initialization(initialized_model):
    """Test BaseExporter initialization."""
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE, output_path=Path("/tmp/test.xml")
    )
    exporter = MockExporter(initialized_model, options)

    assert exporter.model == initialized_model
    assert exporter.options == options


def test_base_exporter_export_not_implemented(initialized_model):
    """Test that BaseExporter.export() raises NotImplementedError."""
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE, output_path=Path("/tmp/test.xml")
    )
    exporter = BaseExporter(initialized_model, options)

    with pytest.raises(NotImplementedError):
        exporter.export()
