"""
Integration tests for model serialization.

Tests serialization with real model instances and spec directory,
verifying end-to-end functionality with actual file system interaction.
"""

import json
from pathlib import Path

import pytest
from documentation_robotics.server.model_serializer import serialize_model_state
from documentation_robotics.server.specification_loader import SpecificationLoader


@pytest.fixture
def real_spec_path():
    """Get path to real spec directory."""
    spec_path = Path("/workspace/spec")
    if spec_path.exists():
        return spec_path
    pytest.skip("Real spec directory not available")


class TestRealModelIntegration:
    """Integration tests with real model and specification."""

    def test_serialize_real_model_with_spec(self, initialized_model, temp_dir, real_spec_path):
        """Test serializing a real model with actual specification."""
        # Load specification
        spec_loader = SpecificationLoader(real_spec_path)
        spec_data = spec_loader.load_specification()

        # Serialize model state
        model_state = serialize_model_state(initialized_model, temp_dir)

        # Verify both model and spec are present
        assert "model" in model_state
        assert "changesets" in model_state
        assert spec_data["version"] is not None

        # Verify complete structure
        assert "manifest" in model_state["model"]
        assert "layers" in model_state["model"]
        assert "statistics" in model_state["model"]

    def test_complete_websocket_payload(self, initialized_model, temp_dir, real_spec_path):
        """Test creating complete WebSocket payload with model and spec."""
        # Load specification
        spec_loader = SpecificationLoader(real_spec_path)
        spec_data = spec_loader.load_specification()

        # Serialize model state
        model_state = serialize_model_state(initialized_model, temp_dir)

        # Create complete WebSocket payload
        websocket_payload = {
            "type": "initial_state",
            "model": model_state["model"],
            "changesets": model_state["changesets"],
            "specification": spec_data,
        }

        # Verify JSON serializability
        json_str = json.dumps(websocket_payload)
        assert json_str is not None

        # Verify structure
        parsed = json.loads(json_str)
        assert parsed["type"] == "initial_state"
        assert "model" in parsed
        assert "specification" in parsed

    def test_model_serialization_performance(self, initialized_model, temp_dir):
        """Test that serialization completes in reasonable time."""
        import time

        start_time = time.time()
        model_state = serialize_model_state(initialized_model, temp_dir)
        elapsed_time = time.time() - start_time

        # Serialization should complete in under 1 second for typical models
        assert elapsed_time < 1.0

        # Verify result is valid
        assert "model" in model_state
        assert "changesets" in model_state
