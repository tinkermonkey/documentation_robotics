"""Unit tests for Claude Agent SDK detection."""

import sys
from unittest.mock import patch

from documentation_robotics.server.sdk_detector import SDKStatus, detect_claude_agent_sdk


class TestSDKDetector:
    """Tests for SDK detection functionality."""

    def test_detect_sdk_available(self):
        """Test detection when SDK is available."""
        # Create a mock module
        mock_module = type(sys)("claude_agent_sdk")
        mock_module.__version__ = "1.0.0"
        mock_module.query = lambda: None
        mock_module.ClaudeAgentOptions = object

        # Mock the import
        with patch.dict(sys.modules, {"claude_agent_sdk": mock_module}):
            status = detect_claude_agent_sdk()

            assert status.available is True
            assert status.version == "1.0.0"
            assert status.error is None

    def test_detect_sdk_available_no_version(self):
        """Test detection when SDK is available but version is unknown."""
        # Create a mock module without version
        mock_module = type(sys)("claude_agent_sdk")
        mock_module.query = lambda: None
        mock_module.ClaudeAgentOptions = object

        with patch.dict(sys.modules, {"claude_agent_sdk": mock_module}):
            status = detect_claude_agent_sdk()

            assert status.available is True
            assert status.version == "unknown"
            assert status.error is None

    def test_detect_sdk_unavailable(self):
        """Test detection when SDK is not installed."""
        # Mock ImportError
        with patch.dict(sys.modules, {"claude_agent_sdk": None}):
            # Force import to fail
            with patch(
                "builtins.__import__", side_effect=ImportError("No module named 'claude_agent_sdk'")
            ):
                status = detect_claude_agent_sdk()

                assert status.available is False
                assert status.version is None
                assert "Claude Agent SDK not installed" in status.error
                assert "pip install claude-agent-sdk" in status.error

    def test_sdk_status_dataclass(self):
        """Test SDKStatus dataclass structure."""
        status = SDKStatus(available=True, version="1.0.0", error=None)

        assert status.available is True
        assert status.version == "1.0.0"
        assert status.error is None

    def test_sdk_status_defaults(self):
        """Test SDKStatus default values."""
        status = SDKStatus(available=False)

        assert status.available is False
        assert status.version is None
        assert status.error is None
