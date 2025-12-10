"""
Documentation Robotics CLI Implementation.

This package provides tools for managing project models across 12 layers of a software system,
implementing the Documentation Robotics Specification.
"""

# Import versions from single source of truth
# Core exports for programmatic use
from .core.element import Element
from .core.layer import Layer
from .core.model import Model
from .versions import __spec_version__, __version__

__all__ = [
    "__version__",
    "__spec_version__",
    "Model",
    "Layer",
    "Element",
]
