"""
Server infrastructure for visualization.
"""

from .chat_handler import ChatHandler
from .chat_protocol import ChatErrorCodes
from .chat_session import ChatMessage, ChatSession, SessionManager
from .sdk_detector import SDKStatus, detect_claude_agent_sdk
from .visualization_server import VisualizationServer
from .websocket_protocol import (
    MESSAGE_TYPES,
    create_element_update_message,
    create_error_message,
    create_initial_state_message,
)

__all__ = [
    # Core server
    "VisualizationServer",
    # WebSocket protocol
    "MESSAGE_TYPES",
    "create_initial_state_message",
    "create_element_update_message",
    "create_error_message",
    # Chat components
    "ChatHandler",
    "ChatSession",
    "ChatMessage",
    "SessionManager",
    "ChatErrorCodes",
    # SDK detection
    "SDKStatus",
    "detect_claude_agent_sdk",
]
