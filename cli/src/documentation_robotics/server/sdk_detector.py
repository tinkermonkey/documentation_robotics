"""Claude Agent SDK availability detection."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class SDKStatus:
    """Claude Agent SDK availability status."""

    available: bool
    version: Optional[str] = None
    error: Optional[str] = None


def detect_claude_agent_sdk() -> SDKStatus:
    """
    Check if Claude Agent SDK is available and configured.

    Returns:
        SDKStatus indicating availability, version, and any errors
    """
    try:
        from claude_agent_sdk import query, ClaudeAgentOptions  # noqa: F401

        # Try to get version
        try:
            import claude_agent_sdk

            version = getattr(claude_agent_sdk, "__version__", "unknown")
        except Exception:
            version = "unknown"

        return SDKStatus(available=True, version=version)
    except ImportError:
        return SDKStatus(
            available=False,
            error="Claude Agent SDK not installed. Run: pip install claude-agent-sdk",
        )
