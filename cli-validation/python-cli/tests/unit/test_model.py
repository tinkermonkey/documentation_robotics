"""Unit tests for Model class."""


class TestModelListLayers:
    """Tests for Model.list_layers() method."""

    def test_list_layers_returns_all_layer_names(self, initialized_model):
        """Test that list_layers returns all layer names."""
        layers = initialized_model.list_layers()

        assert isinstance(layers, list)
        assert len(layers) > 0

        # Should contain standard layers
        assert "motivation" in layers
        assert "business" in layers
        assert "application" in layers
        assert "security" in layers
        assert "technology" in layers
        assert "api" in layers
        assert "data_model" in layers
        assert "datastore" in layers
        assert "ux" in layers
        assert "navigation" in layers
        assert "apm" in layers

    def test_list_layers_returns_list_type(self, initialized_model):
        """Test that list_layers returns a list."""
        layers = initialized_model.list_layers()
        assert isinstance(layers, list)

    def test_list_layers_length_matches_layers_dict(self, initialized_model):
        """Test that list_layers length matches number of loaded layers."""
        layers = initialized_model.list_layers()
        assert len(layers) == len(initialized_model.layers)

    def test_list_layers_contains_expected_layer_names(self, initialized_model):
        """Test that list_layers contains expected layer names."""
        layers = initialized_model.list_layers()

        # Verify each layer from layers dict is in the list
        for layer_name in initialized_model.layers.keys():
            assert layer_name in layers
