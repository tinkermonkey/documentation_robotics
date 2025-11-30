"""
Integration tests for specification loading.

Tests loading the real DR specification from the filesystem,
verifying end-to-end functionality with actual spec directory.
"""

import json
from pathlib import Path

import pytest

from documentation_robotics.server.specification_loader import SpecificationLoader

# Test constants
EXPECTED_REAL_SPEC_LAYER_COUNT = 12  # Total number of layers in real DR specification


@pytest.fixture
def real_spec_path():
    """Get path to real spec directory."""
    spec_path = Path("/workspace/spec")
    if spec_path.exists():
        return spec_path
    pytest.skip("Real spec directory not available")


class TestRealSpecificationIntegration:
    """Integration tests with actual spec directory structure."""

    def test_load_real_specification(self, real_spec_path):
        """Test loading the actual DR specification."""
        loader = SpecificationLoader(real_spec_path)
        spec_data = loader.load_specification()

        # Verify structure
        assert "version" in spec_data
        assert "layers" in spec_data
        assert len(spec_data["layers"]) == EXPECTED_REAL_SPEC_LAYER_COUNT  # Should have all 12 layers

    def test_real_specification_layer_order(self, real_spec_path):
        """Test real specification has correct layer ordering."""
        loader = SpecificationLoader(real_spec_path)
        spec_data = loader.load_specification()

        layer_names = [layer["name"] for layer in spec_data["layers"]]

        # Verify standard layers are present
        # Note: Some layers may have different names in the spec (e.g., "apm-observability" vs "apm")
        expected_layers = [
            "motivation",
            "business",
            "security",
            "application",
            "technology",
            "api",
            "data-model",  # Uses hyphen in spec
            "datastore",
            "ux",
            "navigation",
            "apm-observability",  # Full name in spec
            "testing",
        ]

        for expected_layer in expected_layers:
            assert expected_layer in layer_names, f"Layer {expected_layer} not found in {layer_names}"

    def test_real_specification_json_serializable(self, real_spec_path):
        """Test real specification is JSON-serializable."""
        loader = SpecificationLoader(real_spec_path)
        spec_data = loader.load_specification()

        # Should not raise exception
        json_str = json.dumps(spec_data)
        assert json_str is not None

        # Verify size is reasonable (should be >1KB, <10MB)
        assert len(json_str) > 1000
        assert len(json_str) < 10_000_000

    def test_real_specification_version(self, real_spec_path):
        """Test real specification has valid version."""
        loader = SpecificationLoader(real_spec_path)
        spec_data = loader.load_specification()

        version = spec_data["version"]
        assert version != "unknown"
        assert len(version.split(".")) >= 2  # Should be semantic version (x.y or x.y.z)
