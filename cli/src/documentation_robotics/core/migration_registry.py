"""Migration Registry - Manages version-based model migrations.

This module provides a registry of all available migrations and handles
sequential migration from one version to another.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional

from packaging.version import Version

from .link_migrator import LinkMigrator
from .link_registry import LinkRegistry


@dataclass
class Migration:
    """Represents a single version migration."""

    from_version: str
    to_version: str
    description: str
    apply_fn: Callable[[Path], dict]  # Function that applies the migration


class MigrationRegistry:
    """Registry of all available model migrations.

    Manages sequential migrations from any version to the latest version.
    """

    def __init__(self):
        """Initialize the migration registry."""
        self.migrations: List[Migration] = []
        self._register_migrations()

    def _register_migrations(self):
        """Register all available migrations."""
        # Migration from v0.1.x to v1.0.0: Standardize cross-layer links
        self.migrations.append(
            Migration(
                from_version="0.1.0",
                to_version="1.0.0",
                description="Standardize cross-layer reference patterns",
                apply_fn=self._migrate_0_1_to_1_0,
            )
        )

        # Future migrations would be added here
        # self.migrations.append(Migration(
        #     from_version="1.0.0",
        #     to_version="1.1.0",
        #     description="Add new feature X",
        #     apply_fn=self._migrate_1_0_to_1_1
        # ))

    def get_latest_version(self) -> str:
        """Get the latest available specification version.

        Returns:
            Latest version string
        """
        if not self.migrations:
            return "0.1.1"

        versions = [Version(m.to_version) for m in self.migrations]
        return str(max(versions))

    def get_migration_path(
        self, from_version: str, to_version: Optional[str] = None
    ) -> List[Migration]:
        """Get the sequence of migrations needed.

        Args:
            from_version: Current model version
            to_version: Target version (defaults to latest)

        Returns:
            List of Migration objects in order
        """
        if to_version is None:
            to_version = self.get_latest_version()

        from_ver = Version(from_version)
        to_ver = Version(to_version)

        if from_ver >= to_ver:
            return []

        # Find migration path (simple linear path for now)
        path = []
        current = from_ver

        for migration in sorted(self.migrations, key=lambda m: Version(m.from_version)):
            mig_from = Version(migration.from_version)
            mig_to = Version(migration.to_version)

            # Check if this migration is in our path
            if current >= mig_from and current < mig_to and mig_to <= to_ver:
                path.append(migration)
                current = mig_to

        return path

    def requires_migration(self, current_version: str) -> bool:
        """Check if a model requires migration.

        Args:
            current_version: Current model version

        Returns:
            True if migration is available and needed
        """
        path = self.get_migration_path(current_version)
        return len(path) > 0

    def apply_migrations(
        self,
        model_path: Path,
        from_version: str,
        to_version: Optional[str] = None,
        dry_run: bool = False,
    ) -> dict:
        """Apply all migrations in sequence.

        Args:
            model_path: Path to model directory
            from_version: Current model version
            to_version: Target version (defaults to latest)
            dry_run: If True, don't apply changes

        Returns:
            Dictionary with migration results
        """
        path = self.get_migration_path(from_version, to_version)

        if not path:
            return {
                "applied": [],
                "current_version": from_version,
                "target_version": to_version or self.get_latest_version(),
                "total_changes": 0,
            }

        results = {
            "applied": [],
            "current_version": from_version,
            "target_version": path[-1].to_version,
            "total_changes": 0,
        }

        for migration in path:
            if not dry_run:
                # Apply the migration
                result = migration.apply_fn(model_path)
                results["applied"].append(
                    {
                        "from": migration.from_version,
                        "to": migration.to_version,
                        "description": migration.description,
                        "changes": result,
                    }
                )
                results["total_changes"] += result.get("migrations_applied", 0)
            else:
                # Dry run - just record what would happen
                results["applied"].append(
                    {
                        "from": migration.from_version,
                        "to": migration.to_version,
                        "description": migration.description,
                        "dry_run": True,
                    }
                )

        return results

    # Migration implementation functions

    def _migrate_0_1_to_1_0(self, model_path: Path) -> dict:
        """Migrate from v0.1.x to v1.0.0.

        This migration standardizes cross-layer reference patterns.

        Args:
            model_path: Path to model directory

        Returns:
            Dictionary with migration statistics
        """
        try:
            registry = LinkRegistry()
            migrator = LinkMigrator(registry, model_path)

            # Analyze and apply migrations
            migrator.analyze_model()
            result = migrator.apply_migrations(dry_run=False)

            return result
        except Exception as e:
            return {"error": str(e), "files_modified": 0, "migrations_applied": 0}

    def get_migration_summary(self, from_version: str, to_version: Optional[str] = None) -> dict:
        """Get summary of migrations that would be applied.

        Args:
            from_version: Current model version
            to_version: Target version (defaults to latest)

        Returns:
            Dictionary with migration summary
        """
        path = self.get_migration_path(from_version, to_version)

        return {
            "current_version": from_version,
            "target_version": to_version or self.get_latest_version(),
            "migrations_needed": len(path),
            "migrations": [
                {"from": m.from_version, "to": m.to_version, "description": m.description}
                for m in path
            ],
        }
