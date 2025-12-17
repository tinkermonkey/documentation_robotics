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

    # Error handling tests (6 tests)

    def test_apply_migrations_with_validation_error_before(
        self, registry, temp_model_dir, monkeypatch
    ):
        """Test handling of validation error before migration."""
        from documentation_robotics.core.transformations import MigrationError

        # Mock validate_model to return False
        def mock_validate_model(self, model_path, version):
            return False

        monkeypatch.setattr(
            "documentation_robotics.core.migration_registry.MigrationRegistry._validate_model",
            mock_validate_model,
        )

        latest = registry.get_latest_version()

        with pytest.raises(MigrationError) as exc_info:
            registry.apply_migrations(
                model_path=temp_model_dir,
                from_version="0.1.0",
                to_version=latest,
                dry_run=False,
                validate=True,
            )

        assert "validation failed" in str(exc_info.value).lower()
        assert "0.1.0" in str(exc_info.value)

    def test_apply_migrations_with_validation_error_after(
        self, registry, temp_model_dir, monkeypatch
    ):
        """Test handling of validation error after migration."""
        from documentation_robotics.core.transformations import MigrationError

        # Create model structure
        layer_dir = temp_model_dir / "02_business"
        layer_dir.mkdir()
        service_file = layer_dir / "service.yaml"
        service_file.write_text("- id: service-1\n  name: Service\n")

        # Mock validate_model to fail after migration
        call_count = {"count": 0}

        def mock_validate_model(self, model_path, version):
            call_count["count"] += 1
            # Pass pre-migration validation but fail post-migration
            return call_count["count"] == 1

        monkeypatch.setattr(
            "documentation_robotics.core.migration_registry.MigrationRegistry._validate_model",
            mock_validate_model,
        )

        latest = registry.get_latest_version()

        with pytest.raises(MigrationError) as exc_info:
            registry.apply_migrations(
                model_path=temp_model_dir,
                from_version="0.1.0",
                to_version=latest,
                dry_run=False,
                validate=True,
            )

        assert "validation failed" in str(exc_info.value).lower()

    def test_apply_migrations_handles_exception_in_migration_fn(
        self, registry, temp_model_dir, monkeypatch
    ):
        """Test handling of exception in migration function."""
        from documentation_robotics.core.transformations import MigrationError

        # Create model structure
        layer_dir = temp_model_dir / "02_business"
        layer_dir.mkdir()

        # Mock a migration function that raises an exception
        def mock_failing_migration(model_path):
            raise RuntimeError("Simulated migration failure")

        # Replace the migration function
        if registry.migrations:
            original_fn = registry.migrations[0].apply_fn
            registry.migrations[0].apply_fn = mock_failing_migration

        try:
            latest = registry.get_latest_version()

            with pytest.raises(MigrationError) as exc_info:
                registry.apply_migrations(
                    model_path=temp_model_dir,
                    from_version="0.1.0",
                    to_version=latest,
                    dry_run=False,
                    validate=False,
                )

            assert "failed" in str(exc_info.value).lower()
        finally:
            # Restore original function
            if registry.migrations:
                registry.migrations[0].apply_fn = original_fn

    def test_apply_migrations_with_no_path_needed(self, registry, temp_model_dir):
        """Test apply_migrations when already at target version."""
        latest = registry.get_latest_version()

        result = registry.apply_migrations(
            model_path=temp_model_dir,
            from_version=latest,
            to_version=latest,
            dry_run=False,
            validate=False,
        )

        assert result is not None
        assert result["applied"] == []
        assert result["current_version"] == latest
        assert result["target_version"] == latest
        assert result["total_changes"] == 0

    def test_migration_with_error_dict_result(self, registry, temp_model_dir, monkeypatch):
        """Test migration function that returns error dict."""

        # Create model structure
        layer_dir = temp_model_dir / "02_business"
        layer_dir.mkdir()

        # Mock migration function to return error dict
        def mock_migration_with_error(model_path):
            return {
                "error": "Simulated error in migration",
                "files_modified": 0,
                "migrations_applied": 0,
            }

        # Replace the migration function temporarily
        if registry.migrations:
            original_fn = registry.migrations[0].apply_fn
            registry.migrations[0].apply_fn = mock_migration_with_error

        try:
            latest = registry.get_latest_version()

            # This should not raise but return results with error
            result = registry.apply_migrations(
                model_path=temp_model_dir,
                from_version="0.1.0",
                to_version=latest,
                dry_run=False,
                validate=False,
            )

            # Check that result includes the applied migration with error
            assert result is not None
            assert len(result["applied"]) > 0

        finally:
            # Restore original function
            if registry.migrations:
                registry.migrations[0].apply_fn = original_fn

    # v0.3.0 → v0.4.0 Migration Tests

    def test_apply_migrations_0_3_to_0_4(self, registry, temp_model_dir):
        """Test v0.3.0 → v0.4.0 migration adds UUID and name fields."""
        layer_dir = temp_model_dir / "02_business"
        layer_dir.mkdir()

        yaml_file = layer_dir / "services.yaml"
        yaml_file.write_text(
            """- type: service
  description: Core business capability

- type: service
  id: customer-service
  description: Customer management
"""
        )

        result = registry.apply_migrations(
            temp_model_dir, "0.3.0", "0.4.0", dry_run=False, validate=False
        )

        assert result["total_changes"] > 0
        assert len(result["applied"]) == 1

        # Verify UUID and name added
        import yaml

        with open(yaml_file, "r") as f:
            data = yaml.safe_load(f)

        import uuid

        assert "id" in data[0]
        assert "name" in data[0]
        uuid.UUID(data[0]["id"])  # Validates UUID format

    def test_migration_0_3_to_0_4_preserves_existing_uuid(self, registry, temp_model_dir):
        """Test existing UUIDs are preserved."""
        layer_dir = temp_model_dir / "01_motivation"
        layer_dir.mkdir()

        existing_uuid = "550e8400-e29b-41d4-a716-446655440000"
        yaml_file = layer_dir / "goals.yaml"
        yaml_file.write_text(
            f"""- id: {existing_uuid}
  type: goal
  description: Business goal
"""
        )

        registry.apply_migrations(temp_model_dir, "0.3.0", "0.4.0", dry_run=False, validate=False)

        import yaml

        with open(yaml_file, "r") as f:
            data = yaml.safe_load(f)

        assert data[0]["id"] == existing_uuid
        assert "name" in data[0]

    def test_migration_0_3_to_0_4_deterministic_uuids(self, registry, temp_model_dir):
        """Test UUID generation is deterministic."""
        layer_dir = temp_model_dir / "02_business"
        layer_dir.mkdir()

        yaml_file = layer_dir / "services.yaml"
        original_content = """- type: service
  id: test-service
  description: Test
"""

        # Apply migration twice
        import yaml

        yaml_file.write_text(original_content)
        registry.apply_migrations(temp_model_dir, "0.3.0", "0.4.0", dry_run=False, validate=False)
        with open(yaml_file, "r") as f:
            first_uuid = yaml.safe_load(f)[0]["id"]

        yaml_file.write_text(original_content)
        registry.apply_migrations(temp_model_dir, "0.3.0", "0.4.0", dry_run=False, validate=False)
        with open(yaml_file, "r") as f:
            second_uuid = yaml.safe_load(f)[0]["id"]

        assert first_uuid == second_uuid  # Deterministic

    # v0.5.0 → v0.6.0 Migration Tests

    def test_migration_0_5_to_0_6_backward_compatible(self, registry, temp_model_dir):
        """Test v0.5.0 → v0.6.0 migration is backward compatible."""
        layer_dir = temp_model_dir / "01_motivation"
        layer_dir.mkdir()

        yaml_file = layer_dir / "goals.yaml"
        original_content = """- id: goal-1
  type: goal
  name: Example Goal
  description: Test goal
"""
        yaml_file.write_text(original_content)

        result = registry.apply_migrations(
            temp_model_dir, "0.5.0", "0.6.0", dry_run=False, validate=False
        )

        # Should succeed with migration applied (backward compatible)
        assert result["total_changes"] == 1
        assert len(result["applied"]) == 1
        assert result["applied"][0]["from"] == "0.5.0"
        assert result["applied"][0]["to"] == "0.6.0"
        assert "0.6.0" in result["applied"][0]["description"]

        # Content should be unchanged (backward compatible)
        assert yaml_file.read_text() == original_content

    def test_get_latest_version_returns_0_6_0(self, registry):
        """Test that latest version is now 0.6.0."""
        latest = registry.get_latest_version()
        assert latest == "0.6.0"

    def test_migration_path_0_5_to_0_6(self, registry):
        """Test migration path from 0.5.0 to 0.6.0."""
        path = registry.get_migration_path("0.5.0", "0.6.0")

        assert len(path) == 1
        assert path[0].from_version == "0.5.0"
        assert path[0].to_version == "0.6.0"
        assert "Enhanced Relationship Taxonomy" in path[0].description

    def test_requires_migration_0_5_to_0_6(self, registry):
        """Test that v0.5.0 models require migration."""
        requires = registry.requires_migration("0.5.0")
        assert requires is True

    def test_migration_summary_0_5_to_0_6(self, registry):
        """Test migration summary for 0.5.0 to 0.6.0."""
        summary = registry.get_migration_summary("0.5.0", "0.6.0")

        assert summary["current_version"] == "0.5.0"
        assert summary["target_version"] == "0.6.0"
        assert summary["migrations_needed"] == 1
        assert len(summary["migrations"]) == 1
        assert summary["migrations"][0]["from"] == "0.5.0"
        assert summary["migrations"][0]["to"] == "0.6.0"
        assert "Enhanced Relationship Taxonomy" in summary["migrations"][0]["description"]
