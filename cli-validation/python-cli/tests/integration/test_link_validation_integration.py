"""Integration tests for link validation workflows."""

import json

import pytest
from documentation_robotics.core.link_analyzer import LinkAnalyzer
from documentation_robotics.core.link_registry import LinkRegistry
from documentation_robotics.core.migration_registry import MigrationRegistry
from documentation_robotics.validators.link_validator import LinkValidator


class TestLinkValidationIntegration:
    """Integration tests for link validation."""

    @pytest.fixture
    def sample_registry_data(self):
        """Create sample registry data."""
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
                    "validationRules": {"targetExists": True, "targetType": "Goal"},
                }
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
    def valid_model_data(self):
        """Create valid model data."""
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

    @pytest.fixture
    def invalid_model_data(self):
        """Create invalid model data with broken links."""
        return {
            "02-business-layer": {
                "businessServices": [
                    {
                        "id": "service-1",
                        "name": "Invalid Service",
                        "motivation": {"supports-goals": ["nonexistent-goal-id"]},  # Broken link
                    }
                ]
            }
        }

    # End-to-end validation tests (3 tests)

    def test_validate_valid_model_end_to_end(self, registry_file, valid_model_data):
        """Test validation workflow with valid model."""
        # Load registry
        registry = LinkRegistry(registry_file)

        # Analyze model
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(valid_model_data)

        # Validate
        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        # Should have no errors (might have warnings)
        errors = [i for i in issues if i.severity.value == "error"]
        assert len(errors) == 0

    def test_validate_invalid_model_detects_errors(self, registry_file, invalid_model_data):
        """Test validation detects broken links."""
        # Load registry
        registry = LinkRegistry(registry_file)

        # Analyze model
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(invalid_model_data)

        # Validate
        validator = LinkValidator(registry, analyzer)
        issues = validator.validate_all()

        # Should detect the broken link
        assert len(issues) > 0
        assert any("nonexistent-goal-id" in i.message for i in issues)

    def test_strict_mode_fails_on_warnings(self, registry_file, invalid_model_data):
        """Test strict mode treats warnings as errors."""
        # Load registry
        registry = LinkRegistry(registry_file)

        # Analyze model
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(invalid_model_data)

        # Validate in strict mode
        validator = LinkValidator(registry, analyzer, strict_mode=True)
        _issues = validator.validate_all()

        # Strict mode should flag issues
        assert validator.has_errors()

    # Migration integration tests (3 tests)

    def test_migration_check_detects_needed_migrations(self, tmp_path):
        """Test migration check workflow."""
        # Create model directory with old-style naming
        model_dir = tmp_path / "model"
        model_dir.mkdir()

        layer_dir = model_dir / "02_business"
        layer_dir.mkdir()

        service_file = layer_dir / "service.yaml"
        service_file.write_text(
            """- id: service-1
  motivation:
    supportsGoals: [goal-1]
"""
        )

        # Check for migrations
        migration_registry = MigrationRegistry()
        latest = migration_registry.get_latest_version()
        summary = migration_registry.get_migration_summary("0.1.0", latest)

        assert summary["migrations_needed"] > 0

    def test_migration_dry_run_doesnt_modify(self, tmp_path):
        """Test dry-run migration."""
        # Create model directory
        model_dir = tmp_path / "model"
        model_dir.mkdir()

        layer_dir = model_dir / "02_business"
        layer_dir.mkdir()

        service_file = layer_dir / "service.yaml"
        original_content = """- id: service-1
  motivation:
    supportsGoals: [goal-1]
"""
        service_file.write_text(original_content)

        # Run dry-run migration
        migration_registry = MigrationRegistry()
        latest = migration_registry.get_latest_version()
        _result = migration_registry.apply_migrations(
            model_path=model_dir, from_version="0.1.0", to_version=latest, dry_run=True
        )

        # File should not be modified
        assert service_file.read_text() == original_content

    def test_migration_fixes_validation_issues(self, tmp_path, registry_file):
        """Test that migration resolves link issues."""
        # Create model with old naming
        model_dir = tmp_path / "model"
        model_dir.mkdir()

        layer_dir = model_dir / "02_business"
        layer_dir.mkdir()

        service_file = layer_dir / "service.yaml"
        service_file.write_text(
            """- id: service-1
  motivation:
    supportsGoals: [550e8400-e29b-41d4-a716-446655440000]
"""
        )

        # Apply migration
        migration_registry = MigrationRegistry()
        latest = migration_registry.get_latest_version()
        result = migration_registry.apply_migrations(
            model_path=model_dir, from_version="0.1.0", to_version=latest, dry_run=False
        )

        # Check that migration was applied
        assert result["target_version"] == latest

        # Verify file was updated to kebab-case
        new_content = service_file.read_text()
        assert "supports-goals" in new_content
        assert "supportsGoals" not in new_content

    # Documentation integration tests (2 tests)

    def test_analyze_and_get_statistics(self, registry_file, valid_model_data):
        """Test getting statistics from analyzed model."""
        registry = LinkRegistry(registry_file)
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(valid_model_data)

        stats = analyzer.get_statistics()

        assert stats["total_links"] > 0
        assert stats["total_elements"] > 0
        assert "links_by_type" in stats or "by_type" in stats

    def test_find_path_between_elements(self, registry_file, valid_model_data):
        """Test path finding between connected elements."""
        registry = LinkRegistry(registry_file)
        analyzer = LinkAnalyzer(registry)
        analyzer.analyze_model(valid_model_data)

        # Try to find path from service to goal
        path = analyzer.find_path("service-1", "550e8400-e29b-41d4-a716-446655440000")

        # Should find a direct connection
        assert path is not None
        assert path.source_id == "service-1"
        assert path.target_id == "550e8400-e29b-41d4-a716-446655440000"
        assert len(path.hops) > 0
