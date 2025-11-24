"""
Documentation Robotics CLI - Federated Architecture Metadata Model Implementation.

This package provides tools for managing architecture models across 11 layers,
implementing the Federated Architecture Metadata Model specification.
"""

__version__ = "0.3.0"
__spec_version__ = "0.1.0"

# Core exports for programmatic use
from .core.element import Element
from .core.layer import Layer
from .core.model import Model

__all__ = [
    "__version__",
    "__spec_version__",
    "Model",
    "Layer",
    "Element",
]
