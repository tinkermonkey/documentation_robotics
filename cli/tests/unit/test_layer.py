"""Unit tests for Layer class."""

from documentation_robotics.core.element import Element


class TestLayerListElements:
    """Tests for Layer.list_elements() method."""

    def test_list_elements_returns_all_elements(self, initialized_model):
        """Test that list_elements returns all elements in a layer."""
        # Get a layer that should have elements
        business_layer = initialized_model.get_layer("business")
        assert business_layer is not None

        elements = business_layer.list_elements()
        assert isinstance(elements, list)

        # Elements should be Element instances
        for element in elements:
            assert isinstance(element, Element)
            assert element.layer == "business"

    def test_list_elements_returns_list_type(self, initialized_model):
        """Test that list_elements returns a list."""
        application_layer = initialized_model.get_layer("application")
        assert application_layer is not None

        elements = application_layer.list_elements()
        assert isinstance(elements, list)

    def test_list_elements_length_matches_elements_dict(self, initialized_model):
        """Test that list_elements length matches number of elements."""
        motivation_layer = initialized_model.get_layer("motivation")
        assert motivation_layer is not None

        elements = motivation_layer.list_elements()
        assert len(elements) == len(motivation_layer.elements)

    def test_list_elements_empty_layer(self, initialized_model):
        """Test list_elements on a layer with no elements."""
        # Find a layer that might be empty
        for layer_name in initialized_model.list_layers():
            layer = initialized_model.get_layer(layer_name)
            if len(layer.elements) == 0:
                elements = layer.list_elements()
                assert isinstance(elements, list)
                assert len(elements) == 0
                break

    def test_list_elements_contains_all_element_ids(self, initialized_model):
        """Test that list_elements contains all elements from elements dict."""
        security_layer = initialized_model.get_layer("security")
        assert security_layer is not None

        elements = security_layer.list_elements()
        element_ids = [e.id for e in elements]

        # Verify each element from elements dict is in the list
        for element_id in security_layer.elements.keys():
            assert element_id in element_ids
