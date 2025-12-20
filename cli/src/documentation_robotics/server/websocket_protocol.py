"""
WebSocket protocol message definitions for client/server communication.
"""

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from ..core.annotations import Annotation

# Message type constants
MESSAGE_TYPES = {
    # Existing model synchronization types
    "initial_state": "Full model state on WebSocket connection",
    "element_updated": "Single element changed",
    "element_added": "New element created",
    "element_removed": "Element deleted",
    "layer_updated": "Entire layer changed",
    "error": "Error message",
    # Chat message types (JSON-RPC 2.0)
    "chat_request": "User message to DrBot",
    "chat_response_chunk": "DrBot response chunk (streaming)",
    "chat_tool_invoke": "DrBot tool invocation notification",
    "chat_tool_result": "Tool execution result",
    "chat_complete": "Response complete signal",
    "chat_error": "Chat-specific error",
    "chat_cancel": "Cancel ongoing operation",
    "chat_status": "SDK availability status",
    # Annotation message types
    "annotation_added": "Annotation created",
    "annotation_reply_added": "Reply to annotation created",
    # Spec-aligned message types
    "connected": "Server greeting with version",
    "subscribed": "Server acknowledgement of topic subscriptions",
    "pong": "Heartbeat response",
    "model.updated": "Model changed (any element/layer updates)",
    "changeset.created": "New changeset created",
    "annotation.added": "Annotation created",
    "annotation.updated": "Annotation updated",
    "annotation.deleted": "Annotation deleted",
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
        "timestamp": get_timestamp(),
        "data": {
            "specification": specification,
            "model": model,
            "changesets": changesets,
        },
    }


def create_connected_message(version: str) -> Dict[str, Any]:
    """Create spec-aligned connected message with backward-compatible text."""
    return {"type": "connected", "version": version, "message": "WebSocket connection established"}


def create_subscribed_message(topics: List[str]) -> Dict[str, Any]:
    """Create spec-aligned subscribed message."""
    return {"type": "subscribed", "topics": topics}


def create_pong_message() -> Dict[str, Any]:
    """Create spec-aligned pong message."""
    return {"type": "pong"}


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
        "timestamp": get_timestamp(),
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
        "timestamp": get_timestamp(),
        "data": {
            "layer": layer,
            "layer_data": layer_data,
        },
    }


def create_model_updated_message() -> Dict[str, Any]:
    """Create spec-aligned model.updated message."""
    return {"type": "model.updated", "timestamp": get_timestamp()}


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
        "timestamp": get_timestamp(),
        "data": {
            "error": error,
        },
    }

    if details:
        message["data"]["details"] = details

    return message


def create_annotation_added_message(annotation: "Annotation") -> Dict[str, Any]:
    """
    Create legacy annotation_added WebSocket message (used in unit tests).

    Args:
        annotation: Annotation object from core.annotations

    Returns:
        WebSocket message dict with nested data per legacy format
    """
    return {
        "type": "annotation_added",
        "timestamp": get_timestamp(),
        "data": {
            "id": annotation.id,
            "entity_uri": annotation.entity_uri,
            "timestamp": annotation.timestamp,
            "user": annotation.user,
            "message": annotation.message,
            "parent_id": annotation.parent_id,
        },
    }


def create_annotation_reply_added_message(reply: "Annotation") -> Dict[str, Any]:
    """
    Create legacy annotation_reply_added WebSocket message (used in unit tests).

    Args:
        reply: Annotation object representing a reply

    Returns:
        WebSocket message dict with nested data per legacy format
    """
    return {
        "type": "annotation_reply_added",
        "timestamp": get_timestamp(),
        "data": {
            "id": reply.id,
            "entity_uri": reply.entity_uri,
            "timestamp": reply.timestamp,
            "user": reply.user,
            "message": reply.message,
            "parent_id": reply.parent_id,
        },
    }


def create_annotation_updated_message(annotation_id: str) -> Dict[str, Any]:
    """Create spec-aligned annotation.updated message."""
    return {
        "type": "annotation.updated",
        "annotationId": annotation_id,
        "timestamp": get_timestamp(),
    }


def create_annotation_deleted_message(annotation_id: str) -> Dict[str, Any]:
    """Create spec-aligned annotation.deleted message."""
    return {
        "type": "annotation.deleted",
        "annotationId": annotation_id,
        "timestamp": get_timestamp(),
    }


def create_changeset_created_message(changeset_id: str) -> Dict[str, Any]:
    """Create spec-aligned changeset.created message."""
    return {"type": "changeset.created", "changesetId": changeset_id, "timestamp": get_timestamp()}


def get_timestamp() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
