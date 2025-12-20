"""Unit tests for source map exporter."""

import json

import pytest
from documentation_robotics.core.element import Element
from documentation_robotics.export.export_manager import ExportFormat, ExportOptions
from documentation_robotics.export.source_map_exporter import SourceMapExporter


@pytest.fixture
def element_with_source_reference():
    """Create an element with source reference."""
    return Element(
        id="api-endpoint-create-order",
        element_type="Operation",
        layer="06-api",
        data={
            "id": "api-endpoint-create-order",
            "name": "Create Order",
            "x-source-reference": {
                "locations": [
                    {
                        "file": "src/routes/orders.py",
                        "symbol": "create_order_route",
                    }
                ],
                "provenance": "extracted",
                "repository": {
                    "commit": "abc123def456",
                },
            },
        },
    )


@pytest.fixture
def element_with_properties_source_reference():
    """Create an element with source reference in properties."""
    return Element(
        id="application-service-order",
        element_type="ApplicationService",
        layer="04-application",
        data={
            "id": "application-service-order",
            "name": "Order Service",
            "properties": {
                "source": {
                    "reference": {
                        "locations": [
                            {
                                "file": "src/services/order_service.py",
                                "symbol": "OrderService",
                            }
                        ],
                        "provenance": "extracted",
                        "repository": {
                            "commit": "def456ghi789",
                        },
                    }
                }
            },
        },
    )


@pytest.fixture
def element_without_source_reference():
    """Create an element without source reference."""
    return Element(
        id="api-endpoint-list-products",
        element_type="Operation",
        layer="06-api",
        data={
            "id": "api-endpoint-list-products",
            "name": "List Products",
        },
    )


@pytest.fixture
def mock_model(initialized_model):
    """Create a mock model with source references."""
    return initialized_model


def test_source_map_exporter_initialization(mock_model, tmp_path):
    """Test SourceMapExporter initialization."""
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)

    assert exporter.model is mock_model
    assert exporter.options == options


def test_source_map_generation_empty_model(mock_model, tmp_path):
    """Test source map generation with empty model."""
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)

    output_file = exporter.export()

    assert output_file.exists()
    assert output_file.suffix == ".json"

    # Load and verify content
    with open(output_file) as f:
        source_map = json.load(f)

    assert "version" in source_map
    assert "generated" in source_map
    assert "sourceMap" in source_map
    assert isinstance(source_map["sourceMap"], list)
    assert source_map["sourceMap"] == []


def test_extract_source_references_with_x_source_reference(
    element_with_source_reference, mock_model, tmp_path
):
    """Test extracting source references from x-source-reference field."""
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)
    entries = exporter._extract_source_references(element_with_source_reference, "06-api")

    assert len(entries) == 1
    assert entries[0]["file"] == "src/routes/orders.py"
    assert entries[0]["symbol"] == "create_order_route"
    assert entries[0]["entity"]["id"] == "api-endpoint-create-order"
    assert entries[0]["entity"]["layer"] == "06-api"
    assert entries[0]["entity"]["type"] == "Operation"
    assert entries[0]["entity"]["name"] == "Create Order"
    assert entries[0]["provenance"] == "extracted"
    assert entries[0]["commit"] == "abc123def456"


def test_extract_source_references_with_properties_source_reference(
    element_with_properties_source_reference,
    mock_model,
    tmp_path,
):
    """Test extracting source references from properties.source.reference field."""
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)
    entries = exporter._extract_source_references(
        element_with_properties_source_reference, "04-application"
    )

    assert len(entries) == 1
    assert entries[0]["file"] == "src/services/order_service.py"
    assert entries[0]["symbol"] == "OrderService"
    assert entries[0]["entity"]["id"] == "application-service-order"
    assert entries[0]["entity"]["layer"] == "04-application"
    assert entries[0]["entity"]["type"] == "ApplicationService"
    assert entries[0]["entity"]["name"] == "Order Service"
    assert entries[0]["provenance"] == "extracted"
    assert entries[0]["commit"] == "def456ghi789"


def test_extract_source_references_without_source_reference(
    element_without_source_reference, mock_model, tmp_path
):
    """Test extracting source references from element without source reference."""
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)
    entries = exporter._extract_source_references(element_without_source_reference, "06-api")

    assert len(entries) == 0


def test_extract_source_references_multiple_locations(mock_model, tmp_path):
    """Test extracting source references with multiple locations."""
    element = Element(
        id="api-endpoint-multi",
        element_type="Operation",
        layer="06-api",
        data={
            "id": "api-endpoint-multi",
            "name": "Multi Location Operation",
            "x-source-reference": {
                "locations": [
                    {
                        "file": "src/routes/api.py",
                        "symbol": "api_handler",
                    },
                    {
                        "file": "src/handlers/handler.py",
                        "symbol": "handle_operation",
                    },
                ],
                "provenance": "manual",
                "repository": {
                    "commit": "xyz789abc",
                },
            },
        },
    )

    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)
    entries = exporter._extract_source_references(element, "06-api")

    assert len(entries) == 2
    assert entries[0]["file"] == "src/routes/api.py"
    assert entries[0]["symbol"] == "api_handler"
    assert entries[1]["file"] == "src/handlers/handler.py"
    assert entries[1]["symbol"] == "handle_operation"
    assert entries[0]["commit"] == "xyz789abc"
    assert entries[1]["commit"] == "xyz789abc"


def test_extract_source_references_without_commit(mock_model, tmp_path):
    """Test extracting source references without commit hash."""
    element = Element(
        id="api-endpoint-no-commit",
        element_type="Operation",
        layer="06-api",
        data={
            "id": "api-endpoint-no-commit",
            "name": "No Commit Operation",
            "x-source-reference": {
                "locations": [
                    {
                        "file": "src/routes/api.py",
                        "symbol": "api_handler",
                    }
                ],
                "provenance": "manual",
            },
        },
    )

    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)
    entries = exporter._extract_source_references(element, "06-api")

    assert len(entries) == 1
    assert "commit" not in entries[0]


def test_generate_source_map_with_layer_filter(mock_model, tmp_path):
    """Test generating source map with layer filter."""
    # Add test data with source references to the model
    # This will depend on the model structure, but we can test the basic generation
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
        layer_filter="01-motivation",
    )
    exporter = SourceMapExporter(mock_model, options)
    source_map = exporter._generate_source_map()

    assert "version" in source_map
    assert "generated" in source_map
    assert isinstance(source_map["sourceMap"], list)


def test_source_map_generated_timestamp(mock_model, tmp_path):
    """Test that generated timestamp is in correct ISO format."""
    # The timestamp should be in ISO 8601 format with Z suffix
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)
    source_map = exporter._generate_source_map()

    # Verify the timestamp format
    assert "generated" in source_map
    timestamp = source_map["generated"]
    # Should end with Z for UTC
    assert timestamp.endswith("Z")
    # Should be parseable as ISO format
    try:
        from datetime import datetime as dt

        dt.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        pytest.fail(f"Invalid ISO timestamp format: {timestamp}")


def test_source_map_output_to_file(mock_model, tmp_path):
    """Test writing source map to file."""
    options = ExportOptions(
        format=ExportFormat.SOURCE_MAP,
        output_path=tmp_path,
    )
    exporter = SourceMapExporter(mock_model, options)

    output_file = exporter.export()

    assert output_file.exists()
    assert output_file.is_file()

    # Verify JSON is valid
    with open(output_file) as f:
        source_map = json.load(f)

    assert isinstance(source_map, dict)
    assert "version" in source_map
    assert "generated" in source_map
    assert "sourceMap" in source_map
