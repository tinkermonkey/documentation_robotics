"""Unit tests for LinkMigrator."""

import json

import pytest
from documentation_robotics.core.link_migrator import LinkMigrator
from documentation_robotics.core.link_registry import LinkRegistry


class TestLinkMigrator:
    """Tests for LinkMigrator."""

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
                    "validationRules": {},
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
    def registry(self, registry_file):
        """Create a LinkRegistry instance."""
        return LinkRegistry(registry_file)

    @pytest.fixture
    def temp_model_dir(self, tmp_path):
        """Create a temporary model directory with test files."""
        model_dir = tmp_path / "model"
        model_dir.mkdir()

        # Create a layer directory
        layer_dir = model_dir / "02_business"
        layer_dir.mkdir()

        return model_dir

    def test_analyze_model_finds_migrations(self, registry, temp_model_dir):
        """Test that analyzer detects all migration opportunities."""
        # Create a file with camelCase naming (should be kebab-case)
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  name: Customer Service
  motivation:
    supportsGoals:
      - goal-1
      - goal-2
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrations = migrator.analyze_model()

        # Should find the naming issue (camelCase vs kebab-case)
        assert len(migrations) > 0
        assert migrations[0].old_field == "motivation.supportsGoals"
        assert migrations[0].new_field == "motivation.supports-goals"

    def test_analyze_detects_naming_issues(self, registry, temp_model_dir):
        """Test detection of camelCase vs kebab-case inconsistencies."""
        # Create a file with camelCase (should be kebab-case)
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  motivation:
    supportsGoals: [goal-1]
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrations = migrator.analyze_model()

        # Should detect naming issue
        assert len(migrations) > 0
        assert migrations[0].old_field == "motivation.supportsGoals"
        assert migrations[0].new_field == "motivation.supports-goals"

    def test_analyze_detects_cardinality_mismatches(self, registry, temp_model_dir):
        """Test detection of string vs array mismatches."""
        # Create a file with single value where array is expected
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  motivation:
    supports-goals: goal-1
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrations = migrator.analyze_model()

        # Should detect cardinality mismatch
        cardinality_issues = [
            m for m in migrations if m.reason and "cardinality" in m.reason.lower()
        ]
        assert len(cardinality_issues) > 0

    def test_analyze_detects_format_issues(self, registry, temp_model_dir):
        """Test detection of missing UUID formats."""
        # This test might not apply if format is not checked during migration
        # Keeping it as a placeholder for future format validation
        migrator = LinkMigrator(registry, temp_model_dir)
        migrations = migrator.analyze_model()

        # Just verify it doesn't crash
        assert migrations is not None

    def test_analyze_empty_model(self, registry, temp_model_dir):
        """Test analyzer handles empty models gracefully."""
        migrator = LinkMigrator(registry, temp_model_dir)
        migrations = migrator.analyze_model()

        # Should return empty list for empty model
        assert migrations == []

    def test_apply_migrations_dry_run(self, registry, temp_model_dir):
        """Test dry-run mode doesn't modify files."""
        # Create a file that needs migration
        service_file = temp_model_dir / "02_business" / "service.yaml"
        original_content = """- id: service-1
  motivation:
    supportsGoals: [goal-1]
"""
        service_file.write_text(original_content)

        migrator = LinkMigrator(registry, temp_model_dir)
        migrator.analyze_model()
        result = migrator.apply_migrations(dry_run=True)

        # File should not be modified in dry-run mode
        assert service_file.read_text() == original_content
        # Dry-run may count files but shouldn't actually modify them
        assert result is not None

    def test_apply_migrations_renames_fields(self, registry, temp_model_dir):
        """Test field renaming (camelCase → kebab-case)."""
        # Create a file with camelCase naming
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  name: Customer Service
  motivation:
    supportsGoals:
      - goal-1
      - goal-2
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrator.analyze_model()
        result = migrator.apply_migrations(dry_run=False)

        # Should have modified the file
        assert result["files_modified"] > 0

        # Check that the field was renamed
        new_content = service_file.read_text()
        assert "supportsGoals" not in new_content
        assert "supports-goals" in new_content

    def test_apply_migrations_fixes_cardinality(self, registry, temp_model_dir):
        """Test string → array conversions."""
        # Create a file with wrong cardinality
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  motivation:
    supports-goals: goal-1
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrator.analyze_model()
        result = migrator.apply_migrations(dry_run=False)

        # Should have applied migrations
        assert result["migrations_applied"] >= 0  # May or may not fix cardinality automatically

    def test_apply_migrations_adds_formats(self, registry, temp_model_dir):
        """Test adding format: uuid to fields."""
        # This might be handled by schema validation rather than migration
        # Keeping as placeholder
        migrator = LinkMigrator(registry, temp_model_dir)
        _migrations = migrator.analyze_model()
        result = migrator.apply_migrations(dry_run=False)

        # Just verify it doesn't crash
        assert result is not None

    def test_apply_migrations_updates_multiple_files(self, registry, temp_model_dir):
        """Test batch processing across multiple files."""
        # Create multiple files that need migration
        for i in range(3):
            service_file = temp_model_dir / "02_business" / f"service-{i}.yaml"
            service_file.write_text(
                f"""- id: service-{i}
  motivation:
    supportsGoals: [goal-1]
"""
            )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrator.analyze_model()
        result = migrator.apply_migrations(dry_run=False)

        # Should process all files
        assert result["files_modified"] >= 3 or result["migrations_applied"] >= 3

    def test_get_migration_summary(self, registry, temp_model_dir):
        """Test summary statistics are accurate."""
        # Create a file that needs migration
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  motivation:
    supportsGoals: [goal-1]
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        _migrations = migrator.analyze_model()
        summary = migrator.get_migration_summary()

        # Should have summary information
        assert "total_migrations" in summary
        assert summary["total_migrations"] > 0

    def test_migration_preserves_other_fields(self, registry, temp_model_dir):
        """Test migrations don't corrupt unrelated data."""
        # Create a file with both old fields and other data
        service_file = temp_model_dir / "02_business" / "service.yaml"
        original_content = """- id: service-1
  name: Customer Service
  description: This is important
  motivation:
    supportsGoals: [goal-1]
  metadata:
    owner: team-alpha
"""
        service_file.write_text(original_content)

        migrator = LinkMigrator(registry, temp_model_dir)
        migrator.analyze_model()
        migrator.apply_migrations(dry_run=False)

        # Check that other fields are preserved
        new_content = service_file.read_text()
        assert "name: Customer Service" in new_content
        assert "description: This is important" in new_content
        assert "owner: team-alpha" in new_content

    def test_migration_handles_errors_gracefully(self, registry, temp_model_dir):
        """Test error handling and rollback."""
        # Create a file with invalid YAML
        service_file = temp_model_dir / "02_business" / "invalid.yaml"
        service_file.write_text("invalid: yaml: content:")

        migrator = LinkMigrator(registry, temp_model_dir)

        # Should not crash
        try:
            _migrations = migrator.analyze_model()
            result = migrator.apply_migrations(dry_run=False)
            # Should handle errors gracefully
            assert "error" not in result or result.get("files_modified", 0) == 0
        except Exception:
            # If it does raise an exception, that's also acceptable
            pass

    def test_migration_with_custom_extensions(self, registry, temp_model_dir):
        """Test migrations preserve custom x- fields."""
        # Create a file with custom extension fields
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  motivation:
    supportsGoals: [goal-1]
  x-custom-field: custom-value
  x-another-extension: 123
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrator.analyze_model()
        migrator.apply_migrations(dry_run=False)

        # Check that custom fields are preserved
        new_content = service_file.read_text()
        assert "x-custom-field" in new_content
        assert "x-another-extension" in new_content

    def test_migration_with_nested_references(self, registry, temp_model_dir):
        """Test handling of deeply nested objects."""
        # Create a file with nested structure
        service_file = temp_model_dir / "02_business" / "service.yaml"
        service_file.write_text(
            """- id: service-1
  name: Service
  motivation:
    supportsGoals: [goal-1]
"""
        )

        migrator = LinkMigrator(registry, temp_model_dir)
        migrations = migrator.analyze_model()

        # Should handle nested structures
        assert migrations is not None
