"""
Documentation Robotics CLI Implementation.

This package provides tools for managing project models across 11 layers of a software system,
implementing the Documentation Robotics Specification.
"""

__version__ = "0.3.3"
__spec_version__ = "0.1.1"

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
