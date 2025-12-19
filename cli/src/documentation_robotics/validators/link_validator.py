"""Link Validator - Validates cross-layer references and intra-layer relationships.

This module provides the LinkValidator class which validates link instances
for existence, type compatibility, cardinality, format, and other rules.
Also validates intra-layer relationships using predicate validation.
"""

import ast
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core.link_analyzer import LinkAnalyzer, LinkInstance
from ..core.link_registry import LinkRegistry
from ..core.relationship_registry import RelationshipRegistry
from .predicate_validator import PredicateValidator

# Constants
PREDICATE_VALIDATION = "predicate_validation"


class ValidationSeverity(Enum):
    """Severity level for validation issues."""

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class ValidationIssue:
    """Represents a validation issue found in a link."""

    severity: ValidationSeverity
    link_instance: LinkInstance
    issue_type: str
    message: str
    suggestion: Optional[str] = None
    element_id: Optional[str] = None  # For source link validation errors

    def __str__(self) -> str:
        """String representation of the issue."""
        parts = [f"[{self.severity.value.upper()}]", f"{self.issue_type}:", f"{self.message}"]

        if self.suggestion:
            parts.append(f"  Suggestion: {self.suggestion}")

        location = f"  Location: {self.link_instance.source_id} -> {self.link_instance.field_path}"
        parts.append(location)

        return "\n".join(parts)


class LinkValidator:
    """Validates cross-layer links and intra-layer relationships in the model.

    This class performs various validation checks on discovered links,
    including existence checks, type compatibility, format validation,
    and cardinality checks.

    For intra-layer relationships, validates predicates against the relationship
    catalog, including inverse consistency and cardinality constraints.
    """

    def __init__(
        self,
        link_registry: LinkRegistry,
        link_analyzer: LinkAnalyzer,
        strict_mode: bool = False,
        relationship_registry: Optional[RelationshipRegistry] = None,
    ):
        """Initialize the link validator.

        Args:
            link_registry: LinkRegistry with link definitions
            link_analyzer: LinkAnalyzer with discovered links
            strict_mode: If True, all issues are treated as errors
            relationship_registry: Optional RelationshipRegistry for predicate validation
        """
        self.registry = link_registry
        self.analyzer = link_analyzer
        self.strict_mode = strict_mode
        self.issues: List[ValidationIssue] = []

        # Initialize predicate validator if relationship registry provided
        self.predicate_validator: Optional[PredicateValidator] = None
        if relationship_registry:
            self.predicate_validator = PredicateValidator(
                relationship_registry, strict_mode=strict_mode
            )

    def validate_all(self) -> List[ValidationIssue]:
        """Validate all discovered links.

        Returns:
            List of ValidationIssue objects
        """
        self.issues.clear()

        for link in self.analyzer.links:
            self._validate_link(link)

        return self.issues

    def _validate_link(self, link: LinkInstance) -> None:
        """Validate a single link instance.

        Args:
            link: LinkInstance to validate
        """
        # Check existence
        self._validate_existence(link)

        # Check type compatibility
        self._validate_type_compatibility(link)

        # Check cardinality
        self._validate_cardinality(link)

        # Check format
        self._validate_format(link)

    def _validate_existence(self, link: LinkInstance) -> None:
        """Validate that link targets exist in the model.

        Args:
            link: LinkInstance to validate
        """
        for target_id in link.target_ids:
            if target_id not in self.analyzer.element_types:
                severity = (
                    ValidationSeverity.ERROR if self.strict_mode else ValidationSeverity.WARNING
                )

                # Try to find similar element IDs for suggestion
                suggestion = self._suggest_similar_elements(target_id)

                self.issues.append(
                    ValidationIssue(
                        severity=severity,
                        link_instance=link,
                        issue_type="missing_target",
                        message=f"Link target '{target_id}' does not exist in the model",
                        suggestion=suggestion,
                    )
                )

    def _validate_type_compatibility(self, link: LinkInstance) -> None:
        """Validate that link targets are of the correct element type.

        Args:
            link: LinkInstance to validate
        """
        expected_types = link.link_type.target_element_types

        for target_id in link.target_ids:
            actual_type = self.analyzer.element_types.get(target_id)

            if actual_type and actual_type not in expected_types:
                severity = (
                    ValidationSeverity.ERROR if self.strict_mode else ValidationSeverity.WARNING
                )

                self.issues.append(
                    ValidationIssue(
                        severity=severity,
                        link_instance=link,
                        issue_type="type_mismatch",
                        message=(
                            f"Link target '{target_id}' has type '{actual_type}' "
                            f"but expected one of {expected_types}"
                        ),
                        suggestion=f"Ensure the target is a {'/'.join(expected_types)} element",
                    )
                )

    def _validate_cardinality(self, link: LinkInstance) -> None:
        """Validate that link cardinality matches the definition.

        Args:
            link: LinkInstance to validate
        """
        expected_cardinality = link.link_type.cardinality
        actual_count = len(link.target_ids)

        if expected_cardinality == "single" and actual_count != 1:
            severity = ValidationSeverity.ERROR if self.strict_mode else ValidationSeverity.WARNING

            self.issues.append(
                ValidationIssue(
                    severity=severity,
                    link_instance=link,
                    issue_type="cardinality_mismatch",
                    message=(f"Link expects single value but has {actual_count} targets"),
                    suggestion=f"Use a single ID instead of an array for {link.field_path}",
                )
            )
        elif expected_cardinality == "array" and actual_count < 1:
            severity = ValidationSeverity.WARNING

            self.issues.append(
                ValidationIssue(
                    severity=severity,
                    link_instance=link,
                    issue_type="empty_array",
                    message="Link is an empty array",
                    suggestion=f"Either remove {link.field_path} or add target IDs",
                )
            )

    def _validate_format(self, link: LinkInstance) -> None:
        """Validate that link targets match the expected format.

        Args:
            link: LinkInstance to validate
        """
        format_type = link.link_type.format
        pattern = link.link_type.validation_rules.get("formatPattern")

        if not pattern:
            # No format pattern defined, skip validation
            return

        pattern_regex = re.compile(pattern)

        for target_id in link.target_ids:
            if not pattern_regex.match(str(target_id)):
                severity = (
                    ValidationSeverity.ERROR if self.strict_mode else ValidationSeverity.WARNING
                )

                self.issues.append(
                    ValidationIssue(
                        severity=severity,
                        link_instance=link,
                        issue_type="format_mismatch",
                        message=(
                            f"Link target '{target_id}' does not match expected {format_type} format"
                        ),
                        suggestion=f"Ensure target follows pattern: {pattern}",
                    )
                )

    def _suggest_similar_elements(self, target_id: str) -> Optional[str]:
        """Suggest similar element IDs that might be the intended target.

        Args:
            target_id: The missing target ID

        Returns:
            Suggestion string or None
        """
        # Find elements with similar IDs (simple string similarity)
        similar = []
        target_lower = target_id.lower()

        for element_id in self.analyzer.element_types.keys():
            element_lower = element_id.lower()

            # Check if they share a significant portion of characters
            if (
                target_lower in element_lower
                or element_lower in target_lower
                or self._levenshtein_distance(target_lower, element_lower) <= 3
            ):
                similar.append(element_id)

        if similar:
            if len(similar) == 1:
                return f"Did you mean '{similar[0]}'?"
            else:
                return f"Similar elements: {', '.join(similar[:3])}"

        return None

    def _levenshtein_distance(self, s1: str, s2: str) -> int:
        """Calculate Levenshtein distance between two strings.

        Args:
            s1: First string
            s2: Second string

        Returns:
            Edit distance
        """
        if len(s1) < len(s2):
            return self._levenshtein_distance(s2, s1)

        if len(s2) == 0:
            return len(s1)

        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                # Cost of insertions, deletions, or substitutions
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row

        return previous_row[-1]

    def get_issues_by_severity(self, severity: ValidationSeverity) -> List[ValidationIssue]:
        """Get all issues of a specific severity.

        Args:
            severity: Severity level to filter by

        Returns:
            List of ValidationIssue objects
        """
        return [issue for issue in self.issues if issue.severity == severity]

    def get_issues_by_type(self, issue_type: str) -> List[ValidationIssue]:
        """Get all issues of a specific type.

        Args:
            issue_type: Issue type to filter by

        Returns:
            List of ValidationIssue objects
        """
        return [issue for issue in self.issues if issue.issue_type == issue_type]

    def get_issues_for_element(self, element_id: str) -> List[ValidationIssue]:
        """Get all issues related to a specific element.

        Args:
            element_id: Element ID to filter by

        Returns:
            List of ValidationIssue objects
        """
        return [
            issue
            for issue in self.issues
            if issue.link_instance.source_id == element_id
            or element_id in issue.link_instance.target_ids
        ]

    def has_errors(self) -> bool:
        """Check if there are any error-level issues.

        Returns:
            True if errors exist, False otherwise
        """
        return any(issue.severity == ValidationSeverity.ERROR for issue in self.issues)

    def get_summary(self) -> Dict[str, Any]:
        """Get a summary of validation results.

        Returns:
            Dictionary with validation summary
        """
        return {
            "total_issues": len(self.issues),
            "errors": len(self.get_issues_by_severity(ValidationSeverity.ERROR)),
            "warnings": len(self.get_issues_by_severity(ValidationSeverity.WARNING)),
            "info": len(self.get_issues_by_severity(ValidationSeverity.INFO)),
            "strict_mode": self.strict_mode,
            "issues_by_type": {
                issue_type: len(self.get_issues_by_type(issue_type))
                for issue_type in set(issue.issue_type for issue in self.issues)
            },
        }

    def print_issues(self, severity_filter: Optional[ValidationSeverity] = None) -> None:
        """Print validation issues to console.

        Args:
            severity_filter: Optional severity level to filter by
        """
        issues = self.issues
        if severity_filter:
            issues = self.get_issues_by_severity(severity_filter)

        if not issues:
            print("No validation issues found.")
            return

        for issue in issues:
            print(str(issue))
            print()  # Blank line between issues

    def validate_intra_layer_relationships(self, model: Any) -> List[ValidationIssue]:
        """Validate intra-layer relationships using predicate validation.

        This method validates relationships within the same layer, checking:
        - Predicate existence and validity
        - Layer-specific constraints
        - Inverse consistency
        - Cardinality constraints

        Args:
            model: Model instance with get_element() and layers

        Returns:
            List of ValidationIssue objects
        """
        if not self.predicate_validator:
            # No predicate validator configured
            return []

        relationship_issues = []

        # Iterate through all layers and elements
        for layer_name, layer in model.layers.items():
            for element in layer.elements.values():
                # Check if element has relationships
                if not hasattr(element, "data") or not isinstance(element.data, dict):
                    continue

                relationships = element.data.get("relationships", [])
                if not isinstance(relationships, list):
                    continue

                # Validate each relationship
                for relationship in relationships:
                    target_id = relationship.get("targetId")
                    predicate = relationship.get("predicate")

                    if not target_id or not predicate:
                        # Missing required fields
                        continue

                    # Get target element to check if same layer
                    target_element = model.get_element(target_id)
                    if not target_element:
                        # Target doesn't exist (handled by reference validator)
                        continue

                    # Use layer name from iteration context (more robust than parsing IDs)
                    source_layer = layer_name

                    # Find target layer by checking which layer contains target element
                    target_layer = None
                    for tgt_layer_name, tgt_layer in model.layers.items():
                        if target_id in tgt_layer.elements:
                            target_layer = tgt_layer_name
                            break

                    # Only validate intra-layer relationships
                    if source_layer != target_layer:
                        continue

                    # Validate the relationship
                    result = self.predicate_validator.validate_relationship(
                        source_id=element.id,
                        target_id=target_id,
                        predicate=predicate,
                        source_layer=source_layer,
                        model=model,
                    )

                    if not result.is_valid() or result.warnings:
                        # Create a pseudo LinkInstance for error reporting
                        pseudo_link = self._create_pseudo_link_instance(
                            element.id, target_id, f"relationships[{predicate}]"
                        )

                        if not result.is_valid():
                            severity = ValidationSeverity.ERROR
                            message = "; ".join(e.message for e in result.errors)
                        else:
                            severity = (
                                ValidationSeverity.ERROR
                                if self.strict_mode
                                else ValidationSeverity.WARNING
                            )
                            message = "; ".join(w.message for w in result.warnings)

                        issue = ValidationIssue(
                            severity=severity,
                            link_instance=pseudo_link,
                            issue_type=PREDICATE_VALIDATION,
                            message=message,
                            suggestion=f"Check relationship between {element.id} and {target_id} with predicate '{predicate}'",
                        )
                        relationship_issues.append(issue)

        return relationship_issues

    def _create_pseudo_link_instance(
        self, source_id: str, target_id: str, field_path: str
    ) -> LinkInstance:
        """Create a pseudo LinkInstance for relationship validation errors.

        Args:
            source_id: Source element ID
            target_id: Target element ID
            field_path: Field path for error reporting

        Returns:
            LinkInstance object
        """
        # Import here to avoid circular dependency
        from ..core.link_analyzer import LinkInstance
        from ..core.link_registry import LinkType

        # Create a minimal LinkType for error reporting
        pseudo_link_type = LinkType(
            id="intra-layer-relationship",
            name="Intra-Layer Relationship",
            category="semantic",
            source_layers=[],
            target_layer="",
            target_element_types=[],
            field_paths=[field_path],
            cardinality="single",
            format="string",
            description="Intra-layer semantic relationship",
            examples=[],
            validation_rules={},
        )

        return LinkInstance(
            source_id=source_id,
            field_path=field_path,
            target_ids=[target_id],
            link_type=pseudo_link_type,
        )

    def __repr__(self) -> str:
        """String representation of the validator."""
        return f"LinkValidator(issues={len(self.issues)}, " f"strict_mode={self.strict_mode})"

    def validate_source_references(
        self, model: Any, deep_validation: bool = False
    ) -> List[ValidationIssue]:
        """Validate source code references in all model elements.

        This method checks:
        - File existence relative to repository root
        - Symbol existence (with deep_validation flag)

        Args:
            model: Model instance with layers and elements
            deep_validation: If True, check symbol existence in files

        Returns:
            List of ValidationIssue objects
        """
        issues = []

        # Iterate through all layers and elements
        for layer_name, layer in model.layers.items():
            for element in layer.elements.values():
                # Check if element has source references
                if not hasattr(element, "data") or not isinstance(element.data, dict):
                    continue

                # Source references can be at different field paths depending on layer
                source_refs = self._extract_source_references(element.data)

                for field_path, source_ref in source_refs:
                    issues.extend(
                        self._validate_source_reference(
                            element.id, source_ref, field_path, deep_validation
                        )
                    )

        return issues

    def _extract_source_references(self, data: Dict[str, Any]) -> List[tuple]:
        """Extract all source references from element data.

        Returns list of (field_path, source_ref) tuples.

        Args:
            data: Element data dictionary

        Returns:
            List of (field_path, source_ref) tuples
        """
        refs = []

        # Check for OpenAPI extension x-source-reference (used in API, APM, Data Model, Datastore, Testing)
        if "x-source-reference" in data and isinstance(data["x-source-reference"], dict):
            refs.append(("x-source-reference", data["x-source-reference"]))

        # Check for nested source.reference (used in Application, UX, Navigation)
        if isinstance(data.get("source"), dict) and isinstance(
            data["source"].get("reference"), dict
        ):
            refs.append(("source.reference", data["source"]["reference"]))

        # Check for properties.source.reference (used in Application)
        if isinstance(data.get("properties"), dict) and isinstance(
            data["properties"].get("source"), dict
        ):
            if isinstance(data["properties"]["source"].get("reference"), dict):
                refs.append(("properties.source.reference", data["properties"]["source"]["reference"]))

        return refs

    def _validate_source_reference(
        self, element_id: str, source_ref: Dict[str, Any], field_path: str, deep_validation: bool
    ) -> List[ValidationIssue]:
        """Validate a single source reference.

        Args:
            element_id: ID of the element containing the reference
            source_ref: Source reference object
            field_path: Field path for error reporting
            deep_validation: If True, validate symbol existence

        Returns:
            List of ValidationIssue objects
        """
        issues = []

        # Create a pseudo LinkInstance for error reporting
        pseudo_link = self._create_pseudo_link_for_source_ref(element_id, field_path)

        # Validate required fields
        if "locations" not in source_ref:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    link_instance=pseudo_link,
                    issue_type="missing-locations",
                    message="Source reference missing required 'locations' field",
                    suggestion="Add at least one location with file path",
                )
            )
            return issues

        locations = source_ref.get("locations", [])
        if not isinstance(locations, list) or len(locations) == 0:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    link_instance=pseudo_link,
                    issue_type="empty-locations",
                    message="Source reference locations array is empty",
                    suggestion="Add at least one location with file path",
                )
            )
            return issues

        # Get repository context
        repo = source_ref.get("repository", {})
        repo_url = repo.get("url")

        # Determine repository root
        repo_root = self._get_repo_root(repo_url)

        # Validate each location
        for i, location in enumerate(locations):
            if not isinstance(location, dict):
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        link_instance=pseudo_link,
                        issue_type="invalid-location-format",
                        message=f"Location at index {i} is not an object",
                        suggestion="Each location must be an object with 'file' property",
                    )
                )
                continue

            file_path = location.get("file")
            if not file_path:
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        link_instance=pseudo_link,
                        issue_type="missing-file",
                        message=f"Location at index {i} missing required 'file' property",
                        suggestion="Specify file path relative to repository root",
                    )
                )
                continue

            # Check file exists
            full_path = repo_root / file_path
            if not full_path.exists():
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        link_instance=pseudo_link,
                        issue_type="source-file-not-found",
                        message=f"Source file not found: {file_path}",
                        suggestion="Verify file path is correct relative to repository root, or update source reference",
                    )
                )
                continue

            # Validate symbol if deep validation enabled
            if deep_validation and location.get("symbol"):
                symbol = location["symbol"]
                if not self._symbol_exists_in_file(full_path, symbol):
                    issues.append(
                        ValidationIssue(
                            severity=ValidationSeverity.WARNING,
                            link_instance=pseudo_link,
                            issue_type="source-symbol-not-found",
                            message=f"Symbol '{symbol}' not found in {file_path}",
                            suggestion="Verify symbol name and location match the source code",
                        )
                    )

        return issues

    def _get_repo_root(self, repo_url: Optional[str]) -> Path:
        """Get the repository root path.

        For now, always returns current working directory.
        In the future, could support cloning remote repositories.

        Args:
            repo_url: Optional repository URL (not used in current implementation)

        Returns:
            Path to repository root
        """
        # For local validation, use current working directory
        return Path.cwd()

    def _symbol_exists_in_file(self, file_path: Path, symbol: str) -> bool:
        """Check if a symbol exists in a source file.

        Currently supports Python files. Other languages return True
        (permissive approach to avoid false negatives).

        Args:
            file_path: Path to source file
            symbol: Symbol name (e.g., "ClassName.method_name")

        Returns:
            True if symbol found or language not supported, False if not found
        """
        try:
            # Only deep validate Python files for now
            if file_path.suffix != ".py":
                return True

            # Read file content
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            # Parse Python file
            try:
                tree = ast.parse(content)
            except SyntaxError:
                # If file doesn't parse, assume symbol exists (permissive)
                return True

            # Extract symbol parts (e.g., "ClassName.method_name" -> ["ClassName", "method_name"])
            symbol_parts = symbol.split(".")

            # Find the symbol in the AST
            return self._find_symbol_in_ast(tree, symbol_parts)

        except Exception:
            # If any error occurs, assume symbol exists (permissive approach)
            return True

    def _find_symbol_in_ast(self, tree: ast.AST, symbol_parts: List[str]) -> bool:
        """Find a symbol in a Python AST.

        Args:
            tree: AST tree to search
            symbol_parts: Symbol parts to find (e.g., ["ClassName", "method_name"])

        Returns:
            True if symbol found, False otherwise
        """
        if not symbol_parts:
            return False

        first_part = symbol_parts[0]

        # Find top-level class or function with first part of symbol
        for node in ast.walk(tree):
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name == first_part:
                    # If only one part, we found it
                    if len(symbol_parts) == 1:
                        return True

                    # If more parts, look for method/attribute in class
                    if isinstance(node, ast.ClassDef) and len(symbol_parts) > 1:
                        if self._find_method_in_class(node, symbol_parts[1:]):
                            return True

        return False

    def _find_method_in_class(self, class_node: ast.ClassDef, symbol_parts: List[str]) -> bool:
        """Find a method in a class node.

        Args:
            class_node: AST ClassDef node
            symbol_parts: Remaining symbol parts to find

        Returns:
            True if method found, False otherwise
        """
        if not symbol_parts:
            return False

        first_part = symbol_parts[0]

        # Look for method in class
        for item in class_node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if item.name == first_part:
                    # If only one part, we found it
                    if len(symbol_parts) == 1:
                        return True

                    # If more parts, this is a nested method (not supported)
                    return False

        return False

    def _create_pseudo_link_for_source_ref(self, source_id: str, field_path: str) -> LinkInstance:
        """Create a pseudo LinkInstance for source reference validation errors.

        Args:
            source_id: Source element ID
            field_path: Field path for error reporting

        Returns:
            LinkInstance object
        """
        from ..core.link_registry import LinkType

        # Create a minimal LinkType for error reporting
        pseudo_link_type = LinkType(
            id="source-reference-validation",
            name="Source Reference",
            category="source",
            source_layers=[],
            target_layer="",
            target_element_types=[],
            field_paths=[field_path],
            cardinality="single",
            format="object",
            description="Source code reference validation",
            examples=[],
            validation_rules={},
        )

        return LinkInstance(
            link_type=pseudo_link_type,
            source_id=source_id,
            source_layer="",
            source_element_type="",
            target_ids=[],
            field_path=field_path,
        )
