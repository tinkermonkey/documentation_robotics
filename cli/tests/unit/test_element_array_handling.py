"""Test Element array handling with additive-by-default behavior."""

import pytest
from documentation_robotics.core.element import Element


class TestArrayDetection:
    """Test array property detection logic."""

    def test_detect_array_from_known_properties(self):
        """Test that well-known array properties are detected."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test"},
        )

        # Well-known array properties
        assert element._is_array_property("deployedOn") is True
        assert element._is_array_property("realizes") is True
        assert element._is_array_property("uses") is True
        assert element._is_array_property("dependsOn") is True

    def test_detect_array_from_existing_value(self):
        """Test that existing array values are detected."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "tags": ["tag1", "tag2"]},
        )

        # Should detect from existing array value
        assert element._is_array_property("tags") is True

    def test_detect_scalar_property(self):
        """Test that scalar properties are not detected as arrays."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "status": "active"},
        )

        # Should not detect scalars as arrays
        assert element._is_array_property("name") is False
        assert element._is_array_property("status") is False


class TestAdditiveUpdate:
    """Test additive update behavior (default mode)."""

    def test_add_to_empty_array_property(self):
        """Test adding first value to array property."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test"},
        )

        results = element.update({"deployedOn": "technology.framework.react"}, mode="add")

        assert element.data["deployedOn"] == ["technology.framework.react"]
        assert results["deployedOn"] == ["technology.framework.react"]

    def test_add_to_existing_array(self):
        """Test adding value to existing array."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "deployedOn": ["technology.framework.react"]},
        )

        results = element.update({"deployedOn": "technology.language.typescript"}, mode="add")

        assert element.data["deployedOn"] == [
            "technology.framework.react",
            "technology.language.typescript",
        ]
        assert len(results["deployedOn"]) == 2

    def test_add_duplicate_to_array(self):
        """Test that duplicates are not added to arrays."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "deployedOn": ["technology.framework.react"]},
        )

        results = element.update({"deployedOn": "technology.framework.react"}, mode="add")

        # Should not add duplicate
        assert element.data["deployedOn"] == ["technology.framework.react"]
        assert len(results["deployedOn"]) == 1

    def test_add_scalar_property(self):
        """Test adding scalar property replaces value."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "status": "active"},
        )

        results = element.update({"status": "deprecated"}, mode="add")

        assert element.data["status"] == "deprecated"
        assert results["status"] == ["deprecated"]

    def test_add_multiple_properties(self):
        """Test adding multiple properties at once."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test"},
        )

        results = element.update(
            {
                "deployedOn": "technology.framework.react",
                "status": "active",
                "uses": "api.service.auth",
            },
            mode="add",
        )

        assert element.data["deployedOn"] == ["technology.framework.react"]
        assert element.data["status"] == "active"
        assert element.data["uses"] == ["api.service.auth"]

        # Verify results reflect the updates
        assert results["deployedOn"] == ["technology.framework.react"]
        assert results["status"] == ["active"]
        assert results["uses"] == ["api.service.auth"]


class TestReplaceMode:
    """Test replace mode for complete overwrites."""

    def test_replace_scalar_property(self):
        """Test replacing scalar property."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "status": "active"},
        )

        results = element.update({"status": "deprecated"}, mode="replace")

        assert element.data["status"] == "deprecated"
        assert results["status"] == ["deprecated"]

    def test_replace_array_property(self):
        """Test replacing entire array."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={
                "name": "Test",
                "deployedOn": ["technology.framework.react", "technology.language.typescript"],
            },
        )

        results = element.update({"deployedOn": "technology.language.python"}, mode="replace")

        assert element.data["deployedOn"] == "technology.language.python"
        assert results["deployedOn"] == ["technology.language.python"]


class TestRemoveMode:
    """Test remove mode for removing values."""

    def test_remove_value_from_array(self):
        """Test removing specific value from array."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={
                "name": "Test",
                "deployedOn": ["technology.framework.react", "technology.language.typescript"],
            },
        )

        results = element.update({"deployedOn": "technology.framework.react"}, mode="remove")

        assert element.data["deployedOn"] == ["technology.language.typescript"]
        assert results["deployedOn"] == ["technology.language.typescript"]

    def test_remove_nonexistent_value(self):
        """Test removing value that doesn't exist raises error."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "deployedOn": ["technology.framework.react"]},
        )

        with pytest.raises(ValueError, match="not found in deployedOn"):
            element.update({"deployedOn": "technology.language.python"}, mode="remove")

    def test_remove_scalar_property(self):
        """Test removing scalar property deletes it."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "status": "active"},
        )

        results = element.update({"status": "active"}, mode="remove")

        assert "status" not in element.data
        assert results["status"] == ["(removed)"]


class TestUnset:
    """Test unset method for removing properties."""

    def test_unset_property(self):
        """Test unsetting property removes it."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "status": "active", "priority": "high"},
        )

        results = element.unset(["status"])

        assert "status" not in element.data
        assert results["status"] == "active"

    def test_unset_multiple_properties(self):
        """Test unsetting multiple properties."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test", "status": "active", "priority": "high"},
        )

        results = element.unset(["status", "priority"])

        assert "status" not in element.data
        assert "priority" not in element.data
        assert results["status"] == "active"
        assert results["priority"] == "high"

    def test_unset_nonexistent_property(self):
        """Test unsetting nonexistent property raises error."""
        element = Element(
            id="app.component.test",
            element_type="component",
            layer="application",
            data={"name": "Test"},
        )

        with pytest.raises(ValueError, match="Property 'status' not found"):
            element.unset(["status"])


class TestRegressionIssue41:
    """Regression tests for GitHub Issue #41 - array overwriting bug."""

    def test_sequential_set_builds_array(self):
        """Test that sequential --set commands build arrays instead of overwriting.

        This is the core issue from #41 where users expected sequential updates
        to append to arrays, but instead they were overwriting.
        """
        element = Element(
            id="app.component.viewer",
            element_type="component",
            layer="application",
            data={"name": "Viewer App"},
        )

        # First update
        element.update({"deployedOn": "technology.framework.react"}, mode="add")
        assert element.data["deployedOn"] == ["technology.framework.react"]

        # Second update - should append, not overwrite
        element.update({"deployedOn": "technology.language.typescript"}, mode="add")
        assert element.data["deployedOn"] == [
            "technology.framework.react",
            "technology.language.typescript",
        ]

        # Third update - should continue appending
        element.update({"deployedOn": "technology.library.react-flow"}, mode="add")
        assert element.data["deployedOn"] == [
            "technology.framework.react",
            "technology.language.typescript",
            "technology.library.react-flow",
        ]

    def test_issue_41_scenario(self):
        """Test the exact scenario from Issue #41."""
        # viewer-app component
        viewer = Element(
            id="app.component.viewer-app",
            element_type="component",
            layer="application",
            data={"name": "Viewer App"},
        )

        # User runs: dr update-element app.component.viewer-app --set deployedOn=technology.framework.react
        viewer.update({"deployedOn": "technology.framework.react"}, mode="add")

        # User runs: dr update-element app.component.viewer-app --set deployedOn=technology.language.typescript
        # OLD BEHAVIOR: Would overwrite, leaving only typescript
        # NEW BEHAVIOR: Should append
        viewer.update({"deployedOn": "technology.language.typescript"}, mode="add")

        # Verify both values are present
        assert "technology.framework.react" in viewer.data["deployedOn"]
        assert "technology.language.typescript" in viewer.data["deployedOn"]
        assert len(viewer.data["deployedOn"]) == 2
