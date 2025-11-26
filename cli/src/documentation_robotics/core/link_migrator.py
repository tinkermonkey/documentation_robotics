"""Link Migrator - Migrates cross-layer references to standardized formats.

This module provides the LinkMigrator class which helps upgrade existing models
to use standardized cross-layer reference patterns from the link registry.
"""

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from .link_registry import LinkRegistry, LinkType


@dataclass
class LinkMigration:
    """Represents a single link migration."""

    file_path: Path
    element_id: str
    old_field: str
    new_field: str
    old_value: Any
    new_value: Any
    link_type: LinkType
    reason: str


class LinkMigrator:
    """Migrates cross-layer references to standardized formats.

    This class analyzes existing models, detects non-standard reference patterns,
    and provides migration suggestions or automatic migration to v3.0 standards.
    """

    def __init__(self, registry: LinkRegistry, model_root: Path):
        """Initialize the link migrator.

        Args:
            registry: LinkRegistry with standard link definitions
            model_root: Root path of the model directory
        """
        self.registry = registry
        self.model_root = model_root
        self.migrations: List[LinkMigration] = []

    def analyze_model(self) -> List[LinkMigration]:
        """Analyze the model and detect non-standard references.

        Returns:
            List of LinkMigration objects describing needed changes
        """
        self.migrations.clear()

        # Scan all layer directories
        for layer_dir in self.model_root.glob("*_*/"):
            if not layer_dir.is_dir():
                continue

            layer_name = layer_dir.name
            layer_id = self._extract_layer_id(layer_name)

            if not layer_id:
                continue

            # Scan YAML files in this layer
            for yaml_file in layer_dir.glob("*.yaml"):
                self._analyze_file(yaml_file, layer_id)

        return self.migrations

    def _extract_layer_id(self, layer_name: str) -> Optional[str]:
        """Extract layer ID from directory name.

        Args:
            layer_name: Directory name like "01_motivation" or "06_api"

        Returns:
            Layer ID like "01-motivation" or "06-api"
        """
        match = re.match(r"(\d+)_(\w+)", layer_name)
        if match:
            return f"{match.group(1)}-{match.group(2)}"
        return None

    def _analyze_file(self, file_path: Path, layer_id: str) -> None:
        """Analyze a single YAML file for non-standard references.

        Args:
            file_path: Path to YAML file
            layer_id: Layer identifier
        """
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)

            if not isinstance(data, list):
                return

            # Analyze each element
            for element in data:
                if not isinstance(element, dict):
                    continue

                element_id = element.get("id")
                if not element_id:
                    continue

                self._analyze_element(file_path, element_id, element, layer_id)

        except Exception:
            # Skip files that can't be parsed
            pass

    def _analyze_element(
        self, file_path: Path, element_id: str, element_data: Dict[str, Any], layer_id: str
    ) -> None:
        """Analyze a single element for non-standard references.

        Args:
            file_path: Path to YAML file
            element_id: Element identifier
            element_data: Element data dictionary
            layer_id: Layer identifier
        """
        # Get all possible link types for this layer
        possible_links = self.registry.get_link_types_by_source_layer(layer_id)

        for link_type in possible_links:
            # Check for non-standard field names
            self._check_naming_conventions(file_path, element_id, element_data, link_type)

            # Check for cardinality mismatches
            self._check_cardinality(file_path, element_id, element_data, link_type)

    def _check_naming_conventions(
        self, file_path: Path, element_id: str, element_data: Dict[str, Any], link_type: LinkType
    ) -> None:
        """Check for naming convention issues.

        Args:
            file_path: Path to YAML file
            element_id: Element identifier
            element_data: Element data dictionary
            link_type: Link type definition
        """
        # Look for common non-standard patterns
        for field_path in link_type.field_paths:
            standard_field = field_path

            # Check for camelCase instead of kebab-case in relationship names
            if "." in field_path:
                parts = field_path.split(".")
                parent = parts[0]
                field = parts[1]

                # Check if parent section exists
                if parent not in element_data:
                    continue

                parent_data = element_data[parent]
                if not isinstance(parent_data, dict):
                    continue

                # Look for camelCase variant
                camel_case = self._to_camel_case(field)
                if camel_case in parent_data and camel_case != field:
                    self.migrations.append(
                        LinkMigration(
                            file_path=file_path,
                            element_id=element_id,
                            old_field=f"{parent}.{camel_case}",
                            new_field=standard_field,
                            old_value=parent_data[camel_case],
                            new_value=parent_data[camel_case],
                            link_type=link_type,
                            reason=f"Non-standard naming: use kebab-case '{field}' instead of camelCase '{camel_case}'",
                        )
                    )

    def _check_cardinality(
        self, file_path: Path, element_id: str, element_data: Dict[str, Any], link_type: LinkType
    ) -> None:
        """Check for cardinality mismatches.

        Args:
            file_path: Path to YAML file
            element_id: Element identifier
            element_data: Element data dictionary
            link_type: Link type definition
        """
        for field_path in link_type.field_paths:
            value = self._get_field_value(element_data, field_path)
            if value is None:
                continue

            expected_array = link_type.cardinality == "array"
            is_array = isinstance(value, list)

            if expected_array and not is_array:
                self.migrations.append(
                    LinkMigration(
                        file_path=file_path,
                        element_id=element_id,
                        old_field=field_path,
                        new_field=field_path,
                        old_value=value,
                        new_value=[value],
                        link_type=link_type,
                        reason="Cardinality mismatch: expected array but got single value",
                    )
                )
            elif not expected_array and is_array:
                if len(value) == 1:
                    self.migrations.append(
                        LinkMigration(
                            file_path=file_path,
                            element_id=element_id,
                            old_field=field_path,
                            new_field=field_path,
                            old_value=value,
                            new_value=value[0],
                            link_type=link_type,
                            reason="Cardinality mismatch: expected single value but got array",
                        )
                    )

    def _get_field_value(self, data: Dict[str, Any], field_path: str) -> Optional[Any]:
        """Get value from nested field path.

        Args:
            data: Data dictionary
            field_path: Dot-notation field path

        Returns:
            Field value or None
        """
        parts = field_path.split(".")
        current = data

        for part in parts:
            if not isinstance(current, dict):
                return None
            current = current.get(part)
            if current is None:
                return None

        return current

    def _to_camel_case(self, kebab_case: str) -> str:
        """Convert kebab-case to camelCase.

        Args:
            kebab_case: String in kebab-case

        Returns:
            String in camelCase
        """
        parts = kebab_case.split("-")
        if not parts:
            return kebab_case
        return parts[0] + "".join(word.capitalize() for word in parts[1:])

    def apply_migrations(self, dry_run: bool = False) -> Dict[str, int]:
        """Apply discovered migrations to model files.

        Args:
            dry_run: If True, don't actually modify files

        Returns:
            Dictionary with statistics (files_modified, migrations_applied)
        """
        if not self.migrations:
            return {"files_modified": 0, "migrations_applied": 0}

        # Group migrations by file
        migrations_by_file = defaultdict(list)
        for migration in self.migrations:
            migrations_by_file[migration.file_path].append(migration)

        files_modified = 0
        migrations_applied = 0

        for file_path, file_migrations in migrations_by_file.items():
            if self._apply_file_migrations(file_path, file_migrations, dry_run):
                files_modified += 1
                migrations_applied += len(file_migrations)

        return {"files_modified": files_modified, "migrations_applied": migrations_applied}

    def _apply_file_migrations(
        self, file_path: Path, migrations: List[LinkMigration], dry_run: bool
    ) -> bool:
        """Apply migrations to a single file.

        Args:
            file_path: Path to file
            migrations: List of migrations for this file
            dry_run: If True, don't actually modify the file

        Returns:
            True if file was modified, False otherwise
        """
        if dry_run:
            return True

        try:
            # Load file
            with open(file_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)

            if not isinstance(data, list):
                return False

            # Apply migrations
            modified = False
            for migration in migrations:
                for element in data:
                    if not isinstance(element, dict):
                        continue

                    if element.get("id") != migration.element_id:
                        continue

                    # Apply the migration
                    if self._apply_element_migration(element, migration):
                        modified = True

            if not modified:
                return False

            # Write back to file
            with open(file_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, sort_keys=False)

            return True

        except Exception:
            return False

    def _apply_element_migration(self, element: Dict[str, Any], migration: LinkMigration) -> bool:
        """Apply a migration to a single element.

        Args:
            element: Element data dictionary
            migration: Migration to apply

        Returns:
            True if element was modified, False otherwise
        """
        old_parts = migration.old_field.split(".")
        new_parts = migration.new_field.split(".")

        # Handle simple case: same field structure, just value change
        if old_parts == new_parts:
            return self._set_field_value(element, migration.new_field, migration.new_value)

        # Handle field rename
        if self._remove_field(element, migration.old_field):
            self._set_field_value(element, migration.new_field, migration.new_value)
            return True

        return False

    def _set_field_value(self, data: Dict[str, Any], field_path: str, value: Any) -> bool:
        """Set value in nested field path.

        Args:
            data: Data dictionary
            field_path: Dot-notation field path
            value: Value to set

        Returns:
            True if successful, False otherwise
        """
        parts = field_path.split(".")
        current = data

        for i, part in enumerate(parts[:-1]):
            if part not in current:
                current[part] = {}
            current = current[part]
            if not isinstance(current, dict):
                return False

        current[parts[-1]] = value
        return True

    def _remove_field(self, data: Dict[str, Any], field_path: str) -> bool:
        """Remove field from nested structure.

        Args:
            data: Data dictionary
            field_path: Dot-notation field path

        Returns:
            True if field was removed, False if not found
        """
        parts = field_path.split(".")
        current = data

        for part in parts[:-1]:
            if not isinstance(current, dict) or part not in current:
                return False
            current = current[part]

        if isinstance(current, dict) and parts[-1] in current:
            del current[parts[-1]]
            return True

        return False

    def get_migration_summary(self) -> Dict[str, Any]:
        """Get summary of discovered migrations.

        Returns:
            Dictionary with migration statistics
        """
        by_reason = defaultdict(int)
        by_file = defaultdict(int)
        by_link_type = defaultdict(int)

        for migration in self.migrations:
            by_reason[migration.reason] += 1
            by_file[str(migration.file_path)] += 1
            by_link_type[migration.link_type.id] += 1

        return {
            "total_migrations": len(self.migrations),
            "affected_files": len(set(m.file_path for m in self.migrations)),
            "by_reason": dict(by_reason),
            "by_file": dict(by_file),
            "by_link_type": dict(by_link_type),
        }
