"""Schema merger for preserving manual validation rules.

Merges generated schemas with existing schemas to preserve hand-crafted
validation rules while updating structure and descriptions from markdown.
"""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List


class SchemaMerger:
    """Merges generated schemas with existing schemas."""

    # Schema keys that should be preserved from existing schema
    PRESERVE_KEYS = {
        "pattern",  # Regex patterns
        "minLength",  # Min string length (if > 1)
        "maxLength",  # Max string length
        "minimum",  # Min numeric value
        "maximum",  # Max numeric value
        "minItems",  # Min array items
        "maxItems",  # Max array items
        "uniqueItems",  # Array uniqueness
        "additionalProperties",  # Object additional properties
        "examples",  # Hand-crafted examples
    }

    def __init__(self):
        """Initialize the schema merger."""
        self.warnings: List[str] = []

    def merge(
        self, generated_schema: Dict[str, Any], existing_schema: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Merge generated schema with existing schema.

        Strategy:
        - Use generated structure as base
        - Preserve manual validation rules from existing
        - Update descriptions from generated (markdown is source of truth)
        - Warn on conflicts

        Args:
            generated_schema: Newly generated schema
            existing_schema: Existing schema with manual rules

        Returns:
            Merged schema
        """
        self.warnings = []

        # Start with generated schema as base
        merged = deepcopy(generated_schema)

        # Merge top-level metadata (prefer generated)
        self._merge_metadata(merged, existing_schema)

        # Merge definitions
        if "definitions" in existing_schema:
            self._merge_definitions(
                merged.get("definitions", {}), existing_schema.get("definitions", {})
            )

        # Merge top-level properties
        if "properties" in existing_schema:
            self._merge_properties(
                merged.get("properties", {}), existing_schema.get("properties", {})
            )

        return merged

    def _merge_metadata(self, merged: Dict[str, Any], existing: Dict[str, Any]):
        """Merge top-level metadata.

        Args:
            merged: Merged schema (modified in place)
            existing: Existing schema
        """
        # Preserve $id if it exists in existing (might have real URL)
        if "$id" in existing and existing["$id"] != merged.get("$id"):
            merged["$id"] = existing["$id"]

        # Prefer generated title and description (from markdown)
        # but preserve if generated is empty
        if not merged.get("title") and existing.get("title"):
            merged["title"] = existing["title"]
        if not merged.get("description") and existing.get("description"):
            merged["description"] = existing["description"]

    def _merge_definitions(self, merged_defs: Dict[str, Any], existing_defs: Dict[str, Any]):
        """Merge entity definitions.

        Args:
            merged_defs: Merged definitions (modified in place)
            existing_defs: Existing definitions
        """
        # For each definition in existing
        for def_name, existing_def in existing_defs.items():
            if def_name not in merged_defs:
                # Definition exists in existing but not in generated
                # Could be manually added or entity removed from markdown
                self.warnings.append(
                    f"Definition '{def_name}' exists in existing schema but not in generated. "
                    "Preserving for now, but consider if it should be removed."
                )
                merged_defs[def_name] = existing_def
            else:
                # Merge the definitions
                self._merge_object_schema(merged_defs[def_name], existing_def, def_name)

    def _merge_properties(self, merged_props: Dict[str, Any], existing_props: Dict[str, Any]):
        """Merge property definitions.

        Args:
            merged_props: Merged properties (modified in place)
            existing_props: Existing properties
        """
        for prop_name, existing_prop in existing_props.items():
            if prop_name not in merged_props:
                # Property exists in existing but not in generated
                self.warnings.append(
                    f"Property '{prop_name}' exists in existing schema but not in generated. "
                    "Preserving for now."
                )
                merged_props[prop_name] = existing_prop
            else:
                # Merge the property schemas
                self._merge_object_schema(
                    merged_props[prop_name], existing_prop, f"property '{prop_name}'"
                )

    def _merge_object_schema(
        self, merged: Dict[str, Any], existing: Dict[str, Any], context: str = ""
    ):
        """Merge two object schemas.

        Args:
            merged: Merged schema (modified in place)
            existing: Existing schema
            context: Context for warnings
        """
        # Preserve validation rules
        for key in self.PRESERVE_KEYS:
            if key in existing:
                # Check for conflicts
                if key in merged and merged[key] != existing[key]:
                    # Special case: minLength=1 is generated default, prefer existing
                    if key == "minLength" and merged[key] == 1:
                        merged[key] = existing[key]
                    else:
                        self.warnings.append(
                            f"{context}: '{key}' differs (generated={merged[key]}, "
                            f"existing={existing[key]}). Using existing."
                        )
                        merged[key] = existing[key]
                else:
                    # No conflict, preserve existing
                    merged[key] = existing[key]

        # Merge nested properties recursively
        if "properties" in existing and "properties" in merged:
            for prop_name, existing_prop in existing["properties"].items():
                if prop_name not in merged["properties"]:
                    # Property in existing but not generated
                    self.warnings.append(
                        f"{context}.{prop_name}: exists in existing but not generated. Preserving."
                    )
                    merged["properties"][prop_name] = existing_prop
                elif isinstance(existing_prop, dict) and isinstance(
                    merged["properties"][prop_name], dict
                ):
                    # Recursively merge
                    self._merge_object_schema(
                        merged["properties"][prop_name],
                        existing_prop,
                        f"{context}.{prop_name}" if context else prop_name,
                    )

        # Merge required arrays
        if "required" in existing:
            existing_required = set(existing["required"])
            merged_required = set(merged.get("required", []))

            # Warn about differences
            removed = existing_required - merged_required
            if removed:
                self.warnings.append(
                    f"{context}: Fields {removed} were required in existing but not in generated. "
                    "Using generated (markdown is source of truth)."
                )

            # Use generated required (markdown is source of truth)
            # but could optionally preserve: merged["required"] = list(existing_required | merged_required)

        # Merge definitions recursively
        if "definitions" in existing and "definitions" in merged:
            for def_name, existing_def in existing["definitions"].items():
                if def_name not in merged["definitions"]:
                    merged["definitions"][def_name] = existing_def
                elif isinstance(existing_def, dict) and isinstance(
                    merged["definitions"][def_name], dict
                ):
                    self._merge_object_schema(
                        merged["definitions"][def_name],
                        existing_def,
                        (
                            f"{context}/definitions/{def_name}"
                            if context
                            else f"definition '{def_name}'"
                        ),
                    )

    def get_warnings(self) -> List[str]:
        """Get merge warnings.

        Returns:
            List of warning messages
        """
        return self.warnings


def load_schema(schema_path: Path) -> Dict[str, Any]:
    """Load JSON schema from file.

    Args:
        schema_path: Path to JSON schema file

    Returns:
        Parsed schema dict
    """
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_schema(schema: Dict[str, Any], schema_path: Path, indent: int = 2):
    """Save JSON schema to file.

    Args:
        schema: Schema dict to save
        schema_path: Output path
        indent: JSON indentation (default 2)
    """
    with open(schema_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=indent, ensure_ascii=False)
        f.write("\n")  # Add trailing newline
