"""
Unit tests for WebSocket protocol message functions.

Tests message creation functions for client/server communication.
"""

from datetime import datetime

import pytest
from documentation_robotics.server.websocket_protocol import (
    MESSAGE_TYPES,
    create_annotation_added_message,
    create_annotation_reply_added_message,
    create_element_update_message,
    create_error_message,
    create_initial_state_message,
    create_layer_update_message,
)


class TestMessageTypes:
    """Test message type constants."""

    def test_message_types_defined(self):
        """Test all required message types are defined."""
        assert "initial_state" in MESSAGE_TYPES
        assert "element_updated" in MESSAGE_TYPES
        assert "element_added" in MESSAGE_TYPES
        assert "element_removed" in MESSAGE_TYPES
        assert "layer_updated" in MESSAGE_TYPES
        assert "error" in MESSAGE_TYPES
        assert "annotation_added" in MESSAGE_TYPES
        assert "annotation_reply_added" in MESSAGE_TYPES

    def test_message_types_have_descriptions(self):
        """Test all message types have descriptions."""
        for msg_type, description in MESSAGE_TYPES.items():
            assert isinstance(msg_type, str)
            assert isinstance(description, str)
            assert len(description) > 0


class TestCreateInitialStateMessage:
    """Test initial state message creation."""

    def test_create_initial_state_message_structure(self):
        """Test initial state message has correct structure."""
        spec = {"version": "0.5.0", "layers": []}
        model = {"manifest": {}, "layers": []}
        changesets = []

        message = create_initial_state_message(spec, model, changesets)

        assert message["type"] == "initial_state"
        assert "timestamp" in message
        assert "data" in message
        assert message["data"]["specification"] == spec
        assert message["data"]["model"] == model
        assert message["data"]["changesets"] == changesets

    def test_create_initial_state_with_complete_data(self):
        """Test initial state message with complete data."""
        spec = {
            "version": "0.5.0",
            "layers": ["business", "application"],
            "relationships": [],
        }
        model = {
            "manifest": {"version": "1.0.0"},
            "layers": [
                {
                    "name": "business",
                    "elements": [{"id": "business.service.customer", "name": "Customer Service"}],
                }
            ],
        }
        changesets = [
            {
                "id": "changeset-1",
                "name": "Feature 1",
                "status": "active",
            }
        ]

        message = create_initial_state_message(spec, model, changesets)

        assert message["data"]["specification"]["version"] == "0.5.0"
        assert message["data"]["model"]["manifest"]["version"] == "1.0.0"
        assert len(message["data"]["model"]["layers"]) == 1
        assert len(message["data"]["changesets"]) == 1

    def test_create_initial_state_empty_data(self):
        """Test initial state message with empty data."""
        spec = {}
        model = {}
        changesets = []

        message = create_initial_state_message(spec, model, changesets)

        assert message["data"]["specification"] == {}
        assert message["data"]["model"] == {}
        assert message["data"]["changesets"] == []

    def test_create_initial_state_has_timestamp(self):
        """Test initial state message includes timestamp."""
        spec = {}
        model = {}
        changesets = []

        message = create_initial_state_message(spec, model, changesets)

        assert "timestamp" in message
        assert isinstance(message["timestamp"], str)
        # Should be ISO format with Z suffix
        assert message["timestamp"].endswith("Z")


class TestCreateElementUpdateMessage:
    """Test element update message creation."""

    def test_create_element_added_message(self):
        """Test element added message."""
        element_data = {
            "id": "business.service.new",
            "name": "New Service",
            "type": "BusinessService",
        }

        message = create_element_update_message(
            "added", "business", "business.service.new", element_data
        )

        assert message["type"] == "element_added"
        assert "timestamp" in message
        assert message["data"]["layer"] == "business"
        assert message["data"]["element_id"] == "business.service.new"
        assert message["data"]["element"] == element_data

    def test_create_element_updated_message(self):
        """Test element updated message."""
        element_data = {
            "id": "business.service.existing",
            "name": "Updated Service",
            "type": "BusinessService",
        }

        message = create_element_update_message(
            "updated", "business", "business.service.existing", element_data
        )

        assert message["type"] == "element_updated"
        assert message["data"]["element_id"] == "business.service.existing"
        assert message["data"]["element"] == element_data

    def test_create_element_removed_message(self):
        """Test element removed message without element data."""
        message = create_element_update_message("removed", "business", "business.service.deleted")

        assert message["type"] == "element_removed"
        assert message["data"]["layer"] == "business"
        assert message["data"]["element_id"] == "business.service.deleted"
        assert "element" not in message["data"]

    def test_create_element_update_with_none_data(self):
        """Test element update with None element_data."""
        message = create_element_update_message(
            "removed", "application", "app.component.test", None
        )

        assert message["type"] == "element_removed"
        assert "element" not in message["data"]

    def test_create_element_update_different_layers(self):
        """Test element updates for different layers."""
        layers = ["business", "application", "api", "datamodel"]

        for layer in layers:
            message = create_element_update_message("updated", layer, f"{layer}.elem.test", {})

            assert message["data"]["layer"] == layer

    def test_create_element_update_has_timestamp(self):
        """Test element update message includes timestamp."""
        message = create_element_update_message("updated", "business", "elem-1", {})

        assert "timestamp" in message
        assert message["timestamp"].endswith("Z")


class TestCreateLayerUpdateMessage:
    """Test layer update message creation."""

    def test_create_layer_update_message(self):
        """Test layer update message creation."""
        layer_data = {
            "name": "business",
            "elements": [
                {"id": "elem-1", "name": "Element 1"},
                {"id": "elem-2", "name": "Element 2"},
            ],
        }

        message = create_layer_update_message("business", layer_data)

        assert message["type"] == "layer_updated"
        assert "timestamp" in message
        assert message["data"]["layer"] == "business"
        assert message["data"]["layer_data"] == layer_data

    def test_create_layer_update_empty_layer(self):
        """Test layer update with empty layer data."""
        layer_data = {"name": "empty", "elements": []}

        message = create_layer_update_message("empty", layer_data)

        assert message["data"]["layer"] == "empty"
        assert message["data"]["layer_data"]["elements"] == []

    def test_create_layer_update_has_timestamp(self):
        """Test layer update message includes timestamp."""
        message = create_layer_update_message("business", {})

        assert "timestamp" in message
        assert message["timestamp"].endswith("Z")


class TestCreateErrorMessage:
    """Test error message creation."""

    def test_create_error_message_simple(self):
        """Test simple error message."""
        message = create_error_message("Something went wrong")

        assert message["type"] == "error"
        assert "timestamp" in message
        assert message["data"]["error"] == "Something went wrong"
        assert "details" not in message["data"]

    def test_create_error_message_with_details(self):
        """Test error message with details."""
        error = "Validation failed"
        details = "Element ID must be unique"

        message = create_error_message(error, details)

        assert message["data"]["error"] == error
        assert message["data"]["details"] == details

    def test_create_error_message_with_none_details(self):
        """Test error message with None details."""
        message = create_error_message("Error", None)

        assert message["data"]["error"] == "Error"
        assert "details" not in message["data"]

    def test_create_error_message_has_timestamp(self):
        """Test error message includes timestamp."""
        message = create_error_message("Error")

        assert "timestamp" in message
        assert message["timestamp"].endswith("Z")


class TestTimestamps:
    """Test timestamp generation."""

    def test_timestamp_format(self):
        """Test timestamp is in ISO 8601 format with Z suffix."""
        spec = {}
        model = {}
        changesets = []

        message = create_initial_state_message(spec, model, changesets)
        timestamp = message["timestamp"]

        # Should be parseable as ISO datetime
        try:
            # Remove Z and parse
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            assert dt is not None
        except ValueError:
            pytest.fail(f"Invalid timestamp format: {timestamp}")

    def test_timestamps_are_recent(self):
        """Test timestamps are current."""
        message = create_error_message("Test")
        timestamp = message["timestamp"]

        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        now = datetime.now(dt.tzinfo)

        # Timestamp should be within last second
        diff = (now - dt).total_seconds()
        assert diff < 1.0


class TestMessageConsistency:
    """Test message structure consistency."""

    def test_all_messages_have_type(self):
        """Test all message types include 'type' field."""
        messages = [
            create_initial_state_message({}, {}, []),
            create_element_update_message("added", "layer", "elem-1", {}),
            create_layer_update_message("layer", {}),
            create_error_message("error"),
        ]

        for message in messages:
            assert "type" in message
            assert isinstance(message["type"], str)

    def test_all_messages_have_timestamp(self):
        """Test all message types include 'timestamp' field."""
        messages = [
            create_initial_state_message({}, {}, []),
            create_element_update_message("updated", "layer", "elem-1", {}),
            create_layer_update_message("layer", {}),
            create_error_message("error"),
        ]

        for message in messages:
            assert "timestamp" in message
            assert isinstance(message["timestamp"], str)
            assert message["timestamp"].endswith("Z")

    def test_all_messages_have_data(self):
        """Test all message types include 'data' field."""
        messages = [
            create_initial_state_message({}, {}, []),
            create_element_update_message("added", "layer", "elem-1", {}),
            create_layer_update_message("layer", {}),
            create_error_message("error"),
        ]

        for message in messages:
            assert "data" in message
            assert isinstance(message["data"], dict)


class TestEdgeCases:
    """Test edge cases and special characters."""

    def test_unicode_in_error_message(self):
        """Test error message with unicode characters."""
        error = "Error: Invalid character \u2603"
        message = create_error_message(error)

        assert message["data"]["error"] == error

    def test_special_characters_in_element_id(self):
        """Test element ID with special characters."""
        element_id = "business.service.customer-management_v2"

        message = create_element_update_message("added", "business", element_id, {})

        assert message["data"]["element_id"] == element_id

    def test_large_data_payload(self):
        """Test message with large data payload."""
        large_model = {
            "layers": [
                {
                    "name": f"layer-{i}",
                    "elements": [{"id": f"elem-{j}"} for j in range(100)],
                }
                for i in range(10)
            ]
        }

        message = create_initial_state_message({}, large_model, [])

        assert len(message["data"]["model"]["layers"]) == 10
        assert len(message["data"]["model"]["layers"][0]["elements"]) == 100


class MockAnnotation:
    """Mock annotation object for testing."""

    def __init__(self, id, entity_uri, timestamp, user, message, parent_id=None):
        self.id = id
        self.entity_uri = entity_uri
        self.timestamp = timestamp
        self.user = user
        self.message = message
        self.parent_id = parent_id


class TestCreateAnnotationMessages:
    """Test annotation message creation."""

    def test_create_annotation_added_message_structure(self):
        """Test annotation_added message has correct structure."""
        annotation = MockAnnotation(
            id="ann-123",
            entity_uri="business.service.customer",
            timestamp="2024-01-15T10:30:00Z",
            user="john",
            message="This needs review",
            parent_id=None,
        )

        message = create_annotation_added_message(annotation)

        assert message["type"] == "annotation_added"
        assert "timestamp" in message
        assert message["timestamp"].endswith("Z")
        assert "data" in message
        assert message["data"]["id"] == "ann-123"
        assert message["data"]["entity_uri"] == "business.service.customer"
        assert message["data"]["timestamp"] == "2024-01-15T10:30:00Z"
        assert message["data"]["user"] == "john"
        assert message["data"]["message"] == "This needs review"
        assert message["data"]["parent_id"] is None

    def test_create_annotation_added_with_all_fields(self):
        """Test annotation_added message includes all required fields."""
        annotation = MockAnnotation(
            id="ann-456",
            entity_uri="api.endpoint.create-order",
            timestamp="2024-01-15T11:00:00Z",
            user="alice",
            message="Consider rate limiting",
            parent_id=None,
        )

        message = create_annotation_added_message(annotation)

        # Verify all fields are present
        data = message["data"]
        assert "id" in data
        assert "entity_uri" in data
        assert "timestamp" in data
        assert "user" in data
        assert "message" in data
        assert "parent_id" in data

    def test_create_annotation_reply_added_message_structure(self):
        """Test annotation_reply_added message has correct structure."""
        reply = MockAnnotation(
            id="ann-789",
            entity_uri="business.service.customer",
            timestamp="2024-01-15T12:00:00Z",
            user="jane",
            message="I agree with this",
            parent_id="ann-123",
        )

        message = create_annotation_reply_added_message(reply)

        assert message["type"] == "annotation_reply_added"
        assert "timestamp" in message
        assert message["timestamp"].endswith("Z")
        assert "data" in message
        assert message["data"]["id"] == "ann-789"
        assert message["data"]["parent_id"] == "ann-123"
        assert message["data"]["user"] == "jane"
        assert message["data"]["message"] == "I agree with this"

    def test_create_annotation_reply_added_with_all_fields(self):
        """Test annotation_reply_added message includes all required fields."""
        reply = MockAnnotation(
            id="ann-abc",
            entity_uri="datamodel.entity.customer",
            timestamp="2024-01-15T13:00:00Z",
            user="bob",
            message="Good point",
            parent_id="ann-xyz",
        )

        message = create_annotation_reply_added_message(reply)

        # Verify all fields are present
        data = message["data"]
        assert "id" in data
        assert "entity_uri" in data
        assert "timestamp" in data
        assert "user" in data
        assert "message" in data
        assert "parent_id" in data
        assert data["parent_id"] == "ann-xyz"

    def test_annotation_messages_have_consistent_structure(self):
        """Test both annotation message types have consistent structure."""
        annotation = MockAnnotation("ann-1", "uri-1", "2024-01-15T10:00:00Z", "user1", "msg1", None)
        reply = MockAnnotation("ann-2", "uri-1", "2024-01-15T11:00:00Z", "user2", "msg2", "ann-1")

        msg1 = create_annotation_added_message(annotation)
        msg2 = create_annotation_reply_added_message(reply)

        # Both should have same top-level structure
        assert set(msg1.keys()) == set(msg2.keys())
        assert set(msg1["data"].keys()) == set(msg2["data"].keys())

    def test_annotation_messages_included_in_consistency_check(self):
        """Test annotation messages follow same patterns as other messages."""
        annotation = MockAnnotation("ann-1", "uri-1", "2024-01-15T10:00:00Z", "user1", "msg1", None)

        messages = [
            create_annotation_added_message(annotation),
            create_annotation_reply_added_message(annotation),
        ]

        for message in messages:
            # All messages should have type, timestamp, and data
            assert "type" in message
            assert isinstance(message["type"], str)
            assert "timestamp" in message
            assert isinstance(message["timestamp"], str)
            assert message["timestamp"].endswith("Z")
            assert "data" in message
            assert isinstance(message["data"], dict)

    def test_annotation_message_with_unicode(self):
        """Test annotation message with unicode characters."""
        annotation = MockAnnotation(
            "ann-unicode",
            "uri-1",
            "2024-01-15T10:00:00Z",
            "user1",
            "Comment with emoji 🚀 and unicode ✓",
            None,
        )

        message = create_annotation_added_message(annotation)

        assert "🚀" in message["data"]["message"]
        assert "✓" in message["data"]["message"]

    def test_annotation_message_with_long_text(self):
        """Test annotation message with long text content."""
        long_message = "This is a very long annotation message. " * 50
        annotation = MockAnnotation(
            "ann-long", "uri-1", "2024-01-15T10:00:00Z", "user1", long_message, None
        )

        message = create_annotation_added_message(annotation)

        assert message["data"]["message"] == long_message
        assert len(message["data"]["message"]) > 1000

    def test_annotation_message_timestamp_format(self):
        """Test annotation message timestamp is current."""
        annotation = MockAnnotation(
            "ann-time", "uri-1", "2024-01-15T10:00:00Z", "user1", "test", None
        )

        message = create_annotation_added_message(annotation)

        # Message timestamp (when message was created) should be current
        msg_timestamp = message["timestamp"]
        dt = datetime.fromisoformat(msg_timestamp.replace("Z", "+00:00"))
        now = datetime.now(dt.tzinfo)

        # Message creation timestamp should be within last second
        diff = (now - dt).total_seconds()
        assert diff < 1.0

        # Annotation timestamp is preserved in data
        assert message["data"]["timestamp"] == "2024-01-15T10:00:00Z"
