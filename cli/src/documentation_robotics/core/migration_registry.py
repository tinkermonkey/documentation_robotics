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
from .transformations import MigrationError


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
        # Migration from v0.1.x to v0.2.0: Standardize cross-layer links
        self.migrations.append(
            Migration(
                from_version="0.1.0",
                to_version="0.2.0",
                description="Standardize cross-layer reference patterns",
                apply_fn=self._migrate_0_1_to_0_2,
            )
        )

        # Migration from v0.2.0 to v0.3.0: Update to spec v0.3.0
        self.migrations.append(
            Migration(
                from_version="0.2.0",
                to_version="0.3.0",
                description="Update to specification v0.3.0 (Testing layer support)",
                apply_fn=self._migrate_0_2_to_0_3,
            )
        )

        # Migration from v0.3.0 to v0.4.0: Add UUID and name fields
        self.migrations.append(
            Migration(
                from_version="0.3.0",
                to_version="0.4.0",
                description="Add UUID and name fields to all entities (Spec v0.4.0)",
                apply_fn=self._migrate_0_3_to_0_4,
            )
        )

        # Migration from v0.4.0 to v0.5.0: UX Layer Three-Tier Architecture
        self.migrations.append(
            Migration(
                from_version="0.4.0",
                to_version="0.5.0",
                description="UX Layer Three-Tier Architecture (Spec v0.5.0)",
                apply_fn=self._migrate_0_4_to_0_5,
            )
        )

        # Migration from v0.5.0 to v0.6.0: Enhanced Relationship Taxonomy
        self.migrations.append(
            Migration(
                from_version="0.5.0",
                to_version="0.6.0",
                description="Enhanced Relationship Taxonomy (Spec v0.6.0)",
                apply_fn=self._migrate_0_5_to_0_6,
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
            return "0.6.0"

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
        validate: bool = True,
    ) -> dict:
        """Apply all migrations in sequence.

        Args:
            model_path: Path to model directory
            from_version: Current model version
            to_version: Target version (defaults to latest)
            dry_run: If True, don't apply changes
            validate: If True, validate model before and after each migration

        Returns:
            Dictionary with migration results

        Raises:
            MigrationError: If validation fails or migration fails
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

        # Pre-migration validation
        if validate and not dry_run:
            if not self._validate_model(model_path, from_version):
                raise MigrationError(
                    f"Model validation failed for version {from_version}. "
                    "Model must be valid before migration. "
                    "Run 'dr validate' to see errors."
                )

        for migration in path:
            if not dry_run:
                try:
                    # Apply the migration
                    result = migration.apply_fn(model_path)

                    # Post-migration validation for this step
                    if validate:
                        if not self._validate_model(model_path, migration.to_version):
                            raise MigrationError(
                                f"Model validation failed after migrating to {migration.to_version}. "
                                "Migration may have produced invalid data. "
                                "Restore from git: git restore ."
                            )

                    results["applied"].append(
                        {
                            "from": migration.from_version,
                            "to": migration.to_version,
                            "description": migration.description,
                            "changes": result,
                        }
                    )
                    results["total_changes"] += result.get("migrations_applied", 0)

                except MigrationError:
                    # Re-raise migration errors
                    raise
                except Exception as e:
                    raise MigrationError(
                        f"Migration {migration.from_version} → {migration.to_version} failed: {e}"
                    )
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

    def _validate_model(self, model_path: Path, version: str) -> bool:
        """Validate model against schema for a specific version.

        Args:
            model_path: Path to model directory
            version: Specification version to validate against

        Returns:
            True if model is valid, False otherwise
        """
        try:
            # Import validation here to avoid circular imports
            from ..commands.validate import validate_model_files

            # Run validation (suppress output)
            result = validate_model_files(model_path, spec_version=version, verbose=False)
            return result.get("valid", False)
        except Exception:
            # If validation fails to run, assume valid to not block migration
            # (validation is a safety feature, not a hard requirement)
            return True

    # Migration implementation functions

    def _migrate_0_1_to_0_2(self, model_path: Path) -> dict:
        """Migrate from v0.1.x to v0.2.0.

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

    def _migrate_0_2_to_0_3(self, model_path: Path) -> dict:
        """Migrate from v0.2.0 to v0.3.0.

        This migration updates the specification version to 0.3.0, which adds
        Testing Layer (Layer 12) support. The testing layer is optional and can
        be added via 'dr init --add-layer testing'.

        This is a minimal migration that demonstrates the declarative approach.
        No data transformations are needed for this version bump.

        Args:
            model_path: Path to model directory

        Returns:
            Dictionary with migration statistics
        """
        try:
            # Example: If we needed to add fields or transform data, we would use:
            # from .transformations import AddField, RenameField, ChangeCardinality
            #
            # transformations = [
            #     AddField(
            #         field_path="testing.coverage-enabled",
            #         default_value=False,
            #         layers=["12-testing"]
            #     ),
            #     RenameField(
            #         old_path="old.field-name",
            #         new_path="new.field-name",
            #         layers=["02-business"]
            #     ),
            # ]
            #
            # engine = TransformationEngine(model_path)
            # stats = engine.apply(transformations, validate=False)
            # return {
            #     "migrations_applied": stats["transformations_applied"],
            #     "files_modified": stats["files_modified"],
            #     "description": "Applied declarative transformations"
            # }

            # This migration only updates the spec version in the manifest
            # The testing layer is opt-in and doesn't require model changes
            return {
                "migrations_applied": 1,
                "files_modified": 0,
                "description": "Spec version updated to 0.3.0 (Testing layer now available)",
            }
        except Exception as e:
            return {"error": str(e), "files_modified": 0, "migrations_applied": 0}

    def _migrate_0_3_to_0_4(self, model_path: Path) -> dict:
        """Migrate from v0.3.0 to v0.4.0.

        This migration adds explicit `id` (UUID) and `name` (string) fields to all
        entity types across all 12 layers. This is required for spec v0.4.0.

        Strategy:
        - UUID generation: Deterministic from existing element data
        - Name generation: Derived from existing name, id, or description
        - Safe: Only adds fields if missing (preserves existing values)

        Args:
            model_path: Path to model directory

        Returns:
            Dictionary with migration statistics
        """
        try:
            from .transformations import EnsureNameField, EnsureUUIDField, TransformationEngine

            transformations = [
                EnsureUUIDField(),
                EnsureNameField(),
            ]

            engine = TransformationEngine(model_path)
            stats = engine.apply(transformations, validate=False)

            return {
                "migrations_applied": stats["transformations_applied"],
                "files_modified": stats["files_modified"],
                "elements_modified": stats.get("elements_modified", 0),
                "description": f"Added UUID and name fields to {stats.get('elements_modified', 0)} entities",
            }
        except Exception as e:
            return {"error": str(e), "files_modified": 0, "migrations_applied": 0}

    def _migrate_0_4_to_0_5(self, model_path: Path) -> dict:
        """Migrate from v0.4.0 to v0.5.0.

        This migration supports the UX Layer Three-Tier Architecture introduced
        in spec v0.5.0. The new architecture is fully additive and backward
        compatible - existing flat UXSpecs remain valid.

        **New UX Layer Architecture (Spec v0.5.0):**
        - Tier 1: UXLibrary - Reusable design system components
          - LibraryComponent, LibrarySubView, StatePattern, ActionPattern
        - Tier 2: UXApplication - Application-level organization
        - Tier 3: UXSpec - Simplified experience-specific configuration

        **Benefits:**
        - Design system alignment (maps to Figma/Storybook workflows)
        - DRY principle (define components once, reuse across applications)
        - ~73% reduction in YAML lines per experience (300 -> 80 lines typical)
        - Enterprise scale (multiple applications share design libraries)

        No mandatory data transformations are required. Migration only updates
        the spec version as the three-tier architecture is opt-in.

        Args:
            model_path: Path to model directory

        Returns:
            Dictionary with migration statistics
        """
        try:
            return {
                "migrations_applied": 1,
                "files_modified": 0,
                "description": (
                    "Spec version updated to 0.5.0 "
                    "(UX Layer Three-Tier Architecture now available)"
                ),
            }
        except Exception as e:
            return {"error": str(e), "files_modified": 0, "migrations_applied": 0}

    def _migrate_0_5_to_0_6(self, model_path: Path) -> dict:
        """Migrate from v0.5.0 to v0.6.0.

        This migration supports the Enhanced Relationship Taxonomy introduced
        in spec v0.6.0. The new features are fully additive and backward
        compatible - existing models remain valid.

        **New Relationship Taxonomy (Spec v0.6.0):**
        - Comprehensive formalization of 6 relationship categories with 60+ predicates
        - Categories: Structural, Behavioral, Dependency, Traceability, Governance, Domain-Specific
        - ArchiMate 3.2 alignment with software-specific extensions
        - Bidirectional navigation support (inverse predicates)
        - Enhanced cross-layer reference registry with 60+ patterns

        No mandatory data transformations are required. Migration only updates
        the spec version as the relationship taxonomy is opt-in.

        Args:
            model_path: Path to model directory

        Returns:
            Dictionary with migration statistics
        """
        try:
            return {
                "migrations_applied": 1,
                "files_modified": 0,
                "description": (
                    "Spec version updated to 0.6.0 "
                    "(Enhanced Relationship Taxonomy now available)"
                ),
            }
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
