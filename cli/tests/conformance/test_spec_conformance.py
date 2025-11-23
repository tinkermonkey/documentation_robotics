"""
Conformance tests for the Federated Architecture Metadata Model specification.

These tests validate that the CLI correctly implements the specification.
"""
import pytest
import yaml
from pathlib import Path
from documentation_robotics.spec_version import (
    SPEC_VERSION,
    CONFORMANCE_LEVEL,
    IMPLEMENTED_LAYERS,
    get_conformance_statement,
)


class TestSpecificationConformance:
    """Test specification conformance."""

    def test_spec_version_defined(self):
        """Test that spec version is defined."""
        assert SPEC_VERSION is not None
        assert isinstance(SPEC_VERSION, str)
        # Should be in semver format
        parts = SPEC_VERSION.split(".")
        assert len(parts) == 3
        assert all(part.isdigit() for part in parts)

    def test_conformance_level_valid(self):
        """Test that conformance level is valid."""
        assert CONFORMANCE_LEVEL in ["basic", "standard", "full"]

    def test_full_conformance_has_all_layers(self):
        """Test that full conformance implements all 11 layers."""
        if CONFORMANCE_LEVEL == "full":
            assert len(IMPLEMENTED_LAYERS) == 11
            assert all(layer["implemented"] for layer in IMPLEMENTED_LAYERS.values())

    def test_conformance_statement_structure(self):
        """Test that conformance statement has required structure."""
        statement = get_conformance_statement()

        # Check top-level keys
        assert "implementation" in statement
        assert "specification" in statement
        assert "layers" in statement
        assert "capabilities" in statement

        # Check implementation section
        impl = statement["implementation"]
        assert "name" in impl
        assert "version" in impl
        assert "vendor" in impl

        # Check specification section
        spec = statement["specification"]
        assert "name" in spec
        assert "version" in spec
        assert spec["version"] == SPEC_VERSION
        assert "conformanceLevel" in spec
        assert spec["conformanceLevel"] == CONFORMANCE_LEVEL


class TestConformanceTestSuite:
    """Test that the CLI can run conformance tests."""

    @pytest.fixture
    def spec_test_fixtures_path(self):
        """Get path to specification test fixtures."""
        # Assuming tests are in cli/tests and spec is ../spec
        cli_root = Path(__file__).parent.parent.parent
        spec_root = cli_root.parent / "spec"
        return spec_root / "test-fixtures"

    def test_test_fixtures_exist(self, spec_test_fixtures_path):
        """Test that specification test fixtures exist."""
        assert spec_test_fixtures_path.exists(), (
            f"Specification test fixtures not found at {spec_test_fixtures_path}. "
            "Ensure spec/ directory is at the same level as cli/"
        )

    def test_valid_fixtures_directory_exists(self, spec_test_fixtures_path):
        """Test that valid fixtures directory exists."""
        valid_path = spec_test_fixtures_path / "valid"
        assert valid_path.exists(), f"Valid fixtures not found at {valid_path}"

    def test_invalid_fixtures_directory_exists(self, spec_test_fixtures_path):
        """Test that invalid fixtures directory exists."""
        invalid_path = spec_test_fixtures_path / "invalid"
        assert invalid_path.exists(), f"Invalid fixtures not found at {invalid_path}"

    @pytest.mark.skip(reason="Implement when fixture format is finalized")
    def test_can_validate_valid_fixtures(self, spec_test_fixtures_path):
        """Test that the CLI can validate valid test fixtures."""
        # TODO: Implement test that runs dr validate on valid fixtures
        pass

    @pytest.mark.skip(reason="Implement when fixture format is finalized")
    def test_can_reject_invalid_fixtures(self, spec_test_fixtures_path):
        """Test that the CLI correctly rejects invalid test fixtures."""
        # TODO: Implement test that runs dr validate on invalid fixtures
        # and verifies they are rejected with appropriate errors
        pass


class TestLayerImplementation:
    """Test that all claimed layers are implemented."""

    @pytest.mark.parametrize("layer_name,layer_info", IMPLEMENTED_LAYERS.items())
    def test_layer_implemented(self, layer_name, layer_info):
        """Test that each claimed layer is actually implemented."""
        if layer_info["implemented"]:
            # TODO: Add actual checks that the layer is implemented
            # For now, just verify the structure
            assert "standard" in layer_info
            assert layer_info["standard"] is not None


# Note: Additional conformance tests should be added as the test fixture
# format is finalized and the validation implementation is completed.
