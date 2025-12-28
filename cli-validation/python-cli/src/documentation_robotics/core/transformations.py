"""Transformation primitives for model migrations.

This module provides declarative transformation classes that can be composed
to create maintainable, testable migrations.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


class MigrationError(Exception):
    """Raised when a migration fails.

    Attributes:
        message: Error message
        file_path: Path to file where error occurred
        element_id: ID of element where error occurred
        transformation: Transformation that failed
    """

    def __init__(
        self,
        message: str,
        file_path: Optional[Path] = None,
        element_id: Optional[str] = None,
        transformation: Optional["Transformation"] = None,
    ):
        self.file_path = file_path
        self.element_id = element_id
        self.transformation = transformation
        super().__init__(message)

    def __str__(self):
        parts = [super().__str__()]
        if self.file_path:
            parts.append(f"File: {self.file_path}")
        if self.element_id:
            parts.append(f"Element: {self.element_id}")
        if self.transformation:
            parts.append(f"Transformation: {self.transformation}")
        return "\n".join(parts)


class Transformation(ABC):
    """Base class for declarative transformations.

    Each transformation represents a single, testable change to model data.
    """

    @abstractmethod
    def apply(self, element: Dict[str, Any]) -> bool:
        """Apply the transformation to an element.

        Args:
            element: Element data dictionary

        Returns:
            True if element was modified, False if no change needed

        Raises:
            MigrationError: If transformation fails
        """
        pass

    @abstractmethod
    def describe(self) -> str:
        """Return human-readable description of this transformation."""
        pass

    def matches_element(self, element: Dict[str, Any], layer_id: Optional[str] = None) -> bool:
        """Check if this transformation applies to the element.

        Args:
            element: Element data dictionary
            layer_id: Layer identifier (e.g., "02-business")

        Returns:
            True if transformation should be applied to this element
        """
        # Default: apply to all elements
        return True


@dataclass
class RenameField(Transformation):
    """Rename a field in matching elements.

    Example:
        RenameField("motivation.supportGoals", "motivation.supports-goals")
    """

    old_path: str
    new_path: str
    layers: Optional[List[str]] = None  # If None, apply to all layers

    def apply(self, element: Dict[str, Any]) -> bool:
        """Rename field from old_path to new_path."""
        value = self._get_field(element, self.old_path)
        if value is None:
            return False

        # Remove old field
        if not self._remove_field(element, self.old_path):
            return False

        # Set new field
        self._set_field(element, self.new_path, value)
        return True

    def matches_element(self, element: Dict[str, Any], layer_id: Optional[str] = None) -> bool:
        """Check if element has the old field and matches layer filter."""
        if self.layers and layer_id not in self.layers:
            return False
        return self._get_field(element, self.old_path) is not None

    def describe(self) -> str:
        layers_str = f" in layers {self.layers}" if self.layers else ""
        return f"Rename field '{self.old_path}' → '{self.new_path}'{layers_str}"

    def _get_field(self, data: Dict[str, Any], field_path: str) -> Optional[Any]:
        """Get value from nested field path."""
        parts = field_path.split(".")
        current = data

        for part in parts:
            if not isinstance(current, dict):
                return None
            current = current.get(part)
            if current is None:
                return None

        return current

    def _set_field(self, data: Dict[str, Any], field_path: str, value: Any) -> bool:
        """Set value in nested field path."""
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
        """Remove field from nested structure."""
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


@dataclass
class ChangeCardinality(Transformation):
    """Convert field between single value and array.

    Example:
        ChangeCardinality("business.realizes-service", to_type="array")
    """

    field_path: str
    to_type: str  # "single" or "array"
    layers: Optional[List[str]] = None

    def __post_init__(self):
        if self.to_type not in ("single", "array"):
            raise ValueError(f"to_type must be 'single' or 'array', got {self.to_type}")

    def apply(self, element: Dict[str, Any]) -> bool:
        """Change cardinality of field."""
        value = RenameField._get_field(self, element, self.field_path)
        if value is None:
            return False

        modified = False

        if self.to_type == "array" and not isinstance(value, list):
            RenameField._set_field(self, element, self.field_path, [value])
            modified = True
        elif self.to_type == "single" and isinstance(value, list):
            if len(value) == 0:
                # Remove empty arrays
                RenameField._remove_field(self, element, self.field_path)
            else:
                # Take first value
                RenameField._set_field(self, element, self.field_path, value[0])
            modified = True

        return modified

    def matches_element(self, element: Dict[str, Any], layer_id: Optional[str] = None) -> bool:
        """Check if element has the field and matches layer filter."""
        if self.layers and layer_id not in self.layers:
            return False
        return RenameField._get_field(self, element, self.field_path) is not None

    def describe(self) -> str:
        layers_str = f" in layers {self.layers}" if self.layers else ""
        return f"Change '{self.field_path}' to {self.to_type}{layers_str}"


@dataclass
class AddField(Transformation):
    """Add a field with default value to matching elements.

    Example:
        AddField("testing.coverage-required", default_value=True, layers=["12-testing"])
    """

    field_path: str
    default_value: Any
    layers: Optional[List[str]] = None
    only_if_missing: bool = True  # Don't overwrite existing values

    def apply(self, element: Dict[str, Any]) -> bool:
        """Add field with default value."""
        if self.only_if_missing:
            existing = RenameField._get_field(self, element, self.field_path)
            if existing is not None:
                return False

        RenameField._set_field(self, element, self.field_path, self.default_value)
        return True

    def matches_element(self, element: Dict[str, Any], layer_id: Optional[str] = None) -> bool:
        """Check if element matches layer filter."""
        if self.layers and layer_id not in self.layers:
            return False
        return True

    def describe(self) -> str:
        layers_str = f" in layers {self.layers}" if self.layers else ""
        return f"Add field '{self.field_path}' = {self.default_value}{layers_str}"


@dataclass
class RemoveField(Transformation):
    """Remove a field from matching elements.

    Example:
        RemoveField("deprecated.old-field", layers=["02-business"])
    """

    field_path: str
    layers: Optional[List[str]] = None

    def apply(self, element: Dict[str, Any]) -> bool:
        """Remove field if it exists."""
        return RenameField._remove_field(self, element, self.field_path)

    def matches_element(self, element: Dict[str, Any], layer_id: Optional[str] = None) -> bool:
        """Check if element has the field and matches layer filter."""
        if self.layers and layer_id not in self.layers:
            return False
        return RenameField._get_field(self, element, self.field_path) is not None

    def describe(self) -> str:
        layers_str = f" in layers {self.layers}" if self.layers else ""
        return f"Remove field '{self.field_path}'{layers_str}"


@dataclass
class TransformValue(Transformation):
    """Apply a custom transformation function to a field value.

    Example:
        TransformValue("name", lambda v: v.strip().title())
    """

    field_path: str
    transform_fn: callable
    layers: Optional[List[str]] = None

    def apply(self, element: Dict[str, Any]) -> bool:
        """Transform field value using provided function."""
        value = RenameField._get_field(self, element, self.field_path)
        if value is None:
            return False

        try:
            new_value = self.transform_fn(value)
            RenameField._set_field(self, element, self.field_path, new_value)
            return True
        except Exception as e:
            raise MigrationError(
                f"Failed to transform field '{self.field_path}': {e}", transformation=self
            )

    def matches_element(self, element: Dict[str, Any], layer_id: Optional[str] = None) -> bool:
        """Check if element has the field and matches layer filter."""
        if self.layers and layer_id not in self.layers:
            return False
        return RenameField._get_field(self, element, self.field_path) is not None

    def describe(self) -> str:
        layers_str = f" in layers {self.layers}" if self.layers else ""
        fn_name = getattr(self.transform_fn, "__name__", "custom function")
        return f"Transform '{self.field_path}' using {fn_name}{layers_str}"


class TransformationEngine:
    """Engine for applying transformations to model files.

    This class coordinates the application of transformations across
    all files in a model, with optional validation.
    """

    def __init__(self, model_path: Path):
        """Initialize the transformation engine.

        Args:
            model_path: Root path of the model directory
        """
        self.model_path = model_path
        self.stats = {
            "files_scanned": 0,
            "files_modified": 0,
            "elements_modified": 0,
            "transformations_applied": 0,
        }

    def apply(
        self, transformations: List[Transformation], validate: bool = True, dry_run: bool = False
    ) -> Dict[str, Any]:
        """Apply transformations to all model files.

        Args:
            transformations: List of transformations to apply
            validate: If True, validate model before and after
            dry_run: If True, don't actually modify files

        Returns:
            Dictionary with transformation statistics

        Raises:
            MigrationError: If validation fails or transformation fails
        """
        import yaml

        self.stats = {
            "files_scanned": 0,
            "files_modified": 0,
            "elements_modified": 0,
            "transformations_applied": 0,
        }

        # Scan all layer directories
        for layer_dir in self.model_path.glob("*_*/"):
            if not layer_dir.is_dir():
                continue

            layer_id = self._extract_layer_id(layer_dir.name)
            if not layer_id:
                continue

            # Process YAML files in this layer
            for yaml_file in layer_dir.glob("*.yaml"):
                self.stats["files_scanned"] += 1

                try:
                    # Load file
                    with open(yaml_file, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)

                    if not isinstance(data, list):
                        continue

                    # Apply transformations to each element
                    file_modified = False
                    for element in data:
                        if not isinstance(element, dict):
                            continue

                        element_id = element.get("id", "unknown")
                        element_modified = False

                        for transformation in transformations:
                            # Check if transformation applies to this element
                            if not transformation.matches_element(element, layer_id):
                                continue

                            try:
                                if transformation.apply(element):
                                    self.stats["transformations_applied"] += 1
                                    element_modified = True
                            except MigrationError as e:
                                # Add context and re-raise
                                e.file_path = yaml_file
                                e.element_id = element_id
                                raise

                        if element_modified:
                            self.stats["elements_modified"] += 1
                            file_modified = True

                    # Write back to file if modified
                    if file_modified and not dry_run:
                        with open(yaml_file, "w", encoding="utf-8") as f:
                            yaml.dump(data, f, default_flow_style=False, sort_keys=False)
                        self.stats["files_modified"] += 1

                except MigrationError:
                    # Re-raise migration errors with context
                    raise
                except Exception as e:
                    raise MigrationError(
                        f"Failed to process file {yaml_file}: {e}", file_path=yaml_file
                    )

        return self.stats

    def _extract_layer_id(self, layer_name: str) -> Optional[str]:
        """Extract layer ID from directory name.

        Args:
            layer_name: Directory name like "01_motivation" or "06_api"

        Returns:
            Layer ID like "01-motivation" or "06-api"
        """
        import re

        match = re.match(r"(\d+)_(\w+)", layer_name)
        if match:
            return f"{match.group(1)}-{match.group(2)}"
        return None


@dataclass
class EnsureUUIDField(Transformation):
    """Ensure element has a valid UUID in id field.

    If id exists and is a valid UUID, keep it.
    If id exists but is not a UUID, generate deterministic UUID from it.
    If id doesn't exist, generate UUID from element data.
    """

    field_path: str = "id"

    def apply(self, element: Dict[str, Any]) -> bool:
        """Ensure element has UUID."""
        import uuid as uuid_module

        existing_id = element.get(self.field_path)

        # Check if already a valid UUID
        if existing_id:
            try:
                uuid_module.UUID(existing_id)
                return False  # Already valid, no change
            except ValueError:
                pass

        # Generate deterministic UUID
        if existing_id:
            seed = str(existing_id)
        else:
            entity_type = element.get("type", "entity")
            name = element.get("name", element.get("description", str(id(element))))
            seed = f"{entity_type}:{name}"

        new_uuid = str(uuid_module.uuid5(uuid_module.NAMESPACE_DNS, seed))
        element[self.field_path] = new_uuid
        return True

    def describe(self) -> str:
        return f"Ensure '{self.field_path}' is a valid UUID"


@dataclass
class EnsureNameField(Transformation):
    """Ensure element has a human-readable name field.

    If name exists, keep it.
    Otherwise, derive from id, description, or type.
    """

    field_path: str = "name"

    def apply(self, element: Dict[str, Any]) -> bool:
        """Ensure element has name."""
        import uuid as uuid_module

        # Already has name
        if element.get(self.field_path):
            return False

        # Derive from ID if human-readable
        existing_id = element.get("id")
        if existing_id:
            try:
                uuid_module.UUID(existing_id)
            except ValueError:
                # Not a UUID, use as name
                name = existing_id.replace("-", " ").replace("_", " ").title()
                element[self.field_path] = name
                return True

        # Use description
        description = element.get("description", "")
        if description:
            first_sentence = description.split(".")[0].strip()
            if first_sentence and len(first_sentence) <= 60:
                element[self.field_path] = first_sentence
                return True

        # Generate from type
        entity_type = element.get("type", "Entity")
        short_id = existing_id[:8] if existing_id else "unnamed"
        element[self.field_path] = f"{entity_type.replace('-', ' ').title()} {short_id}"
        return True

    def describe(self) -> str:
        return f"Ensure '{self.field_path}' exists and is human-readable"
