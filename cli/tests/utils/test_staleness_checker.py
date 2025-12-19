"""Unit tests for staleness checking utilities."""

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

# Import MockElement from parent conftest
sys.path.insert(0, str(Path(__file__).parent.parent))
from conftest import MockElement

from documentation_robotics.utils.staleness_checker import (
    StaleSourceRef,
    check_staleness,
    format_stale_report,
    get_commit_date,
    parse_threshold,
)


class TestParseThreshold:
    """Tests for parse_threshold function."""

    def test_parse_days_singular(self):
        """Test parsing single day threshold."""
        delta = parse_threshold("1day")
        assert delta == timedelta(days=1)

    def test_parse_days_plural(self):
        """Test parsing multiple days threshold."""
        delta = parse_threshold("90days")
        assert delta == timedelta(days=90)

    def test_parse_weeks_singular(self):
        """Test parsing single week threshold."""
        delta = parse_threshold("1week")
        assert delta == timedelta(weeks=1)

    def test_parse_weeks_plural(self):
        """Test parsing multiple weeks threshold."""
        delta = parse_threshold("4weeks")
        assert delta == timedelta(weeks=4)

    def test_parse_months(self):
        """Test parsing months threshold (approximated as 30 days)."""
        delta = parse_threshold("6months")
        assert delta == timedelta(days=6 * 30)

    def test_parse_month_singular(self):
        """Test parsing single month threshold."""
        delta = parse_threshold("1month")
        assert delta == timedelta(days=30)

    def test_parse_years(self):
        """Test parsing years threshold (approximated as 365 days)."""
        delta = parse_threshold("1year")
        assert delta == timedelta(days=365)

    def test_parse_years_plural(self):
        """Test parsing multiple years threshold."""
        delta = parse_threshold("2years")
        assert delta == timedelta(days=2 * 365)

    def test_parse_case_insensitive(self):
        """Test parsing is case insensitive."""
        delta1 = parse_threshold("90DAYS")
        delta2 = parse_threshold("90days")
        assert delta1 == delta2

    def test_parse_invalid_format_raises_error(self):
        """Test invalid format raises ValueError."""
        with pytest.raises(ValueError):
            parse_threshold("invalid")

    def test_parse_missing_number_raises_error(self):
        """Test missing number raises ValueError."""
        with pytest.raises(ValueError):
            parse_threshold("days")

    def test_parse_missing_unit_raises_error(self):
        """Test missing unit raises ValueError."""
        with pytest.raises(ValueError):
            parse_threshold("90")


class TestGetCommitDate:
    """Tests for get_commit_date function."""

    def test_extract_iso_timestamp(self):
        """Test extracting ISO format timestamp."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "repository": {
                            "timestamp": "2024-01-15T10:30:00"
                        }
                    }
                }
            }
        }
        date = get_commit_date(element_data)
        assert date is not None
        assert date.year == 2024
        assert date.month == 1
        assert date.day == 15

    def test_extract_date_field(self):
        """Test extracting date field."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "repository": {
                            "date": "2024-06-01T15:30:00"
                        }
                    }
                }
            }
        }
        date = get_commit_date(element_data)
        assert date is not None
        assert date.year == 2024
        assert date.month == 6

    def test_return_none_when_no_repository(self):
        """Test returning None when no repository info."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "provenance": "manual"
                    }
                }
            }
        }
        date = get_commit_date(element_data)
        assert date is None

    def test_return_none_when_no_source_ref(self):
        """Test returning None when no source reference."""
        element_data = {"name": "test"}
        date = get_commit_date(element_data)
        assert date is None

    def test_return_none_when_invalid_timestamp_format(self):
        """Test returning None with invalid timestamp format."""
        element_data = {
            "properties": {
                "source": {
                    "reference": {
                        "repository": {
                            "timestamp": "invalid-date"
                        }
                    }
                }
            }
        }
        date = get_commit_date(element_data)
        assert date is None


class TestCheckStaleness:
    """Tests for check_staleness function."""

    def test_identify_stale_source_with_old_commit(self):
        """Test identifying stale source with old commit."""
        now = datetime.now()
        old_date = now - timedelta(days=100)

        elements = [
            MockElement(
                "api-endpoint-get-user",
                {
                    "name": "Get User",
                    "properties": {
                        "source": {
                            "reference": {
                                "provenance": "extracted",
                                "locations": [{"file": "src/handlers/users.py"}],
                                "repository": {
                                    "commit": "abc123def456",
                                    "timestamp": old_date.isoformat(),
                                },
                            }
                        }
                    },
                },
            )
        ]

        stale_refs = check_staleness(elements, threshold="90days", reference_date=now)
        assert len(stale_refs) == 1
        assert stale_refs[0].element_id == "api-endpoint-get-user"

    def test_no_staleness_with_recent_commit(self):
        """Test no staleness found with recent commit."""
        now = datetime.now()
        recent_date = now - timedelta(days=30)

        elements = [
            MockElement(
                "api-endpoint-get-user",
                {
                    "name": "Get User",
                    "properties": {
                        "source": {
                            "reference": {
                                "provenance": "extracted",
                                "locations": [{"file": "src/handlers/users.py"}],
                                "repository": {
                                    "commit": "abc123def456",
                                    "timestamp": recent_date.isoformat(),
                                },
                            }
                        }
                    },
                },
            )
        ]

        stale_refs = check_staleness(elements, threshold="90days", reference_date=now)
        assert len(stale_refs) == 0

    def test_skip_elements_without_source_ref(self):
        """Test skipping elements without source references."""
        elements = [
            MockElement(
                "api-endpoint-create",
                {"name": "Create User"},
            )
        ]

        stale_refs = check_staleness(elements, threshold="90days")
        assert len(stale_refs) == 0

    def test_skip_elements_without_commit_date(self):
        """Test skipping elements without commit date."""
        elements = [
            MockElement(
                "api-endpoint-get-user",
                {
                    "name": "Get User",
                    "properties": {
                        "source": {
                            "reference": {
                                "provenance": "manual",
                                "locations": [{"file": "src/handlers.py"}],
                                "repository": {
                                    "commit": "abc123def456",
                                    # No timestamp
                                },
                            }
                        }
                    },
                },
            )
        ]

        stale_refs = check_staleness(elements, threshold="90days")
        assert len(stale_refs) == 0

    def test_extract_element_metadata_in_stale_ref(self):
        """Test that stale ref contains element metadata."""
        now = datetime.now()
        old_date = now - timedelta(days=100)

        elements = [
            MockElement(
                "api-endpoint-get-user",
                {
                    "name": "Get User",
                    "properties": {
                        "source": {
                            "reference": {
                                "provenance": "extracted",
                                "locations": [
                                    {
                                        "file": "src/handlers/users.py",
                                        "symbol": "get_user_handler",
                                    }
                                ],
                                "repository": {
                                    "url": "https://github.com/example/repo.git",
                                    "commit": "abc123def456789abc123def456789abc123def4",
                                    "timestamp": old_date.isoformat(),
                                },
                            }
                        }
                    },
                },
            )
        ]

        stale_refs = check_staleness(elements, threshold="90days", reference_date=now)
        assert len(stale_refs) == 1

        ref = stale_refs[0]
        assert ref.element_id == "api-endpoint-get-user"
        assert ref.element_name == "Get User"
        assert ref.source_file == "src/handlers/users.py"
        assert ref.source_symbol == "get_user_handler"
        assert ref.commit_sha == "abc123de"  # First 8 chars
        assert ref.repository_url == "https://github.com/example/repo.git"

    def test_calculate_days_old_correctly(self):
        """Test that days_old is calculated correctly."""
        now = datetime.now()
        old_date = now - timedelta(days=183)

        elements = [
            MockElement(
                "test-element",
                {
                    "name": "Test",
                    "properties": {
                        "source": {
                            "reference": {
                                "provenance": "extracted",
                                "locations": [{"file": "test.py"}],
                                "repository": {
                                    "commit": "abc123",
                                    "timestamp": old_date.isoformat(),
                                },
                            }
                        }
                    },
                },
            )
        ]

        stale_refs = check_staleness(elements, threshold="90days", reference_date=now)
        assert stale_refs[0].days_old == 183

    def test_handle_multiple_elements_mixed_staleness(self):
        """Test handling multiple elements with mixed staleness."""
        now = datetime.now()
        stale_date = now - timedelta(days=100)
        fresh_date = now - timedelta(days=30)

        elements = [
            MockElement(
                "stale-element",
                {
                    "name": "Stale",
                    "properties": {
                        "source": {
                            "reference": {
                                "provenance": "extracted",
                                "locations": [{"file": "stale.py"}],
                                "repository": {
                                    "commit": "abc123",
                                    "timestamp": stale_date.isoformat(),
                                },
                            }
                        }
                    },
                },
            ),
            MockElement(
                "fresh-element",
                {
                    "name": "Fresh",
                    "properties": {
                        "source": {
                            "reference": {
                                "provenance": "extracted",
                                "locations": [{"file": "fresh.py"}],
                                "repository": {
                                    "commit": "def456",
                                    "timestamp": fresh_date.isoformat(),
                                },
                            }
                        }
                    },
                },
            ),
        ]

        stale_refs = check_staleness(elements, threshold="90days", reference_date=now)
        assert len(stale_refs) == 1
        assert stale_refs[0].element_id == "stale-element"

    def test_handle_dict_elements(self):
        """Test that check_staleness works with dict elements."""
        now = datetime.now()
        old_date = now - timedelta(days=100)

        elements = [
            {
                "id": "dict-element",
                "name": "Dict Element",
                "properties": {
                    "source": {
                        "reference": {
                            "provenance": "extracted",
                            "locations": [{"file": "test.py"}],
                            "repository": {
                                "commit": "abc123",
                                "timestamp": old_date.isoformat(),
                            },
                        }
                    }
                },
            }
        ]

        stale_refs = check_staleness(elements, threshold="90days", reference_date=now)
        assert len(stale_refs) == 1


class TestFormatStaleReport:
    """Tests for format_stale_report function."""

    def test_format_empty_stale_list(self):
        """Test formatting empty stale references list."""
        report = format_stale_report([], total_elements_with_sources=10)
        assert "No stale" in report
        assert "✓" in report

    def test_format_single_stale_ref(self):
        """Test formatting single stale reference."""
        now = datetime.now()
        old_date = now - timedelta(days=183)

        stale_refs = [
            StaleSourceRef(
                element_id="api-endpoint-legacy-service",
                element_name="Legacy Service",
                source_file="src/services/legacy.py",
                source_symbol="LegacyServiceHandler",
                commit_sha="abc123de",
                commit_date=old_date,
                days_old=183,
                repository_url="https://github.com/example/repo.git",
            )
        ]

        report = format_stale_report(stale_refs, total_elements_with_sources=45)
        assert "api-endpoint-legacy-service" in report
        assert "Legacy Service" in report
        assert "src/services/legacy.py" in report
        assert "183 days old" in report
        assert "1/45" in report

    def test_format_multiple_stale_refs(self):
        """Test formatting multiple stale references."""
        now = datetime.now()
        date1 = now - timedelta(days=100)
        date2 = now - timedelta(days=150)

        stale_refs = [
            StaleSourceRef(
                element_id="element-1",
                element_name="Element One",
                source_file="file1.py",
                source_symbol="func1",
                commit_sha="abc123de",
                commit_date=date1,
                days_old=100,
                repository_url="https://github.com/example/repo.git",
            ),
            StaleSourceRef(
                element_id="element-2",
                element_name="Element Two",
                source_file="file2.py",
                source_symbol="func2",
                commit_sha="def456ab",
                commit_date=date2,
                days_old=150,
                repository_url="https://github.com/example/repo.git",
            ),
        ]

        report = format_stale_report(stale_refs, total_elements_with_sources=50)
        assert "element-1" in report
        assert "element-2" in report
        assert "2/50" in report
        assert "100 days old" in report
        assert "150 days old" in report

    def test_format_includes_recommendations(self):
        """Test that format includes recommendations."""
        stale_refs = [
            StaleSourceRef(
                element_id="test-element",
                element_name="Test",
                source_file="test.py",
                source_symbol="test_func",
                commit_sha="abc123de",
                commit_date=datetime.now() - timedelta(days=100),
                days_old=100,
                repository_url="https://github.com/example/repo.git",
            )
        ]

        report = format_stale_report(stale_refs, 10)
        assert "Re-ingest" in report or "verify manually" in report

    def test_format_without_symbol(self):
        """Test formatting stale ref without symbol."""
        stale_refs = [
            StaleSourceRef(
                element_id="test-element",
                element_name="Test",
                source_file="test.py",
                source_symbol=None,
                commit_sha="abc123de",
                commit_date=datetime.now() - timedelta(days=100),
                days_old=100,
                repository_url="https://github.com/example/repo.git",
            )
        ]

        report = format_stale_report(stale_refs, 10)
        assert "test.py" in report
        assert "test-element" in report

    def test_format_without_commit_date(self):
        """Test formatting stale ref without commit date."""
        stale_refs = [
            StaleSourceRef(
                element_id="test-element",
                element_name="Test",
                source_file="test.py",
                source_symbol="test_func",
                commit_sha="abc123de",
                commit_date=None,
                days_old=100,
                repository_url="https://github.com/example/repo.git",
            )
        ]

        report = format_stale_report(stale_refs, 10)
        assert "test-element" in report
        assert "abc123de" in report
