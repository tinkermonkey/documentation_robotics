"""
WebSocket protocol message definitions for client/server communication.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Message type constants
MESSAGE_TYPES = {
    "initial_state": "Full model state on WebSocket connection",
    "element_updated": "Single element changed",
    "element_added": "New element created",
    "element_removed": "Element deleted",
    "layer_updated": "Entire layer changed",
    "error": "Error message",
}


def create_initial_state_message(
    specification: Dict[str, Any],
    model: Dict[str, Any],
    changesets: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Create initial state message sent on WebSocket connection.

    Args:
        specification: Specification data (metamodel, layer definitions, etc.)
        model: Model data (manifest, layers, elements, relationships)
        changesets: List of available changesets

    Returns:
        Complete initial state message
    """
    return {
        "type": "initial_state",
        "timestamp": _get_timestamp(),
        "data": {
            "specification": specification,
            "model": model,
            "changesets": changesets,
        },
    }


def create_element_update_message(
    change_type: str,
    layer: str,
    element_id: str,
    element_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create element update message for incremental changes.

    Args:
        change_type: Type of change ("updated", "added", "removed")
        layer: Layer name
        element_id: Element ID
        element_data: Element data (optional, not needed for "removed")

    Returns:
        Element update message
    """
    message = {
        "type": f"element_{change_type}",
        "timestamp": _get_timestamp(),
        "data": {
            "layer": layer,
            "element_id": element_id,
        },
    }

    if element_data is not None:
        message["data"]["element"] = element_data

    return message


def create_layer_update_message(layer: str, layer_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create layer update message for complete layer changes.

    Args:
        layer: Layer name
        layer_data: Complete layer data

    Returns:
        Layer update message
    """
    return {
        "type": "layer_updated",
        "timestamp": _get_timestamp(),
        "data": {
            "layer": layer,
            "layer_data": layer_data,
        },
    }


def create_error_message(error: str, details: Optional[str] = None) -> Dict[str, Any]:
    """
    Create error message.

    Args:
        error: Error message
        details: Optional error details

    Returns:
        Error message
    """
    message = {
        "type": "error",
        "timestamp": _get_timestamp(),
        "data": {
            "error": error,
        },
    }

    if details:
        message["data"]["details"] = details

    return message


def _get_timestamp() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
