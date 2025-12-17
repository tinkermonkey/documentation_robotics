"""Link Validator - Validates cross-layer references and intra-layer relationships.

This module provides the LinkValidator class which validates link instances
for existence, type compatibility, cardinality, format, and other rules.
Also validates intra-layer relationships using predicate validation.
"""

import re
from dataclasses import dataclass
from enum import Enum
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
