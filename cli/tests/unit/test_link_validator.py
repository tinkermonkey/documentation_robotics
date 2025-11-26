"""Unit tests for LinkValidator."""

import json

import pytest
from documentation_robotics.core.link_analyzer import LinkAnalyzer
from documentation_robotics.core.link_registry import LinkRegistry
from documentation_robotics.validators.link_validator import (
    LinkValidator,
    ValidationIssue,
    ValidationSeverity,
)


class TestLinkValidator:
    """Tests for LinkValidator."""

    @pytest.fixture
    def sample_registry_data(self):
        """Create sample registry data for testing."""
        return {
            "metadata": {"version": "3.0.0"},
            "categories": {"motivation": {"name": "Motivation"}},
            "linkTypes": [
                {
                    "id": "motivation-supports-goals",
                    "name": "Supports Goals",
                    "category": "motivation",
                    "sourceLayers": ["02-business"],
                    "targetLayer": "01-motivation",
                    "targetElementTypes": ["Goal"],
                    "fieldPaths": ["motivation.supports-goals"],
                    "cardinality": "array",
                    "format": "uuid",
                    "description": "References to goals",
                    "examples": [],
                    "validationRules": {
                        "targetExists": True,
                        "targetType": "Goal",
                        "formatPattern": "^[a-f0-9\\-]{36}$",
                    },
                },
                {
                    "id": "single-ref",
                    "name": "Single Reference",
                    "category": "motivation",
                    "sourceLayers": ["02-business"],
                    "targetLayer": "01-motivation",
                    "targetElementTypes": ["Goal"],
                    "fieldPaths": ["single-goal-ref"],
                    "cardinality": "single",
                    "format": "uuid",
                    "description": "Single goal reference",
                    "examples": [],
                    "validationRules": {"formatPattern": "^[a-f0-9\\-]{36}$"},
                },
            ],
        }

    @pytest.fixture
    def registry_file(self, tmp_path, sample_registry_data):
        """Create a temporary registry file."""
        registry_path = tmp_path / "link-registry.json"
        with open(registry_path, "w") as f:
            json.dump(sample_registry_data, f)
        return registry_path

    @pytest.fixture
    def registry(self, registry_file):
        """Create a LinkRegistry instance."""
        return LinkRegistry(registry_file)

    @pytest.fixture
    def valid_model_data(self):
        """Create valid model data for testing."""
        return {
            "01-motivation-layer": {
                "goals": [
                    {"id": "550e8400-e29b-41d4-a716-446655440000", "name": "Goal 1"},
                    {"id": "550e8400-e29b-41d4-a716-446655440001", "name": "Goal 2"},
                ]
            },
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Valid Service",
                        "motivation": {
                            "supports-goals": [
                                "550e8400-e29b-41d4-a716-446655440000",
                                "550e8400-e29b-41d4-a716-446655440001",
                            ]
                        },
                    }
                ]
            },
        }

    def test_validator_initialization(self, registry):
        """Test LinkValidator initialization."""
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        assert validator.registry == registry
        assert validator.analyzer == analyzer
        assert validator.strict_mode is False
        assert len(validator.issues) == 0

    def test_validator_strict_mode(self, registry):
        """Test LinkValidator in strict mode."""
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer, strict_mode=True)

        assert validator.strict_mode is True

    def test_validate_all_valid_model(self, registry, valid_model_data):
        """Test validating a completely valid model."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(valid_model_data)

        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        assert len(issues) == 0
        assert validator.has_errors() is False

    def test_validate_missing_target(self, registry):
        """Test validation with missing target element."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service with broken link",
                        "motivation": {"supports-goals": ["nonexistent-goal"]},
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        assert len(issues) > 0
        missing_target_issues = [i for i in issues if i.issue_type == "missing_target"]
        assert len(missing_target_issues) == 1
        assert "nonexistent-goal" in missing_target_issues[0].message

    def test_validate_missing_target_strict_mode(self, registry):
        """Test missing target in strict mode raises error."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": ["nonexistent-goal"]},
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer, strict_mode=True)
        issues = validator.validate_all()

        error_issues = [i for i in issues if i.severity == ValidationSeverity.ERROR]
        assert len(error_issues) > 0

    def test_validate_type_mismatch(self, registry):
        """Test validation with incorrect target type."""
        model_data = {
            "01-motivation-layer": {
                "requirements": [  # Wrong type - should be goals
                    {"id": "req-1", "name": "Requirement 1"}
                ]
            },
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {
                            "supports-goals": ["req-1"]  # Links to Requirement, not Goal
                        },
                    }
                ]
            },
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        type_mismatch_issues = [i for i in issues if i.issue_type == "type_mismatch"]
        assert len(type_mismatch_issues) > 0

    def test_validate_cardinality_single_with_array(self, registry):
        """Test validation when single value expected but array provided."""
        model_data = {
            "01-motivation-layer": {
                "goals": [{"id": "550e8400-e29b-41d4-a716-446655440000", "name": "Goal 1"}]
            },
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "single-goal-ref": [  # Array provided for single cardinality
                            "550e8400-e29b-41d4-a716-446655440000",
                            "550e8400-e29b-41d4-a716-446655440001",
                        ],
                    }
                ]
            },
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        cardinality_issues = [i for i in issues if i.issue_type == "cardinality_mismatch"]
        assert len(cardinality_issues) > 0

    def test_validate_empty_array(self, registry):
        """Test validation with empty array link."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": []},  # Empty array
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        empty_array_issues = [i for i in issues if i.issue_type == "empty_array"]
        assert len(empty_array_issues) > 0
        assert empty_array_issues[0].severity == ValidationSeverity.WARNING

    def test_validate_format_mismatch(self, registry):
        """Test validation with invalid format."""
        model_data = {
            "01-motivation-layer": {
                "goals": [{"id": "not-a-uuid", "name": "Goal 1"}]  # Invalid UUID format
            },
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": ["not-a-uuid"]},
                    }
                ]
            },
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        format_issues = [i for i in issues if i.issue_type == "format_mismatch"]
        assert len(format_issues) > 0

    def test_get_issues_by_severity(self, registry):
        """Test filtering issues by severity."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": []},  # Warning: empty array
                    },
                    {
                        "id": "service-2",
                        "name": "Service 2",
                        "motivation": {
                            "supports-goals": ["nonexistent"]  # Warning/Error: missing target
                        },
                    },
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        validator.validate_all()

        warnings = validator.get_issues_by_severity(ValidationSeverity.WARNING)
        assert len(warnings) > 0

    def test_get_issues_by_type(self, registry):
        """Test filtering issues by type."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": ["nonexistent-1", "nonexistent-2"]},
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        validator.validate_all()

        missing_issues = validator.get_issues_by_type("missing_target")
        assert len(missing_issues) > 0

    def test_get_issues_for_element(self, registry):
        """Test getting issues for a specific element."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service 1",
                        "motivation": {"supports-goals": ["nonexistent"]},
                    },
                    {
                        "id": "service-2",
                        "name": "Service 2",
                        "motivation": {"supports-goals": ["also-nonexistent"]},
                    },
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        validator.validate_all()

        service1_issues = validator.get_issues_for_element("service-1")
        assert len(service1_issues) > 0
        assert all(i.link_instance.source_id == "service-1" for i in service1_issues)

    def test_has_errors(self, registry):
        """Test checking if errors exist."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": []},  # Just warning
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        # Non-strict mode - should not have errors
        validator = LinkValidator(registry, analyzer, strict_mode=False)
        validator.validate_all()
        assert validator.has_errors() is False

        # Strict mode - warnings become errors
        validator_strict = LinkValidator(registry, analyzer, strict_mode=True)
        validator_strict.validate_all()
        # Empty array might still be warning even in strict mode
        # But missing targets should be errors

    def test_get_summary(self, registry):
        """Test getting validation summary."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": ["nonexistent"]},
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        validator.validate_all()

        summary = validator.get_summary()
        assert "total_issues" in summary
        assert "errors" in summary
        assert "warnings" in summary
        assert "strict_mode" in summary
        assert "issues_by_type" in summary
        assert summary["total_issues"] > 0

    def test_suggest_similar_elements(self, registry):
        """Test suggesting similar elements for missing targets."""
        model_data = {
            "01-motivation-layer": {
                "goals": [{"id": "goal-customer-satisfaction", "name": "Goal 1"}]
            },
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": ["goal-customer-satisfactio"]},  # Typo
                    }
                ]
            },
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        missing_issues = [i for i in issues if i.issue_type == "missing_target"]
        assert len(missing_issues) > 0
        # Should have a suggestion for similar element
        assert missing_issues[0].suggestion is not None

    def test_validation_issue_str(self, registry, valid_model_data):
        """Test ValidationIssue string representation."""
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(valid_model_data)

        # Create a mock issue
        if len(analyzer.links) > 0:
            link = analyzer.links[0]
            issue = ValidationIssue(
                severity=ValidationSeverity.ERROR,
                link_instance=link,
                issue_type="test_issue",
                message="Test message",
                suggestion="Test suggestion",
            )

            issue_str = str(issue)
            assert "ERROR" in issue_str
            assert "test_issue" in issue_str
            assert "Test message" in issue_str
            assert "Test suggestion" in issue_str

    def test_print_issues(self, registry, capsys):
        """Test printing validation issues."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": ["nonexistent"]},
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        validator.validate_all()
        validator.print_issues()

        captured = capsys.readouterr()
        # Should have printed something
        assert len(captured.out) > 0

    def test_print_issues_filtered(self, registry, capsys):
        """Test printing filtered validation issues."""
        model_data = {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Service",
                        "motivation": {"supports-goals": []},  # Warning
                    }
                ]
            }
        }

        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(model_data)

        validator = LinkValidator(registry, analyzer)
        validator.validate_all()
        validator.print_issues(severity_filter=ValidationSeverity.WARNING)

        captured = capsys.readouterr()
        assert len(captured.out) > 0

    def test_repr(self, registry):
        """Test string representation."""
        analyzer = LinkAnalyzer(registry)
        validator = LinkValidator(registry, analyzer)

        repr_str = repr(validator)
        assert "LinkValidator" in repr_str
        assert "issues=" in repr_str
        assert "strict_mode=" in repr_str
