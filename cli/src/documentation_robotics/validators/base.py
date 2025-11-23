"""
Base validation classes and structures.
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ValidationIssue:
    """Represents a single validation issue."""

    layer: str
    element_id: Optional[str]
    message: str
    severity: str  # 'error' or 'warning'
    location: Optional[str] = None
    fix_suggestion: Optional[str] = None


@dataclass
class ValidationResult:
    """Represents validation results."""

    errors: List[ValidationIssue] = field(default_factory=list)
    warnings: List[ValidationIssue] = field(default_factory=list)

    def add_error(
        self,
        layer: str,
        message: str,
        element_id: Optional[str] = None,
        location: Optional[str] = None,
        fix: Optional[str] = None,
    ):
        """Add an error."""
        self.errors.append(
            ValidationIssue(
                layer=layer,
                element_id=element_id,
                message=message,
                severity="error",
                location=location,
                fix_suggestion=fix,
            )
        )

    def add_warning(
        self,
        layer: str,
        message: str,
        element_id: Optional[str] = None,
        location: Optional[str] = None,
    ):
        """Add a warning."""
        self.warnings.append(
            ValidationIssue(
                layer=layer,
                element_id=element_id,
                message=message,
                severity="warning",
                location=location,
            )
        )

    def merge(self, other: "ValidationResult", prefix: str = ""):
        """Merge another result into this one."""
        for error in other.errors:
            if prefix and error.element_id:
                error.element_id = f"{prefix}.{error.element_id}"
            self.errors.append(error)

        for warning in other.warnings:
            if prefix and warning.element_id:
                warning.element_id = f"{prefix}.{warning.element_id}"
            self.warnings.append(warning)

    def is_valid(self) -> bool:
        """Check if validation passed (no errors)."""
        return len(self.errors) == 0

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            "valid": self.is_valid(),
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "errors": [
                {
                    "layer": e.layer,
                    "element_id": e.element_id,
                    "message": e.message,
                    "location": e.location,
                    "fix": e.fix_suggestion,
                }
                for e in self.errors
            ],
            "warnings": [
                {
                    "layer": w.layer,
                    "element_id": w.element_id,
                    "message": w.message,
                    "location": w.location,
                }
                for w in self.warnings
            ],
        }


class BaseValidator:
    """Base class for all validators."""

    def validate(self, *args, **kwargs) -> ValidationResult:
        """Perform validation. Must be implemented by subclasses."""
        raise NotImplementedError
