"""
Specification version tracking for the CLI implementation.

This module tracks which version of the Documentation Robotics Specification
this CLI implementation conforms to.
"""

# Specification version implemented
SPEC_VERSION = "0.1.1"

# Conformance level
CONFORMANCE_LEVEL = "full"  # basic, standard, or full

# Layers implemented
IMPLEMENTED_LAYERS = {
    "01_motivation": {"implemented": True, "standard": "ArchiMate 3.2"},
    "02_business": {"implemented": True, "standard": "ArchiMate 3.2"},
    "03_security": {"implemented": True, "standard": "Custom"},
    "04_application": {"implemented": True, "standard": "ArchiMate 3.2"},
    "05_technology": {"implemented": True, "standard": "ArchiMate 3.2"},
    "06_api": {"implemented": True, "standard": "OpenAPI 3.0"},
    "07_data_model": {"implemented": True, "standard": "JSON Schema Draft 7"},
    "08_datastore": {"implemented": True, "standard": "SQL DDL"},
    "09_ux": {"implemented": True, "standard": "Custom"},
    "10_navigation": {"implemented": True, "standard": "Custom"},
    "11_apm": {"implemented": True, "standard": "OpenTelemetry 1.0+"},
}

# Capabilities
CAPABILITIES = {
    "entityManagement": True,
    "schemaValidation": True,
    "crossLayerReferences": True,
    "semanticValidation": True,
    "upwardTraceability": True,
    "securityIntegration": True,
    "bidirectionalConsistency": True,
    "goalToMetricTraceability": True,
    "dataQualityMetrics": True,
    "exportFormats": [
        "archimate",
        "openapi",
        "json-schema",
        "plantuml",
        "markdown",
        "graphml",
    ],
}


def get_conformance_statement():
    """
    Generate conformance statement for this implementation.

    Returns:
        dict: Conformance statement
    """
    from . import __version__

    return {
        "implementation": {
            "name": "Documentation Robotics CLI (dr)",
            "version": __version__,
            "vendor": "Documentation Robotics Team",
            "repository": "https://github.com/tinkermonkey/documentation_robotics",
            "license": "MIT",
        },
        "specification": {
            "name": "Documentation Robotics Specification",
            "version": SPEC_VERSION,
            "conformanceLevel": CONFORMANCE_LEVEL,
            "url": "https://github.com/tinkermonkey/documentation_robotics/tree/main/spec",
        },
        "layers": IMPLEMENTED_LAYERS,
        "capabilities": CAPABILITIES,
    }


def check_model_compatibility(model_spec_version: str) -> tuple[bool, str]:
    """
    Check if a model's spec version is compatible with this implementation.

    Args:
        model_spec_version: The specification version the model was created with

    Returns:
        Tuple of (is_compatible, message)
    """
    # Parse versions
    impl_major, impl_minor, impl_patch = SPEC_VERSION.split(".")
    try:
        model_major, model_minor, model_patch = model_spec_version.split(".")
    except ValueError:
        return False, f"Invalid model spec version format: {model_spec_version}"

    # Major version must match
    if impl_major != model_major:
        return (
            False,
            f"Incompatible major version: model uses {model_spec_version}, "
            f"this tool implements {SPEC_VERSION}",
        )

    # Minor version: tool must be >= model
    if int(impl_minor) < int(model_minor):
        return (
            False,
            f"Model uses newer spec version: model uses {model_spec_version}, "
            f"this tool implements {SPEC_VERSION}. Please upgrade the tool.",
        )

    # Compatible
    if model_spec_version == SPEC_VERSION:
        return True, f"Exact match: {SPEC_VERSION}"
    else:
        return (
            True,
            f"Compatible: model uses {model_spec_version}, " f"tool implements {SPEC_VERSION}",
        )
