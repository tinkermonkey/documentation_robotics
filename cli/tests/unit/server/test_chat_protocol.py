"""
Unit tests for chat protocol message functions.

Tests JSON-RPC 2.0 message creation functions for chat communication.
"""

from datetime import datetime

import pytest
from documentation_robotics.server.chat_protocol import (
    CHAT_MESSAGE_TYPES,
    ChatErrorCodes,
    create_chat_cancel,
    create_chat_complete,
    create_chat_error,
    create_chat_request,
    create_chat_response_chunk,
    create_chat_status,
    create_chat_tool_invoke,
    create_chat_tool_result,
)


class TestChatMessageTypes:
    """Test chat message type constants."""

    def test_chat_message_types_defined(self):
        """Test all required chat message types are defined."""
        assert "chat_request" in CHAT_MESSAGE_TYPES
        assert "chat_response_chunk" in CHAT_MESSAGE_TYPES
        assert "chat_tool_invoke" in CHAT_MESSAGE_TYPES
        assert "chat_tool_result" in CHAT_MESSAGE_TYPES
        assert "chat_complete" in CHAT_MESSAGE_TYPES
        assert "chat_error" in CHAT_MESSAGE_TYPES
        assert "chat_cancel" in CHAT_MESSAGE_TYPES
        assert "chat_status" in CHAT_MESSAGE_TYPES

    def test_chat_message_types_have_descriptions(self):
        """Test all chat message types have descriptions."""
        for msg_type, description in CHAT_MESSAGE_TYPES.items():
            assert isinstance(msg_type, str)
            assert isinstance(description, str)
            assert len(description) > 0


class TestCreateChatRequest:
    """Test chat request message creation."""

    def test_create_chat_request_structure(self):
        """Test chat request message has correct JSON-RPC 2.0 structure."""
        message = create_chat_request(
            message="Which APIs model the Product entities?",
            conversation_id="conv-123",
            request_id="req-456",
        )

        assert message["jsonrpc"] == "2.0"
        assert message["method"] == "chat.send"
        assert message["id"] == "req-456"
        assert "params" in message

    def test_create_chat_request_params(self):
        """Test chat request message parameters."""
        user_message = "Show me all business services"
        conversation_id = "conv-abc"

        message = create_chat_request(user_message, conversation_id, "req-1")

        assert message["params"]["message"] == user_message
        assert message["params"]["conversation_id"] == conversation_id

    def test_create_chat_request_with_special_characters(self):
        """Test chat request with special characters and unicode."""
        user_message = "Find APIs with names like 'customer-service' \u2192 version 2.0"

        message = create_chat_request(user_message, "conv-1", "req-1")

        assert message["params"]["message"] == user_message


class TestCreateChatResponseChunk:
    """Test chat response chunk message creation."""

    def test_create_chat_response_chunk_structure(self):
        """Test response chunk has correct JSON-RPC 2.0 notification structure."""
        message = create_chat_response_chunk(
            conversation_id="conv-123",
            content="The Product entities are modeled by...",
        )

        assert message["jsonrpc"] == "2.0"
        assert message["method"] == "chat.response.chunk"
        assert "id" not in message  # Notifications don't have id
        assert "params" in message

    def test_create_chat_response_chunk_params(self):
        """Test response chunk parameters."""
        conversation_id = "conv-123"
        content = "Here is your answer..."

        message = create_chat_response_chunk(conversation_id, content)

        assert message["params"]["conversation_id"] == conversation_id
        assert message["params"]["content"] == content
        assert message["params"]["is_final"] is False
        assert "timestamp" in message["params"]

    def test_create_chat_response_chunk_final(self):
        """Test final response chunk."""
        message = create_chat_response_chunk("conv-1", "Final chunk", is_final=True)

        assert message["params"]["is_final"] is True

    def test_create_chat_response_chunk_has_timestamp(self):
        """Test response chunk includes timestamp."""
        message = create_chat_response_chunk("conv-1", "content")

        assert "timestamp" in message["params"]
        assert isinstance(message["params"]["timestamp"], str)
        assert message["params"]["timestamp"].endswith("Z")


class TestCreateChatToolInvoke:
    """Test chat tool invocation message creation."""

    def test_create_chat_tool_invoke_structure(self):
        """Test tool invoke message has correct JSON-RPC 2.0 structure."""
        message = create_chat_tool_invoke(
            conversation_id="conv-123",
            tool_name="dr list api operation",
        )

        assert message["jsonrpc"] == "2.0"
        assert message["method"] == "chat.tool.invoke"
        assert "id" not in message  # Notification
        assert "params" in message

    def test_create_chat_tool_invoke_params(self):
        """Test tool invoke message parameters."""
        conversation_id = "conv-123"
        tool_name = "dr search"
        tool_input = {"query": "Product", "layer": "api"}

        message = create_chat_tool_invoke(
            conversation_id=conversation_id,
            tool_name=tool_name,
            tool_input=tool_input,
        )

        assert message["params"]["conversation_id"] == conversation_id
        assert message["params"]["tool_name"] == tool_name
        assert message["params"]["tool_input"] == tool_input
        assert message["params"]["status"] == "executing"
        assert "timestamp" in message["params"]

    def test_create_chat_tool_invoke_without_input(self):
        """Test tool invoke message without input parameters."""
        message = create_chat_tool_invoke(
            conversation_id="conv-1",
            tool_name="dr list business service",
        )

        assert message["params"]["tool_input"] is None

    def test_create_chat_tool_invoke_custom_status(self):
        """Test tool invoke with custom status."""
        message = create_chat_tool_invoke(
            conversation_id="conv-1",
            tool_name="dr trace",
            status="completed",
        )

        assert message["params"]["status"] == "completed"


class TestCreateChatToolResult:
    """Test chat tool result message creation."""

    def test_create_chat_tool_result_structure(self):
        """Test tool result message has correct JSON-RPC 2.0 structure."""
        message = create_chat_tool_result(
            conversation_id="conv-123",
            tool_name="dr search",
            result={"elements": []},
        )

        assert message["jsonrpc"] == "2.0"
        assert message["method"] == "chat.tool.result"
        assert "id" not in message  # Notification
        assert "params" in message

    def test_create_chat_tool_result_success(self):
        """Test successful tool result."""
        conversation_id = "conv-123"
        tool_name = "dr list api operation"
        result = {
            "elements": [
                {"id": "api.operation.getProduct", "name": "Get Product"},
                {"id": "api.operation.createProduct", "name": "Create Product"},
            ]
        }

        message = create_chat_tool_result(
            conversation_id=conversation_id,
            tool_name=tool_name,
            result=result,
        )

        assert message["params"]["conversation_id"] == conversation_id
        assert message["params"]["tool_name"] == tool_name
        assert message["params"]["result"] == result
        assert message["params"]["success"] is True
        assert "timestamp" in message["params"]

    def test_create_chat_tool_result_failure(self):
        """Test failed tool result."""
        message = create_chat_tool_result(
            conversation_id="conv-1",
            tool_name="dr search",
            result={"error": "Pattern not found"},
            success=False,
        )

        assert message["params"]["success"] is False
        assert "error" in message["params"]["result"]


class TestCreateChatComplete:
    """Test chat complete message creation."""

    def test_create_chat_complete_structure(self):
        """Test complete message has correct JSON-RPC 2.0 response structure."""
        message = create_chat_complete(
            conversation_id="conv-123",
            request_id="req-456",
        )

        assert message["jsonrpc"] == "2.0"
        assert "result" in message
        assert message["id"] == "req-456"
        assert "error" not in message

    def test_create_chat_complete_result(self):
        """Test complete message result."""
        conversation_id = "conv-123"
        request_id = "req-456"

        message = create_chat_complete(conversation_id, request_id)

        assert message["result"]["conversation_id"] == conversation_id
        assert message["result"]["status"] == "complete"
        assert message["result"]["total_cost_usd"] is None
        assert "timestamp" in message["result"]

    def test_create_chat_complete_with_cost(self):
        """Test complete message with cost information."""
        message = create_chat_complete(
            conversation_id="conv-1",
            request_id="req-1",
            total_cost_usd=0.0042,
        )

        assert message["result"]["total_cost_usd"] == 0.0042

    def test_create_chat_complete_has_timestamp(self):
        """Test complete message includes timestamp."""
        message = create_chat_complete("conv-1", "req-1")

        assert "timestamp" in message["result"]
        assert message["result"]["timestamp"].endswith("Z")


class TestCreateChatError:
    """Test chat error message creation."""

    def test_create_chat_error_structure(self):
        """Test error message has correct JSON-RPC 2.0 error structure."""
        message = create_chat_error(
            request_id="req-456",
            code=-32603,
            message="Internal error",
        )

        assert message["jsonrpc"] == "2.0"
        assert "error" in message
        assert message["id"] == "req-456"
        assert "result" not in message

    def test_create_chat_error_fields(self):
        """Test error message fields."""
        request_id = "req-456"
        code = ChatErrorCodes.INVALID_REQUEST
        error_msg = "Invalid request format"

        message = create_chat_error(request_id, code, error_msg)

        assert message["error"]["code"] == code
        assert message["error"]["message"] == error_msg
        assert "data" not in message["error"]

    def test_create_chat_error_with_data(self):
        """Test error message with additional data."""
        data = {"field": "message", "reason": "Required field missing"}

        message = create_chat_error(
            request_id="req-1",
            code=ChatErrorCodes.INVALID_PARAMS,
            message="Invalid parameters",
            data=data,
        )

        assert message["error"]["data"] == data

    def test_create_chat_error_without_request_id(self):
        """Test error message without request ID (parse errors)."""
        message = create_chat_error(
            request_id=None,
            code=ChatErrorCodes.PARSE_ERROR,
            message="Parse error",
        )

        assert message["id"] is None

    def test_create_chat_error_with_standard_codes(self):
        """Test error messages with standard JSON-RPC error codes."""
        standard_errors = [
            (ChatErrorCodes.PARSE_ERROR, "Parse error"),
            (ChatErrorCodes.INVALID_REQUEST, "Invalid request"),
            (ChatErrorCodes.METHOD_NOT_FOUND, "Method not found"),
            (ChatErrorCodes.INVALID_PARAMS, "Invalid params"),
            (ChatErrorCodes.INTERNAL_ERROR, "Internal error"),
        ]

        for code, msg in standard_errors:
            message = create_chat_error("req-1", code, msg)
            assert message["error"]["code"] == code
            assert message["error"]["message"] == msg

    def test_create_chat_error_with_custom_codes(self):
        """Test error messages with custom error codes."""
        custom_errors = [
            (ChatErrorCodes.SDK_UNAVAILABLE, "SDK unavailable"),
            (ChatErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required"),
            (ChatErrorCodes.OPERATION_CANCELLED, "Operation cancelled"),
            (ChatErrorCodes.VALIDATION_FAILED, "Validation failed"),
        ]

        for code, msg in custom_errors:
            message = create_chat_error("req-1", code, msg)
            assert message["error"]["code"] == code
            assert message["error"]["message"] == msg


class TestCreateChatCancel:
    """Test chat cancel message creation."""

    def test_create_chat_cancel_structure(self):
        """Test cancel message has correct JSON-RPC 2.0 structure."""
        message = create_chat_cancel(
            conversation_id="conv-123",
            request_id="req-cancel",
        )

        assert message["jsonrpc"] == "2.0"
        assert message["method"] == "chat.cancel"
        assert message["id"] == "req-cancel"
        assert "params" in message

    def test_create_chat_cancel_params(self):
        """Test cancel message parameters."""
        conversation_id = "conv-123"
        request_id = "req-cancel"

        message = create_chat_cancel(conversation_id, request_id)

        assert message["params"]["conversation_id"] == conversation_id


class TestCreateChatStatus:
    """Test chat status message creation."""

    def test_create_chat_status_structure(self):
        """Test status message has correct JSON-RPC 2.0 notification structure."""
        message = create_chat_status(sdk_available=True)

        assert message["jsonrpc"] == "2.0"
        assert message["method"] == "chat.status"
        assert "id" not in message  # Notification
        assert "params" in message

    def test_create_chat_status_sdk_available(self):
        """Test status message with SDK available."""
        message = create_chat_status(
            sdk_available=True,
            sdk_version="1.2.3",
        )

        assert message["params"]["sdk_available"] is True
        assert message["params"]["sdk_version"] == "1.2.3"
        assert message["params"]["error_message"] is None
        assert "timestamp" in message["params"]

    def test_create_chat_status_sdk_unavailable(self):
        """Test status message with SDK unavailable."""
        error_msg = "Claude Agent SDK not installed"

        message = create_chat_status(
            sdk_available=False,
            error_message=error_msg,
        )

        assert message["params"]["sdk_available"] is False
        assert message["params"]["sdk_version"] is None
        assert message["params"]["error_message"] == error_msg

    def test_create_chat_status_has_timestamp(self):
        """Test status message includes timestamp."""
        message = create_chat_status(sdk_available=True)

        assert "timestamp" in message["params"]
        assert message["params"]["timestamp"].endswith("Z")


class TestChatErrorCodes:
    """Test error code constants."""

    def test_standard_jsonrpc_error_codes(self):
        """Test standard JSON-RPC 2.0 error codes are defined."""
        assert ChatErrorCodes.PARSE_ERROR == -32700
        assert ChatErrorCodes.INVALID_REQUEST == -32600
        assert ChatErrorCodes.METHOD_NOT_FOUND == -32601
        assert ChatErrorCodes.INVALID_PARAMS == -32602
        assert ChatErrorCodes.INTERNAL_ERROR == -32603

    def test_custom_error_codes(self):
        """Test custom application error codes are defined."""
        assert ChatErrorCodes.SDK_UNAVAILABLE == -32001
        assert ChatErrorCodes.AUTHENTICATION_REQUIRED == -32002
        assert ChatErrorCodes.OPERATION_CANCELLED == -32003
        assert ChatErrorCodes.VALIDATION_FAILED == -32004

    def test_custom_codes_in_valid_range(self):
        """Test custom error codes are in server error range."""
        # JSON-RPC 2.0 reserves -32000 to -32099 for server errors
        custom_codes = [
            ChatErrorCodes.SDK_UNAVAILABLE,
            ChatErrorCodes.AUTHENTICATION_REQUIRED,
            ChatErrorCodes.OPERATION_CANCELLED,
            ChatErrorCodes.VALIDATION_FAILED,
        ]

        for code in custom_codes:
            assert -32099 <= code <= -32000


class TestTimestamps:
    """Test timestamp generation in chat messages."""

    def test_timestamp_format(self):
        """Test timestamp is in ISO 8601 format with Z suffix."""
        message = create_chat_response_chunk("conv-1", "content")
        timestamp = message["params"]["timestamp"]

        # Should be parseable as ISO datetime
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            assert dt is not None
        except ValueError:
            pytest.fail(f"Invalid timestamp format: {timestamp}")

    def test_timestamps_are_recent(self):
        """Test timestamps are current."""
        message = create_chat_status(sdk_available=True)
        timestamp = message["params"]["timestamp"]

        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        now = datetime.now(dt.tzinfo)

        # Timestamp should be within last second
        diff = (now - dt).total_seconds()
        assert diff < 1.0


class TestJsonRpcCompliance:
    """Test JSON-RPC 2.0 compliance."""

    def test_all_messages_have_jsonrpc_field(self):
        """Test all messages include jsonrpc field with version 2.0."""
        messages = [
            create_chat_request("msg", "conv-1", "req-1"),
            create_chat_response_chunk("conv-1", "content"),
            create_chat_tool_invoke("conv-1", "tool"),
            create_chat_tool_result("conv-1", "tool", {}),
            create_chat_complete("conv-1", "req-1"),
            create_chat_error("req-1", -32603, "error"),
            create_chat_cancel("conv-1", "req-1"),
            create_chat_status(True),
        ]

        for message in messages:
            assert "jsonrpc" in message
            assert message["jsonrpc"] == "2.0"

    def test_requests_have_id(self):
        """Test request messages have id field."""
        requests = [
            create_chat_request("msg", "conv-1", "req-1"),
            create_chat_cancel("conv-1", "req-2"),
        ]

        for request in requests:
            assert "id" in request
            assert request["id"] is not None

    def test_notifications_have_no_id(self):
        """Test notification messages don't have id field."""
        notifications = [
            create_chat_response_chunk("conv-1", "content"),
            create_chat_tool_invoke("conv-1", "tool"),
            create_chat_tool_result("conv-1", "tool", {}),
            create_chat_status(True),
        ]

        for notification in notifications:
            assert "id" not in notification

    def test_responses_have_id(self):
        """Test response messages have id field."""
        responses = [
            create_chat_complete("conv-1", "req-1"),
            create_chat_error("req-2", -32603, "error"),
        ]

        for response in responses:
            assert "id" in response

    def test_requests_have_method(self):
        """Test request messages have method field."""
        requests = [
            create_chat_request("msg", "conv-1", "req-1"),
            create_chat_cancel("conv-1", "req-2"),
        ]

        for request in requests:
            assert "method" in request
            assert isinstance(request["method"], str)

    def test_notifications_have_method(self):
        """Test notification messages have method field."""
        notifications = [
            create_chat_response_chunk("conv-1", "content"),
            create_chat_tool_invoke("conv-1", "tool"),
            create_chat_tool_result("conv-1", "tool", {}),
            create_chat_status(True),
        ]

        for notification in notifications:
            assert "method" in notification
            assert isinstance(notification["method"], str)

    def test_success_responses_have_result(self):
        """Test successful response messages have result field."""
        message = create_chat_complete("conv-1", "req-1")

        assert "result" in message
        assert "error" not in message

    def test_error_responses_have_error(self):
        """Test error response messages have error field."""
        message = create_chat_error("req-1", -32603, "error")

        assert "error" in message
        assert "result" not in message

    def test_error_has_code_and_message(self):
        """Test error object has code and message fields."""
        message = create_chat_error("req-1", -32603, "Internal error")

        assert "code" in message["error"]
        assert "message" in message["error"]
        assert isinstance(message["error"]["code"], int)
        assert isinstance(message["error"]["message"], str)


class TestEdgeCases:
    """Test edge cases and special values."""

    def test_empty_message_content(self):
        """Test chat request with empty message."""
        message = create_chat_request("", "conv-1", "req-1")

        assert message["params"]["message"] == ""

    def test_very_long_message(self):
        """Test chat request with very long message."""
        long_message = "A" * 10000

        message = create_chat_request(long_message, "conv-1", "req-1")

        assert len(message["params"]["message"]) == 10000

    def test_unicode_in_messages(self):
        """Test messages with unicode characters."""
        unicode_msg = "Message with emoji: \U0001F916 and symbols: \u2192 \u2713"

        message = create_chat_request(unicode_msg, "conv-1", "req-1")

        assert message["params"]["message"] == unicode_msg

    def test_special_characters_in_conversation_id(self):
        """Test conversation ID with special characters."""
        conv_id = "conv-user_123-session.2024-12-13"

        message = create_chat_request("msg", conv_id, "req-1")

        assert message["params"]["conversation_id"] == conv_id

    def test_complex_tool_result_data(self):
        """Test tool result with complex nested data."""
        complex_result = {
            "elements": [
                {
                    "id": "api.operation.get",
                    "relationships": [
                        {"type": "uses", "target": "datamodel.entity.product"},
                        {"type": "implements", "target": "business.service.catalog"},
                    ],
                    "metadata": {"tags": ["v2", "public"], "deprecated": False},
                }
            ],
            "summary": {"total": 1, "by_layer": {"api": 1}},
        }

        message = create_chat_tool_result("conv-1", "dr search", complex_result)

        assert message["params"]["result"] == complex_result

    def test_null_request_id_in_error(self):
        """Test error message with null request ID."""
        message = create_chat_error(None, ChatErrorCodes.PARSE_ERROR, "Parse error")

        assert message["id"] is None

    def test_zero_cost(self):
        """Test complete message with zero cost."""
        message = create_chat_complete("conv-1", "req-1", total_cost_usd=0.0)

        assert message["result"]["total_cost_usd"] == 0.0
