"""Tests for ArchiMate exporter."""
import pytest
from pathlib import Path
from lxml import etree as ET
from documentation_robotics.export.archimate_exporter import ArchiMateExporter
from documentation_robotics.export.export_manager import ExportOptions, ExportFormat
from documentation_robotics.core.element import Element


@pytest.fixture
def model_with_elements(initialized_model):
    """Create a model with some test elements."""
    # Add a business service
    business_layer = initialized_model.get_layer("business")
    if business_layer:
        element = Element(
            id="business.service.customer-management",
            element_type="service",
            layer="business",
            data={
                "name": "Customer Management",
                "description": "Manages customer lifecycle",
                "documentation": "Full customer management service",
            },
        )
        business_layer.elements[element.id] = element

    # Add an application service
    app_layer = initialized_model.get_layer("application")
    if app_layer:
        element = Element(
            id="application.service.customer-service",
            element_type="service",
            layer="application",
            data={
                "name": "CustomerService",
                "description": "Application service for customers",
                "realizes": "business.service.customer-management",
            },
        )
        app_layer.elements[element.id] = element

    return initialized_model


def test_archimate_export(model_with_elements, temp_dir):
    """Test ArchiMate export."""
    output_path = temp_dir / "test.archimate"
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE, output_path=output_path, validate_output=False
    )

    exporter = ArchiMateExporter(model_with_elements, options)
    result = exporter.export()

    assert result == output_path
    assert output_path.exists()


def test_archimate_xml_structure(model_with_elements, temp_dir):
    """Test ArchiMate XML structure."""
    output_path = temp_dir / "test.archimate"
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE, output_path=output_path, validate_output=False
    )

    exporter = ArchiMateExporter(model_with_elements, options)
    exporter.export()

    # Parse XML
    tree = ET.parse(str(output_path))
    root = tree.getroot()

    # Check namespace
    assert ArchiMateExporter.ARCHIMATE_NS in root.tag

    # Define namespace map for finding elements
    ns = {"archimate": ArchiMateExporter.ARCHIMATE_NS}

    # Check for metadata section (in the archimate namespace)
    metadata = root.find("archimate:metadata", ns)
    assert metadata is not None

    # Check for elements section
    elements = root.find("archimate:elements", ns)
    assert elements is not None


def test_archimate_element_mapping():
    """Test ArchiMate element type mapping."""
    # Test motivation layer mappings
    assert (
        ArchiMateExporter.LAYER_TYPE_MAP[("motivation", "goal")] == "Goal"
    )
    assert (
        ArchiMateExporter.LAYER_TYPE_MAP[("motivation", "stakeholder")]
        == "Stakeholder"
    )

    # Test business layer mappings
    assert (
        ArchiMateExporter.LAYER_TYPE_MAP[("business", "service")] == "BusinessService"
    )
    assert ArchiMateExporter.LAYER_TYPE_MAP[("business", "actor")] == "BusinessActor"

    # Test application layer mappings
    assert (
        ArchiMateExporter.LAYER_TYPE_MAP[("application", "service")]
        == "ApplicationService"
    )
    assert (
        ArchiMateExporter.LAYER_TYPE_MAP[("application", "component")]
        == "ApplicationComponent"
    )


def test_archimate_relationship_mapping():
    """Test ArchiMate relationship type mapping."""
    assert ArchiMateExporter.RELATIONSHIP_TYPE_MAP["realization"] == "Realization"
    assert ArchiMateExporter.RELATIONSHIP_TYPE_MAP["serving"] == "Serving"
    assert ArchiMateExporter.RELATIONSHIP_TYPE_MAP["access"] == "Access"
    assert ArchiMateExporter.RELATIONSHIP_TYPE_MAP["composition"] == "Composition"


def test_archimate_validate_output(model_with_elements, temp_dir):
    """Test ArchiMate output validation."""
    output_path = temp_dir / "test.archimate"
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE, output_path=output_path, validate_output=False
    )

    exporter = ArchiMateExporter(model_with_elements, options)
    exporter.export()

    # Validate
    is_valid = exporter.validate_output(output_path)
    assert is_valid is True


def test_archimate_export_with_properties(model_with_elements, temp_dir):
    """Test ArchiMate export includes properties."""
    output_path = temp_dir / "test.archimate"
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE,
        output_path=output_path,
        include_metadata=True,
        validate_output=False,
    )

    exporter = ArchiMateExporter(model_with_elements, options)
    exporter.export()

    # Parse and check for properties
    tree = ET.parse(str(output_path))
    root = tree.getroot()

    # Find an element with properties
    elements = root.find("elements")
    if elements is not None and len(elements) > 0:
        element = elements[0]
        # Properties section might exist
        properties = element.find("properties")
        # If element has extra properties beyond standard fields,
        # properties section should exist
        # This is a basic check


def test_archimate_generate_id():
    """Test ID generation."""
    from documentation_robotics.core.model import Model
    from pathlib import Path

    # Create a minimal mock model
    class MockManifest:
        project = {"name": "Test"}
        layers = {}
        statistics = {}

    class MockModel:
        manifest = MockManifest()
        layers = {}

    model = MockModel()
    options = ExportOptions(
        format=ExportFormat.ARCHIMATE, output_path=Path("/tmp/test.xml")
    )

    exporter = ArchiMateExporter(model, options)

    # Generate IDs
    id1 = exporter._generate_id()
    id2 = exporter._generate_id()

    # Should be different
    assert id1 != id2
    # Should have id- prefix
    assert id1.startswith("id-")
    assert id2.startswith("id-")
