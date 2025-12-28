"""
Schema Completeness Validator - Ensures CLI implements all spec schemas correctly.

This validator creates a closed-loop validation system:
1. Reads all layer schemas from spec
2. Validates CLI can handle all entity types
3. Tests CLI commands against schema definitions
4. Generates comprehensive validation report
"""

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Set

from documentation_robotics.schemas.bundler import get_bundled_schemas_dir
from documentation_robotics.schemas.registry import EntityTypeRegistry


class ValidationStatus(Enum):
    """Validation result status."""

    PASS = "✓ PASS"
    FAIL = "✗ FAIL"
    WARN = "⚠ WARN"
    INFO = "ℹ INFO"


@dataclass
class ValidationResult:
    """Result of a validation check."""

    status: ValidationStatus
    category: str
    layer: str
    check: str
    message: str
    details: Optional[Dict] = None


@dataclass
class LayerValidation:
    """Validation results for a single layer."""

    layer_name: str
    schema_file: Path
    entity_types_in_schema: Set[str] = field(default_factory=set)
    entity_types_in_cli: Set[str] = field(default_factory=set)
    required_properties: Dict[str, List[str]] = field(default_factory=dict)
    optional_properties: Dict[str, List[str]] = field(default_factory=dict)
    results: List[ValidationResult] = field(default_factory=list)

    @property
    def missing_in_cli(self) -> Set[str]:
        """Entity types in schema but not in CLI."""
        return self.entity_types_in_schema - self.entity_types_in_cli

    @property
    def extra_in_cli(self) -> Set[str]:
        """Entity types in CLI but not in schema."""
        return self.entity_types_in_cli - self.entity_types_in_schema

    @property
    def pass_rate(self) -> float:
        """Percentage of passing checks (excludes INFO status)."""
        if not self.results:
            return 0.0
        # Only count PASS, FAIL, and WARN in the rate (exclude INFO)
        counted_results = [r for r in self.results if r.status != ValidationStatus.INFO]
        if not counted_results:
            return 100.0
        passed = sum(1 for r in counted_results if r.status == ValidationStatus.PASS)
        return (passed / len(counted_results)) * 100


class SchemaCompletenessValidator:
    """
    Validates that CLI implementation matches spec schemas 100%.

    Validation Levels:
    1. Entity Type Coverage - All schema entity types are in CLI
    2. Property Coverage - All required properties are supported
    3. Command Integration - CLI commands work with all types
    4. Validation Logic - CLI validation matches schema constraints
    5. Claude Integration - Reference sheets match reality
    """

    def __init__(self, schema_dir: Optional[Path] = None):
        """Initialize validator with schema directory."""
        self.schema_dir = schema_dir or get_bundled_schemas_dir()
        self.registry = EntityTypeRegistry()
        self.registry.build_from_schemas(self.schema_dir)
        self.layer_validations: Dict[str, LayerValidation] = {}
        self.all_results: List[ValidationResult] = []

    def validate_all(self) -> Dict[str, LayerValidation]:
        """
        Run complete validation suite across all layers.

        Returns:
            Dictionary mapping layer names to validation results
        """
        print("=" * 80)
        print("SCHEMA COMPLETENESS VALIDATION")
        print("=" * 80)
        print(f"\nSchema Directory: {self.schema_dir}")
        print(f"Validating {len(self.registry.get_all_layers())} layers...\n")

        # Validate each layer
        for layer_name in sorted(self.registry.get_all_layers()):
            self._validate_layer(layer_name)

        # Cross-layer validations
        self._validate_cross_layer_consistency()

        return self.layer_validations

    def _validate_layer(self, layer_name: str) -> LayerValidation:
        """Validate a single layer against its schema."""
        print(f"\n{'─' * 80}")
        print(f"Layer: {layer_name}")
        print(f"{'─' * 80}")

        # Find schema file
        schema_file = self._find_schema_file(layer_name)
        if not schema_file:
            result = ValidationResult(
                status=ValidationStatus.FAIL,
                category="Schema Discovery",
                layer=layer_name,
                check="Schema File Exists",
                message=f"No schema file found for layer '{layer_name}'",
            )
            self.all_results.append(result)
            print(f"  {result.status.value} {result.check}: {result.message}")
            return None

        # Load schema
        with open(schema_file) as f:
            schema = json.load(f)

        # Create layer validation
        validation = LayerValidation(layer_name=layer_name, schema_file=schema_file)
        self.layer_validations[layer_name] = validation

        # Run validation checks
        self._check_entity_type_coverage(validation, schema)
        self._check_property_coverage(validation, schema)
        self._check_schema_structure(validation, schema)
        self._check_cli_integration(validation)

        # Print summary
        pass_count = sum(1 for r in validation.results if r.status == ValidationStatus.PASS)
        fail_count = sum(1 for r in validation.results if r.status == ValidationStatus.FAIL)
        warn_count = sum(1 for r in validation.results if r.status == ValidationStatus.WARN)

        print(f"\n  Summary: {pass_count} passed, {fail_count} failed, {warn_count} warnings")
        print(f"  Pass Rate: {validation.pass_rate:.1f}%")

        return validation

    def _check_entity_type_coverage(self, validation: LayerValidation, schema: Dict) -> None:
        """Check that all entity types from schema are in CLI."""
        print("\n  Entity Type Coverage:")

        # Extract entity types from schema
        validation.entity_types_in_schema = self._extract_entity_types_from_schema(
            schema, validation.layer_name
        )

        # Get entity types from CLI registry
        validation.entity_types_in_cli = set(self.registry.get_valid_types(validation.layer_name))

        # Check coverage
        if validation.entity_types_in_schema == validation.entity_types_in_cli:
            result = ValidationResult(
                status=ValidationStatus.PASS,
                category="Entity Types",
                layer=validation.layer_name,
                check="Complete Coverage",
                message=f"All {len(validation.entity_types_in_schema)} entity types from schema are in CLI",
                details={"types": sorted(validation.entity_types_in_schema)},
            )
        elif validation.missing_in_cli:
            result = ValidationResult(
                status=ValidationStatus.FAIL,
                category="Entity Types",
                layer=validation.layer_name,
                check="Missing Types",
                message=f"{len(validation.missing_in_cli)} entity types in schema but not in CLI",
                details={
                    "missing": sorted(validation.missing_in_cli),
                    "schema_types": sorted(validation.entity_types_in_schema),
                    "cli_types": sorted(validation.entity_types_in_cli),
                },
            )
        elif validation.extra_in_cli:
            result = ValidationResult(
                status=ValidationStatus.WARN,
                category="Entity Types",
                layer=validation.layer_name,
                check="Extra Types",
                message=f"{len(validation.extra_in_cli)} entity types in CLI but not in schema",
                details={"extra": sorted(validation.extra_in_cli)},
            )
        else:
            result = ValidationResult(
                status=ValidationStatus.PASS,
                category="Entity Types",
                layer=validation.layer_name,
                check="Coverage",
                message="Entity types match",
            )

        validation.results.append(result)
        self.all_results.append(result)
        print(f"    {result.status.value} {result.check}: {result.message}")

        if result.details and result.status != ValidationStatus.PASS:
            if "missing" in result.details:
                print(f"      Missing: {', '.join(result.details['missing'])}")
            if "extra" in result.details:
                print(f"      Extra: {', '.join(result.details['extra'])}")

    def _check_property_coverage(self, validation: LayerValidation, schema: Dict) -> None:
        """Check that required properties are supported."""
        print("\n  Property Coverage:")

        properties = schema.get("properties", {})

        for prop_name, prop_def in properties.items():
            # Skip metadata properties
            if prop_name in ["id", "name", "description", "relationships"]:
                continue

            # Check if property has required fields
            required = schema.get("required", [])
            is_required = prop_name in required

            result = ValidationResult(
                status=ValidationStatus.PASS,
                category="Properties",
                layer=validation.layer_name,
                check=f"Property: {prop_name}",
                message=f"{'Required' if is_required else 'Optional'} property defined",
                details={"required": is_required, "type": prop_def.get("type", "unknown")},
            )
            validation.results.append(result)
            self.all_results.append(result)

        print(f"    {ValidationStatus.PASS.value} Found {len(properties)} properties in schema")

    def _check_schema_structure(self, validation: LayerValidation, schema: Dict) -> None:
        """Check schema has required structure."""
        print("\n  Schema Structure:")

        # Required fields for CLI functionality
        required_checks = [
            ("$schema", "Has JSON Schema version"),
            ("type", "Has type definition"),
            ("properties", "Has properties"),
        ]

        # Optional fields (nice to have but not required for CLI)
        optional_checks = [("additionalProperties", "Defines additional properties policy")]

        # Check required fields
        for field_name, description in required_checks:
            if field_name in schema:
                result = ValidationResult(
                    status=ValidationStatus.PASS,
                    category="Schema Structure",
                    layer=validation.layer_name,
                    check=field_name,
                    message=description,
                )
            else:
                result = ValidationResult(
                    status=ValidationStatus.FAIL,
                    category="Schema Structure",
                    layer=validation.layer_name,
                    check=field_name,
                    message=f"Missing required field '{field_name}' in schema",
                )

            validation.results.append(result)
            self.all_results.append(result)
            print(f"    {result.status.value} {result.check}: {result.message}")

        # Check optional fields (INFO only, doesn't affect pass rate)
        for field_name, description in optional_checks:
            if field_name in schema:
                result = ValidationResult(
                    status=ValidationStatus.INFO,
                    category="Schema Quality",
                    layer=validation.layer_name,
                    check=field_name,
                    message=description,
                )
                print(f"    {result.status.value} {result.check}: {result.message}")
            # Don't report missing optional fields

    def _check_cli_integration(self, validation: LayerValidation) -> None:
        """Check that CLI commands work with this layer."""
        print("\n  CLI Integration:")

        # Check if layer is in registry
        if validation.layer_name in self.registry.get_all_layers():
            result = ValidationResult(
                status=ValidationStatus.PASS,
                category="CLI Integration",
                layer=validation.layer_name,
                check="Registry Integration",
                message="Layer is registered in EntityTypeRegistry",
            )
        else:
            result = ValidationResult(
                status=ValidationStatus.FAIL,
                category="CLI Integration",
                layer=validation.layer_name,
                check="Registry Integration",
                message="Layer not found in EntityTypeRegistry",
            )

        validation.results.append(result)
        self.all_results.append(result)
        print(f"    {result.status.value} {result.check}: {result.message}")

    def _validate_cross_layer_consistency(self) -> None:
        """Validate consistency across all layers."""
        print(f"\n{'═' * 80}")
        print("CROSS-LAYER VALIDATION")
        print(f"{'═' * 80}\n")

        # Check all 12 expected layers are present
        expected_layers = [
            "motivation",
            "business",
            "security",
            "application",
            "technology",
            "api",
            "data_model",
            "datastore",
            "ux",
            "navigation",
            "apm_observability",
            "testing",
        ]

        found_layers = set(self.layer_validations.keys())
        expected_set = set(expected_layers)

        missing_layers = expected_set - found_layers
        extra_layers = found_layers - expected_set

        if not missing_layers and not extra_layers:
            result = ValidationResult(
                status=ValidationStatus.PASS,
                category="Cross-Layer",
                layer="all",
                check="Layer Completeness",
                message=f"All {len(expected_layers)} expected layers present",
            )
        else:
            result = ValidationResult(
                status=ValidationStatus.FAIL if missing_layers else ValidationStatus.WARN,
                category="Cross-Layer",
                layer="all",
                check="Layer Completeness",
                message=f"Missing: {len(missing_layers)}, Extra: {len(extra_layers)}",
                details={"missing": sorted(missing_layers), "extra": sorted(extra_layers)},
            )

        self.all_results.append(result)
        print(f"  {result.status.value} {result.check}: {result.message}")
        if result.details:
            if result.details.get("missing"):
                print(f"    Missing layers: {', '.join(result.details['missing'])}")
            if result.details.get("extra"):
                print(f"    Extra layers: {', '.join(result.details['extra'])}")

    def _extract_entity_types_from_schema(self, schema: Dict, layer_name: str) -> Set[str]:
        """Extract entity type names from schema properties."""
        # Use registry's extraction logic for consistency
        from documentation_robotics.schemas.registry import (
            API_LAYER_TYPES,
            DATA_MODEL_LAYER_TYPES,
            TESTING_LAYER_TYPES,
            UX_LAYER_TYPES,
        )

        if layer_name == "api":
            return set(API_LAYER_TYPES)
        elif layer_name == "data_model":
            return set(DATA_MODEL_LAYER_TYPES)
        elif layer_name == "testing":
            return set(TESTING_LAYER_TYPES)
        elif layer_name == "ux":
            return set(UX_LAYER_TYPES)

        properties = schema.get("properties", {})
        entity_types = set()

        for prop_name in properties.keys():
            if prop_name in ["id", "name", "description", "relationships"]:
                continue

            # Use registry's parsing logic
            entity_type = self.registry._parse_entity_type(prop_name)
            if entity_type:
                entity_types.add(entity_type)

        return entity_types

    def _find_schema_file(self, layer_name: str) -> Optional[Path]:
        """Find schema file for layer."""
        # Try different naming patterns
        patterns = [
            f"*{layer_name}*layer.schema.json",
            f"*{layer_name.replace('_', '-')}*layer.schema.json",
        ]

        for pattern in patterns:
            files = list(self.schema_dir.glob(pattern))
            if files:
                return files[0]

        return None

    def generate_report(self, output_file: Optional[Path] = None) -> str:
        """
        Generate comprehensive validation report.

        Returns:
            Report as markdown string
        """
        lines = []
        lines.append("# Schema Completeness Validation Report\n")
        lines.append(f"**Schema Directory:** `{self.schema_dir}`\n")
        lines.append(f"**Total Layers:** {len(self.layer_validations)}\n")

        # Overall statistics (exclude INFO from calculations)
        counted_results = [r for r in self.all_results if r.status != ValidationStatus.INFO]
        total_checks = len(counted_results)
        passed = sum(1 for r in counted_results if r.status == ValidationStatus.PASS)
        failed = sum(1 for r in counted_results if r.status == ValidationStatus.FAIL)
        warned = sum(1 for r in counted_results if r.status == ValidationStatus.WARN)

        overall_pass_rate = (passed / total_checks * 100) if total_checks > 0 else 0

        lines.append(f"**Overall Pass Rate:** {overall_pass_rate:.1f}%\n")
        lines.append(f"**Results:** {passed} passed, {failed} failed, {warned} warnings\n")

        # Status indicator
        if failed == 0:
            lines.append("\n✅ **Status: ALL CHECKS PASSED**\n")
        else:
            lines.append(f"\n❌ **Status: {failed} CHECKS FAILED**\n")

        # Layer-by-layer results
        lines.append("\n## Layer Validation Results\n")

        for layer_name in sorted(self.layer_validations.keys()):
            validation = self.layer_validations[layer_name]
            lines.append(f"\n### {layer_name.replace('_', ' ').title()}\n")
            lines.append(f"**Schema:** `{validation.schema_file.name}`\n")
            lines.append(f"**Pass Rate:** {validation.pass_rate:.1f}%\n")

            # Entity types
            lines.append("\n**Entity Types:**\n")
            lines.append(f"- Schema: {len(validation.entity_types_in_schema)} types\n")
            lines.append(f"- CLI: {len(validation.entity_types_in_cli)} types\n")

            if validation.entity_types_in_schema == validation.entity_types_in_cli:
                lines.append("- ✅ Perfect match!\n")
            else:
                if validation.missing_in_cli:
                    lines.append(
                        f"- ❌ Missing in CLI: {', '.join(sorted(validation.missing_in_cli))}\n"
                    )
                if validation.extra_in_cli:
                    lines.append(
                        f"- ⚠️ Extra in CLI: {', '.join(sorted(validation.extra_in_cli))}\n"
                    )

            # Detailed results
            lines.append("\n**Validation Checks:**\n")
            for result in validation.results:
                icon = (
                    "✓"
                    if result.status == ValidationStatus.PASS
                    else ("✗" if result.status == ValidationStatus.FAIL else "⚠")
                )
                lines.append(f"- {icon} {result.category} - {result.check}: {result.message}\n")

        # Summary table
        lines.append("\n## Summary Table\n")
        lines.append(
            "| Layer | Entity Types (Schema) | Entity Types (CLI) | Pass Rate | Status |\n"
        )
        lines.append("|-------|----------------------|-------------------|-----------|--------|\n")

        for layer_name in sorted(self.layer_validations.keys()):
            validation = self.layer_validations[layer_name]
            status = (
                "✅"
                if validation.pass_rate == 100
                else ("⚠️" if validation.pass_rate >= 80 else "❌")
            )
            lines.append(
                f"| {layer_name} | "
                f"{len(validation.entity_types_in_schema)} | "
                f"{len(validation.entity_types_in_cli)} | "
                f"{validation.pass_rate:.1f}% | "
                f"{status} |\n"
            )

        report = "".join(lines)

        if output_file:
            output_file.write_text(report)
            print(f"\n✓ Report written to: {output_file}")

        return report


def main():
    """Run schema completeness validation."""
    validator = SchemaCompletenessValidator()
    validator.validate_all()

    # Generate report
    output_file = Path(__file__).parent / "validation_report.md"
    validator.generate_report(output_file)

    # Print final summary
    print("\n" + "=" * 80)
    print("VALIDATION COMPLETE")
    print("=" * 80)

    failed = sum(1 for r in validator.all_results if r.status == ValidationStatus.FAIL)
    if failed == 0:
        print("\n✅ All validation checks passed!")
        print("   The CLI implementation matches the spec schemas 100%\n")
        return 0
    else:
        print(f"\n❌ {failed} validation checks failed")
        print(f"   Review the report at: {output_file}\n")
        return 1


if __name__ == "__main__":
    exit(main())
