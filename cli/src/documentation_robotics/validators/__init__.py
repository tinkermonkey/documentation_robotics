"""
Validators for the Documentation Robotics Specification.

This package contains all validation logic for ensuring model correctness
across schema, semantic, and cross-layer consistency dimensions.
"""

from .base import BaseValidator, ValidationError, ValidationResult, ValidationWarning
from .consistency import BidirectionalConsistencyValidator
from .goal_metrics import GoalToMetricTraceabilityValidator
from .security import SecurityIntegrationValidator
from .semantic import SemanticValidator
from .traceability import UpwardTraceabilityValidator

__all__ = [
    # Base classes
    "BaseValidator",
    "ValidationResult",
    "ValidationError",
    "ValidationWarning",
    # Validators
    "SemanticValidator",
    "UpwardTraceabilityValidator",
    "SecurityIntegrationValidator",
    "BidirectionalConsistencyValidator",
    "GoalToMetricTraceabilityValidator",
]
