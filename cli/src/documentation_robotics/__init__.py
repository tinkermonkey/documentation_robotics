"""
Documentation Robotics CLI Implementation.

This package provides tools for managing project models across 12 layers of a software system,
implementing the Documentation Robotics Specification.
"""

__version__ = "0.7.0"
__spec_version__ = "0.4.0"

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
