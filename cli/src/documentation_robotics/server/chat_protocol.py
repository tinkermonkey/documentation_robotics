"""
Chat protocol message definitions for JSON-RPC 2.0 over WebSocket.

This module provides message factory functions for chat communication
between the client and DrBot using JSON-RPC 2.0 semantics.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Chat message type constants
CHAT_MESSAGE_TYPES = {
    "chat_request": "User message to DrBot",
    "chat_response_chunk": "DrBot response chunk (streaming)",
    "chat_tool_invoke": "DrBot tool invocation notification",
    "chat_tool_result": "Tool execution result",
    "chat_complete": "Response complete signal",
    "chat_error": "Chat-specific error",
    "chat_cancel": "Cancel ongoing operation",
    "chat_status": "SDK availability status",
}


def create_chat_request(
    message: str,
    conversation_id: str,
    request_id: str,
) -> Dict[str, Any]:
    """
    Create JSON-RPC 2.0 chat request message.

    Args:
        message: User's chat message
        conversation_id: Unique conversation identifier
        request_id: Unique request identifier

    Returns:
        JSON-RPC 2.0 request message
    """
    return {
        "jsonrpc": "2.0",
        "method": "chat.send",
        "params": {
            "message": message,
            "conversation_id": conversation_id,
        },
        "id": request_id,
    }


def create_chat_response_chunk(
    conversation_id: str,
    content: str,
    is_final: bool = False,
) -> Dict[str, Any]:
    """
    Create streaming response notification.

    Args:
        conversation_id: Unique conversation identifier
        content: Response content chunk
        is_final: Whether this is the final chunk

    Returns:
        JSON-RPC 2.0 notification message
    """
    return {
        "jsonrpc": "2.0",
        "method": "chat.response.chunk",
        "params": {
            "conversation_id": conversation_id,
            "content": content,
            "is_final": is_final,
            "timestamp": _get_timestamp(),
        },
    }


def create_chat_tool_invoke(
    conversation_id: str,
    tool_name: str,
    tool_input: Optional[Dict[str, Any]] = None,
    status: str = "executing",
) -> Dict[str, Any]:
    """
    Create tool invocation notification.

    Args:
        conversation_id: Unique conversation identifier
        tool_name: Name of the tool being invoked
        tool_input: Tool input parameters (optional)
        status: Tool execution status

    Returns:
        JSON-RPC 2.0 notification message
    """
    return {
        "jsonrpc": "2.0",
        "method": "chat.tool.invoke",
        "params": {
            "conversation_id": conversation_id,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "status": status,
            "timestamp": _get_timestamp(),
        },
    }


def create_chat_tool_result(
    conversation_id: str,
    tool_name: str,
    result: Any,
    success: bool = True,
) -> Dict[str, Any]:
    """
    Create tool result notification.

    Args:
        conversation_id: Unique conversation identifier
        tool_name: Name of the tool that was invoked
        result: Tool execution result
        success: Whether the tool execution was successful

    Returns:
        JSON-RPC 2.0 notification message
    """
    return {
        "jsonrpc": "2.0",
        "method": "chat.tool.result",
        "params": {
            "conversation_id": conversation_id,
            "tool_name": tool_name,
            "result": result,
            "success": success,
            "timestamp": _get_timestamp(),
        },
    }


def create_chat_complete(
    conversation_id: str,
    request_id: str,
    total_cost_usd: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Create response complete message (JSON-RPC result).

    Args:
        conversation_id: Unique conversation identifier
        request_id: Request ID this response corresponds to
        total_cost_usd: Optional total cost of the operation

    Returns:
        JSON-RPC 2.0 response message
    """
    return {
        "jsonrpc": "2.0",
        "result": {
            "conversation_id": conversation_id,
            "status": "complete",
            "total_cost_usd": total_cost_usd,
            "timestamp": _get_timestamp(),
        },
        "id": request_id,
    }


def create_chat_error(
    request_id: Optional[str],
    code: int,
    message: str,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create JSON-RPC 2.0 error response.

    Args:
        request_id: Request ID this error corresponds to (None for parse errors)
        code: Error code (see ChatErrorCodes)
        message: Human-readable error message
        data: Optional additional error data

    Returns:
        JSON-RPC 2.0 error response message
    """
    error: Dict[str, Any] = {
        "code": code,
        "message": message,
    }
    if data:
        error["data"] = data

    return {
        "jsonrpc": "2.0",
        "error": error,
        "id": request_id,
    }


def create_chat_cancel(
    conversation_id: str,
    request_id: str,
) -> Dict[str, Any]:
    """
    Create cancellation request.

    Args:
        conversation_id: Unique conversation identifier
        request_id: Unique request identifier

    Returns:
        JSON-RPC 2.0 request message
    """
    return {
        "jsonrpc": "2.0",
        "method": "chat.cancel",
        "params": {
            "conversation_id": conversation_id,
        },
        "id": request_id,
    }


def create_chat_status(
    sdk_available: bool,
    sdk_version: Optional[str] = None,
    error_message: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create SDK status notification.

    Args:
        sdk_available: Whether the Claude Agent SDK is available
        sdk_version: SDK version if available
        error_message: Error message if SDK is not available

    Returns:
        JSON-RPC 2.0 notification message
    """
    return {
        "jsonrpc": "2.0",
        "method": "chat.status",
        "params": {
            "sdk_available": sdk_available,
            "sdk_version": sdk_version,
            "error_message": error_message,
            "timestamp": _get_timestamp(),
        },
    }


class ChatErrorCodes:
    """JSON-RPC 2.0 error codes for chat operations."""

    # Standard JSON-RPC 2.0 error codes
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603

    # Custom error codes (application-defined range)
    SDK_UNAVAILABLE = -32001
    AUTHENTICATION_REQUIRED = -32002
    OPERATION_CANCELLED = -32003
    VALIDATION_FAILED = -32004


def _get_timestamp() -> str:
    """Get current timestamp in ISO 8601 format (UTC)."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
