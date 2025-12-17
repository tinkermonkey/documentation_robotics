"""
Layer name to numeric identifier mapping utility.

This module provides centralized mapping between layer names used in the model
(e.g., 'api', 'data_model') and numeric identifiers used in the specification
and relationship catalog (e.g., '06', '07').
"""

# Centralized mapping from layer names to numeric identifiers
LAYER_NAME_TO_NUMBER = {
    'motivation': '01',
    'business': '02',
    'security': '03',
    'application': '04',
    'technology': '05',
    'api': '06',
    'data_model': '07',
    'data_store': '08',
    'ux': '09',
    'navigation': '10',
    'apm': '11',
    'testing': '12',
}


def normalize_layer_identifier(layer: str) -> str:
    """
    Normalize a layer identifier to its numeric form.

    Handles various input formats:
    - Simple name: 'api' -> '06'
    - Already numeric: '06' -> '06'
    - With prefix: '06-api' -> '06'

    Args:
        layer: Layer identifier in any format

    Returns:
        Numeric layer identifier (e.g., '06')

    Raises:
        ValueError: If layer identifier is invalid
    """
    if not layer:
        raise ValueError("Layer identifier cannot be empty")

    # If it starts with a digit, extract the numeric prefix
    if layer[0].isdigit():
        if '-' in layer:
            return layer.split('-')[0]
        return layer[:2] if len(layer) >= 2 and layer[1].isdigit() else layer[0]

    # Look up by name
    if layer in LAYER_NAME_TO_NUMBER:
        return LAYER_NAME_TO_NUMBER[layer]

    raise ValueError(f"Unknown layer identifier: {layer}")


def get_layer_number(layer: str) -> str:
    """
    Get the numeric identifier for a layer name.

    This is a convenience function that wraps normalize_layer_identifier
    but only accepts layer names (not numeric identifiers).

    Args:
        layer: Layer name (e.g., 'api', 'data_model')

    Returns:
        Numeric layer identifier (e.g., '06', '07')

    Raises:
        ValueError: If layer name is invalid
    """
    if layer not in LAYER_NAME_TO_NUMBER:
        raise ValueError(f"Unknown layer name: {layer}")

    return LAYER_NAME_TO_NUMBER[layer]
