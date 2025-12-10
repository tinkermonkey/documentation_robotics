"""Test Model.to_dict() method."""

from pathlib import Path

from documentation_robotics.core.element import Element
from documentation_robotics.core.layer import Layer


def test_element_to_dict():
    """Test Element.to_dict() returns correct structure."""
    element = Element(
        id="test.element.foo",
        element_type="component",
        layer="test",
        data={"name": "Foo", "description": "Test element"},
    )

    result = element.to_dict()

    assert result["id"] == "test.element.foo"
    assert result["type"] == "component"
    assert result["layer"] == "test"
    assert result["name"] == "Foo"
    assert result["description"] == "Test element"


def test_layer_to_dict():
    """Test Layer.to_dict() groups elements by type."""
    # Create a layer with mock config
    layer = Layer(
        name="test-layer",
        path=Path("/tmp/test"),
        config={"enabled": True},
    )

    # Add elements manually
    elem1 = Element(
        id="test.component.foo",
        element_type="component",
        layer="test",
        data={"name": "Foo"},
    )
    elem2 = Element(
        id="test.component.bar",
        element_type="component",
        layer="test",
        data={"name": "Bar"},
    )
    elem3 = Element(
        id="test.service.baz",
        element_type="service",
        layer="test",
        data={"name": "Baz"},
    )

    layer.elements[elem1.id] = elem1
    layer.elements[elem2.id] = elem2
    layer.elements[elem3.id] = elem3

    result = layer.to_dict()

    # Check that elements are grouped by pluralized type
    assert "components" in result
    assert "services" in result
    assert len(result["components"]) == 2
    assert len(result["services"]) == 1

    # Check component data
    component_ids = [e["id"] for e in result["components"]]
    assert "test.component.foo" in component_ids
    assert "test.component.bar" in component_ids

    # Check service data
    assert result["services"][0]["id"] == "test.service.baz"


def test_layer_pluralize_type():
    """Test Layer._pluralize_type() method."""
    layer = Layer(
        name="test",
        path=Path("/tmp/test"),
        config={},
    )

    assert layer._pluralize_type("goal") == "goals"
    assert layer._pluralize_type("service") == "services"
    assert layer._pluralize_type("repository") == "repositories"
    assert layer._pluralize_type("component") == "components"
    assert layer._pluralize_type("entity") == "entities"  # Ends with 'y'
    assert layer._pluralize_type("services") == "services"  # Already plural (ends with 's')
