"""Unit tests for source reference utilities."""

import pytest

from documentation_robotics.utils.source_ref_utils import (
    filter_elements_by_source,
    get_repository_info,
    get_source_locations,
    get_source_provenance,
    get_source_reference,
    has_source_reference,
)


class TestGetSourceReference:
    """Tests for get_source_reference function."""

    def test_extract_source_reference_from_properties(self):
        """Test extracting source reference from element properties."""
        element_data = {
            "name": "test-element",
            "properties": {
                "source": {"reference": {"provenance": "manual", "locations": []}}
            },
        }
        source_ref = get_source_reference(element_data)
        assert source_ref is not None
        assert source_ref["provenance"] == "manual"

    def test_return_none_when_no_source_reference(self):
        """Test returning None when element has no source reference."""
        element_data = {"name": "test-element", "properties": {}}
        source_ref = get_source_reference(element_data)
        assert source_ref is None

    def test_return_none_when_no_properties(self):
        """Test returning None when element has no properties."""
        element_data = {"name": "test-element"}
        source_ref = get_source_reference(element_data)
        assert source_ref is None

    def test_return_none_when_empty_data(self):
        """Test returning None when element data is empty."""
        source_ref = get_source_reference({})
        assert source_ref is None

    def test_return_none_when_data_is_none(self):
        """Test returning None when element data is None."""
        source_ref = get_source_reference(None)
        assert source_ref is None


class TestHasSourceReference:
    """Tests for has_source_reference function."""

    def test_return_true_when_source_ref_exists(self):
        """Test returning True when source reference exists."""
        element_data = {
            "name": "test-element",
            "properties": {
                "source": {"reference": {"provenance": "manual"}}
            },
        }
        assert has_source_reference(element_data) is True

    def test_return_false_when_no_source_ref(self):
        """Test returning False when source reference doesn't exist."""
        element_data = {"name": "test-element"}
        assert has_source_reference(element_data) is False

    def test_return_false_for_empty_data(self):
        """Test returning False for empty data."""
        assert has_source_reference({}) is False


class TestGetSourceProvenance:
    """Tests for get_source_provenance function."""

    def test_extract_manual_provenance(self):
        """Test extracting manual provenance."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {"provenance": "manual", "locations": []}
                }
            }
        }
        provenance = get_source_provenance(element_data)
        assert provenance == "manual"

    def test_extract_extracted_provenance(self):
        """Test extracting extracted provenance."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {"provenance": "extracted", "locations": []}
                }
            }
        }
        provenance = get_source_provenance(element_data)
        assert provenance == "extracted"

    def test_extract_inferred_provenance(self):
        """Test extracting inferred provenance."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {"provenance": "inferred", "locations": []}
                }
            }
        }
        provenance = get_source_provenance(element_data)
        assert provenance == "inferred"

    def test_extract_generated_provenance(self):
        """Test extracting generated provenance."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {"provenance": "generated", "locations": []}
                }
            }
        }
        provenance = get_source_provenance(element_data)
        assert provenance == "generated"

    def test_return_none_when_no_source_ref(self):
        """Test returning None when no source reference."""
        provenance = get_source_provenance({"name": "test"})
        assert provenance is None


class TestGetSourceLocations:
    """Tests for get_source_locations function."""

    def test_extract_single_location(self):
        """Test extracting a single source location."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "provenance": "manual",
                        "locations": [{"file": "src/main.py", "symbol": "MyClass"}],
                    }
                }
            }
        }
        locations = get_source_locations(element_data)
        assert len(locations) == 1
        assert locations[0]["file"] == "src/main.py"
        assert locations[0]["symbol"] == "MyClass"

    def test_extract_multiple_locations(self):
        """Test extracting multiple source locations."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "provenance": "extracted",
                        "locations": [
                            {"file": "src/main.py", "symbol": "MyClass"},
                            {"file": "src/utils.py", "symbol": "helper_func"},
                        ],
                    }
                }
            }
        }
        locations = get_source_locations(element_data)
        assert len(locations) == 2
        assert locations[0]["file"] == "src/main.py"
        assert locations[1]["file"] == "src/utils.py"

    def test_return_empty_list_when_no_locations(self):
        """Test returning empty list when no locations."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "provenance": "manual",
                        "locations": [],
                    }
                }
            }
        }
        locations = get_source_locations(element_data)
        assert locations == []

    def test_return_empty_list_when_no_source_ref(self):
        """Test returning empty list when no source reference."""
        locations = get_source_locations({"name": "test"})
        assert locations == []


class TestGetRepositoryInfo:
    """Tests for get_repository_info function."""

    def test_extract_repository_info(self):
        """Test extracting repository information."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "provenance": "extracted",
                        "locations": [{"file": "src/main.py"}],
                        "repository": {
                            "url": "https://github.com/example/repo.git",
                            "commit": "abc123def456",
                        },
                    }
                }
            }
        }
        repo_info = get_repository_info(element_data)
        assert repo_info is not None
        assert repo_info["url"] == "https://github.com/example/repo.git"
        assert repo_info["commit"] == "abc123def456"

    def test_return_none_when_no_repository(self):
        """Test returning None when no repository info."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "provenance": "manual",
                        "locations": [{"file": "src/main.py"}],
                    }
                }
            }
        }
        repo_info = get_repository_info(element_data)
        assert repo_info is None

    def test_return_none_when_no_source_ref(self):
        """Test returning None when no source reference."""
        repo_info = get_repository_info({"name": "test"})
        assert repo_info is None


class MockElement:
    """Mock Element class for testing."""

    def __init__(self, data):
        self.data = data


class TestFilterElementsBySource:
    """Tests for filter_elements_by_source function."""

    def test_filter_has_source_ref_true(self):
        """Test filtering to elements WITH source references."""
        elements = [
            MockElement(
                {
                    "name": "with-source",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
            MockElement({"name": "without-source"}),
        ]

        results = filter_elements_by_source(elements, has_source_ref=True)
        assert len(results) == 1
        assert results[0].data["name"] == "with-source"

    def test_filter_has_source_ref_false(self):
        """Test filtering to elements WITHOUT source references."""
        elements = [
            MockElement(
                {
                    "name": "with-source",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
            MockElement({"name": "without-source"}),
        ]

        results = filter_elements_by_source(elements, has_source_ref=False)
        assert len(results) == 1
        assert results[0].data["name"] == "without-source"

    def test_filter_by_provenance_manual(self):
        """Test filtering by manual provenance."""
        elements = [
            MockElement(
                {
                    "name": "manual-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
            MockElement(
                {
                    "name": "extracted-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "extracted"}
                        }
                    },
                }
            ),
        ]

        results = filter_elements_by_source(elements, has_source_ref=True, provenance="manual")
        assert len(results) == 1
        assert results[0].data["name"] == "manual-element"

    def test_filter_by_provenance_extracted(self):
        """Test filtering by extracted provenance."""
        elements = [
            MockElement(
                {
                    "name": "manual-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
            MockElement(
                {
                    "name": "extracted-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "extracted"}
                        }
                    },
                }
            ),
            MockElement(
                {
                    "name": "inferred-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "inferred"}
                        }
                    },
                }
            ),
        ]

        results = filter_elements_by_source(elements, has_source_ref=True, provenance="extracted")
        assert len(results) == 1
        assert results[0].data["name"] == "extracted-element"

    def test_filter_by_provenance_generated(self):
        """Test filtering by generated provenance."""
        elements = [
            MockElement(
                {
                    "name": "generated-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "generated"}
                        }
                    },
                }
            ),
            MockElement({"name": "no-source"}),
        ]

        results = filter_elements_by_source(elements, has_source_ref=True, provenance="generated")
        assert len(results) == 1
        assert results[0].data["name"] == "generated-element"

    def test_filter_by_provenance_inferred(self):
        """Test filtering by inferred provenance."""
        elements = [
            MockElement(
                {
                    "name": "inferred-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "inferred"}
                        }
                    },
                }
            ),
            MockElement(
                {
                    "name": "manual-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
        ]

        results = filter_elements_by_source(elements, has_source_ref=True, provenance="inferred")
        assert len(results) == 1
        assert results[0].data["name"] == "inferred-element"

    def test_filter_with_dict_elements(self):
        """Test filtering works with dict elements."""
        elements = [
            {
                "name": "with-source",
                "properties": {
                    "source": {
                        "reference": {"provenance": "manual"}
                    }
                },
            },
            {"name": "without-source"},
        ]

        results = filter_elements_by_source(elements, has_source_ref=True)
        assert len(results) == 1
        assert results[0]["name"] == "with-source"

    def test_filter_no_filtering_when_none_specified(self):
        """Test no filtering when no criteria specified."""
        elements = [
            MockElement(
                {
                    "name": "with-source",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
            MockElement({"name": "without-source"}),
        ]

        results = filter_elements_by_source(elements)
        assert len(results) == 2

    def test_filter_empty_list(self):
        """Test filtering empty list returns empty list."""
        results = filter_elements_by_source([], has_source_ref=True)
        assert results == []

    def test_filter_provenance_without_source_ref_excludes_no_source(self):
        """Test that provenance filter excludes elements without source refs."""
        elements = [
            MockElement(
                {
                    "name": "manual-element",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
            MockElement({"name": "no-source"}),
        ]

        results = filter_elements_by_source(elements, provenance="manual")
        assert len(results) == 1
        assert results[0].data["name"] == "manual-element"

    def test_filter_preserves_element_order(self):
        """Test that filtering preserves element order."""
        elements = [
            MockElement(
                {
                    "name": "first",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "manual"}
                        }
                    },
                }
            ),
            MockElement({"name": "second"}),
            MockElement(
                {
                    "name": "third",
                    "properties": {
                        "source": {
                            "reference": {"provenance": "extracted"}
                        }
                    },
                }
            ),
        ]

        results = filter_elements_by_source(elements, has_source_ref=True)
        assert len(results) == 2
        assert results[0].data["name"] == "first"
        assert results[1].data["name"] == "third"
