"""Unit tests for MigrationRegistry."""

import pytest
from documentation_robotics.core.migration_registry import MigrationRegistry


class TestMigrationRegistry:
    """Tests for MigrationRegistry."""

    @pytest.fixture
    def registry(self):
        """Create a MigrationRegistry instance."""
        return MigrationRegistry()

    @pytest.fixture
    def temp_model_dir(self, tmp_path):
        """Create a temporary model directory."""
        model_dir = tmp_path / "model"
        model_dir.mkdir()
        return model_dir

    # Registry tests (4 tests)

    def test_registry_loads_migrations(self, registry):
        """Test all migrations are registered."""
        # Registry should have at least one migration
        assert registry.migrations is not None
        assert len(registry.migrations) > 0

        # Check that the first migration starts from 0.1.0
        migration = registry.migrations[0]
        assert migration.from_version == "0.1.0"
        # The last migration should reach the latest version
        assert registry.migrations[-1].to_version == registry.get_latest_version()
        assert migration.description is not None
        assert migration.apply_fn is not None

    def test_get_latest_version(self, registry):
        """Test latest version detection."""
        latest = registry.get_latest_version()

        # Should return the highest version from migrations
        assert latest is not None
        assert isinstance(latest, str)
        # Should match the latest migration's to_version
        assert latest == registry.migrations[-1].to_version

    def test_get_migration_path_simple(self, registry):
        """Test path finding for migration chain."""
        # Migration from 0.1.0 to latest
        latest = registry.get_latest_version()
        path = registry.get_migration_path("0.1.0", latest)

        assert path is not None
        assert len(path) > 0
        assert path[0].from_version == "0.1.0"
        assert path[-1].to_version == latest

    def test_get_migration_path_multi_step(self, registry):
        """Test path finding across multiple versions."""
        # If we had migrations 0.1.0→1.0.0→1.1.0, this would test multi-step
        # For now, test that 0.1.0 to latest works
        path = registry.get_migration_path("0.1.0")

        assert path is not None
        assert len(path) > 0
        # First migration should start from 0.1.0
        assert path[0].from_version == "0.1.0"

    # Migration checking (3 tests)

    def test_requires_migration_true(self, registry):
        """Test detection when migration needed."""
        # 0.1.0 should require migration to get to latest
        requires = registry.requires_migration("0.1.0")

        assert requires is True

    def test_requires_migration_false(self, registry):
        """Test detection when already at latest."""
        latest = registry.get_latest_version()

        # Latest version shouldn't require migration
        requires = registry.requires_migration(latest)

        assert requires is False

    def test_requires_migration_future_version(self, registry):
        """Test behavior with future version."""
        # Version higher than latest shouldn't require migration
        requires = registry.requires_migration("99.0.0")

        assert requires is False

    # Application tests (3 tests)

    def test_apply_migrations_0_1_to_latest(self, registry, temp_model_dir):
        """Test v0.1.0 → latest migration."""
        # Create a simple model structure
        layer_dir = temp_model_dir / "02_business"
        layer_dir.mkdir()

        service_file = layer_dir / "service.yaml"
        service_file.write_text(
            """- id: service-1
  name: Service
  motivation:
    supportsGoals: [goal-1]
"""
        )

        latest = registry.get_latest_version()
        result = registry.apply_migrations(
            model_path=temp_model_dir, from_version="0.1.0", to_version=latest, dry_run=False
        )

        assert result is not None
        assert "applied" in result
        assert "target_version" in result
        assert result["target_version"] == latest

    def test_apply_migrations_dry_run(self, registry, temp_model_dir):
        """Test dry-run doesn't modify model."""
        # Create a simple model structure
        layer_dir = temp_model_dir / "02_business"
        layer_dir.mkdir()

        service_file = layer_dir / "service.yaml"
        original_content = """- id: service-1
  name: Service
"""
        service_file.write_text(original_content)

        latest = registry.get_latest_version()
        result = registry.apply_migrations(
            model_path=temp_model_dir, from_version="0.1.0", to_version=latest, dry_run=True
        )

        assert result is not None
        # File should not be modified in dry-run
        assert service_file.read_text() == original_content

        # Result should indicate dry-run
        if result.get("applied"):
            assert result["applied"][0].get("dry_run") is True

    def test_apply_migrations_returns_results(self, registry, temp_model_dir):
        """Test result dictionary structure."""
        latest = registry.get_latest_version()
        result = registry.apply_migrations(
            model_path=temp_model_dir, from_version="0.1.0", to_version=latest, dry_run=True
        )

        # Check result structure
        assert isinstance(result, dict)
        assert "applied" in result
        assert "current_version" in result
        assert "target_version" in result
        assert "total_changes" in result

        assert result["current_version"] == "0.1.0"
        assert result["target_version"] == latest

    # Summary tests (2 tests)

    def test_get_migration_summary(self, registry):
        """Test summary generation."""
        latest = registry.get_latest_version()
        summary = registry.get_migration_summary("0.1.0", latest)

        assert summary is not None
        assert isinstance(summary, dict)
        assert "current_version" in summary
        assert "target_version" in summary
        assert "migrations_needed" in summary
        assert "migrations" in summary

        assert summary["current_version"] == "0.1.0"
        assert summary["target_version"] == latest
        assert summary["migrations_needed"] > 0

        # Check migrations list
        migrations = summary["migrations"]
        assert isinstance(migrations, list)
        assert len(migrations) > 0
        assert migrations[0]["from"] == "0.1.0"
        assert migrations[-1]["to"] == latest

    def test_migration_summary_no_migrations_needed(self, registry):
        """Test summary when no migrations needed."""
        latest = registry.get_latest_version()
        summary = registry.get_migration_summary(latest, latest)

        assert summary is not None
        assert summary["migrations_needed"] == 0
        assert len(summary["migrations"]) == 0
