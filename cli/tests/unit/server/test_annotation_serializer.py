"""
Unit tests for annotation serialization functions.

Tests AnnotationSerializer class for converting annotation objects
to JSON-serializable dictionaries for WebSocket transmission.
"""

from pathlib import Path
from unittest.mock import Mock, patch

from documentation_robotics.core.annotations import Annotation, AnnotationRegistry
from documentation_robotics.server.annotation_serializer import AnnotationSerializer


class TestAnnotationSerializer:
    """Test AnnotationSerializer class."""

    def test_serializer_initialization(self, tmp_path):
        """Test serializer initializes with project path."""
        serializer = AnnotationSerializer(tmp_path)

        assert serializer.registry is not None
        assert isinstance(serializer.registry, AnnotationRegistry)

    def test_serialize_all_empty(self, tmp_path):
        """Test serializing with no annotations."""
        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_all()

        assert result == []

    def test_serialize_all_with_annotations(self, tmp_path):
        """Test serializing multiple annotations."""
        # Create test annotations
        annotations_dir = tmp_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)

        annotations_data = {
            "annotations": [
                {
                    "id": "ann-test001",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "testuser",
                    "message": "Test annotation",
                },
                {
                    "id": "ann-test002",
                    "entity_uri": "business.service.test",
                    "timestamp": "2024-01-02T00:00:00Z",
                    "user": "testuser",
                    "message": "Another annotation",
                    "parent_id": "ann-test001",
                },
            ]
        }

        import json

        (annotations_dir / "annotations.json").write_text(json.dumps(annotations_data, indent=2))

        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_all()

        assert len(result) == 2
        assert result[0]["id"] == "ann-test001"
        assert result[0]["user"] == "testuser"
        assert result[0]["message"] == "Test annotation"
        assert result[0]["parent_id"] is None

        assert result[1]["id"] == "ann-test002"
        assert result[1]["parent_id"] == "ann-test001"

    def test_serialize_all_multiple_users(self, tmp_path):
        """Test serializing annotations from multiple users."""
        import json

        # Create annotations for user1
        user1_dir = tmp_path / "annotations" / "user1"
        user1_dir.mkdir(parents=True)
        user1_data = {
            "annotations": [
                {
                    "id": "ann-user1-01",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "user1",
                    "message": "User 1 annotation",
                }
            ]
        }
        (user1_dir / "annotations.json").write_text(json.dumps(user1_data, indent=2))

        # Create annotations for user2
        user2_dir = tmp_path / "annotations" / "user2"
        user2_dir.mkdir(parents=True)
        user2_data = {
            "annotations": [
                {
                    "id": "ann-user2-01",
                    "entity_uri": "business.service.test",
                    "timestamp": "2024-01-02T00:00:00Z",
                    "user": "user2",
                    "message": "User 2 annotation",
                }
            ]
        }
        (user2_dir / "annotations.json").write_text(json.dumps(user2_data, indent=2))

        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_all()

        assert len(result) == 2
        user_ids = {ann["user"] for ann in result}
        assert user_ids == {"user1", "user2"}

    def test_serialize_threads_empty(self, tmp_path):
        """Test serializing threads with no annotations."""
        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_threads()

        assert result == {}

    def test_serialize_threads_single_root(self, tmp_path):
        """Test serializing a simple thread with one root and replies."""
        import json

        annotations_dir = tmp_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)

        annotations_data = {
            "annotations": [
                {
                    "id": "ann-root",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "testuser",
                    "message": "Root annotation",
                },
                {
                    "id": "ann-reply1",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-02T00:00:00Z",
                    "user": "testuser",
                    "message": "First reply",
                    "parent_id": "ann-root",
                },
                {
                    "id": "ann-reply2",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-03T00:00:00Z",
                    "user": "testuser",
                    "message": "Second reply",
                    "parent_id": "ann-root",
                },
            ]
        }

        (annotations_dir / "annotations.json").write_text(json.dumps(annotations_data, indent=2))

        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_threads()

        assert len(result) == 1
        assert "ann-root" in result

        thread = result["ann-root"]
        assert thread["id"] == "ann-root"
        assert thread["message"] == "Root annotation"
        assert len(thread["replies"]) == 2
        assert thread["replies"][0]["id"] == "ann-reply1"
        assert thread["replies"][1]["id"] == "ann-reply2"

    def test_serialize_threads_nested_replies(self, tmp_path):
        """Test serializing threads with nested replies."""
        import json

        annotations_dir = tmp_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)

        annotations_data = {
            "annotations": [
                {
                    "id": "ann-root",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "testuser",
                    "message": "Root annotation",
                },
                {
                    "id": "ann-reply1",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-02T00:00:00Z",
                    "user": "testuser",
                    "message": "First reply",
                    "parent_id": "ann-root",
                },
                {
                    "id": "ann-nested",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-03T00:00:00Z",
                    "user": "testuser",
                    "message": "Nested reply",
                    "parent_id": "ann-reply1",
                },
            ]
        }

        (annotations_dir / "annotations.json").write_text(json.dumps(annotations_data, indent=2))

        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_threads()

        assert len(result) == 1
        thread = result["ann-root"]
        assert len(thread["replies"]) == 1
        assert thread["replies"][0]["id"] == "ann-reply1"
        assert len(thread["replies"][0]["replies"]) == 1
        assert thread["replies"][0]["replies"][0]["id"] == "ann-nested"

    def test_serialize_threads_multiple_roots(self, tmp_path):
        """Test serializing multiple independent threads."""
        import json

        annotations_dir = tmp_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)

        annotations_data = {
            "annotations": [
                {
                    "id": "ann-root1",
                    "entity_uri": "motivation.goal.test1",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "testuser",
                    "message": "First root",
                },
                {
                    "id": "ann-root2",
                    "entity_uri": "motivation.goal.test2",
                    "timestamp": "2024-01-02T00:00:00Z",
                    "user": "testuser",
                    "message": "Second root",
                },
            ]
        }

        (annotations_dir / "annotations.json").write_text(json.dumps(annotations_data, indent=2))

        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_threads()

        assert len(result) == 2
        assert "ann-root1" in result
        assert "ann-root2" in result

    def test_thread_to_dict_structure(self, tmp_path):
        """Test thread dictionary structure."""
        import json

        annotations_dir = tmp_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)

        annotations_data = {
            "annotations": [
                {
                    "id": "ann-root",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "testuser",
                    "message": "Root",
                }
            ]
        }

        (annotations_dir / "annotations.json").write_text(json.dumps(annotations_data, indent=2))

        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_threads()

        thread = result["ann-root"]
        assert "id" in thread
        assert "entity_uri" in thread
        assert "timestamp" in thread
        assert "user" in thread
        assert "message" in thread
        assert "replies" in thread
        assert isinstance(thread["replies"], list)


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_serialize_with_malformed_json(self, tmp_path):
        """Test serializer handles malformed JSON gracefully."""
        annotations_dir = tmp_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)

        # Write malformed JSON
        (annotations_dir / "annotations.json").write_text("{ invalid json }")

        serializer = AnnotationSerializer(tmp_path)
        # Should not crash, just return empty list
        result = serializer.serialize_all()

        assert result == []

    def test_serialize_missing_annotations_directory(self, tmp_path):
        """Test serializer handles missing annotations directory."""
        serializer = AnnotationSerializer(tmp_path)
        result = serializer.serialize_all()

        assert result == []

    def test_serialize_threads_orphaned_reply(self, tmp_path):
        """Test handling reply with missing parent."""
        import json

        annotations_dir = tmp_path / "annotations" / "testuser"
        annotations_dir.mkdir(parents=True)

        # Reply with non-existent parent
        annotations_data = {
            "annotations": [
                {
                    "id": "ann-orphan",
                    "entity_uri": "motivation.goal.test",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "user": "testuser",
                    "message": "Orphaned reply",
                    "parent_id": "ann-nonexistent",
                }
            ]
        }

        (annotations_dir / "annotations.json").write_text(json.dumps(annotations_data, indent=2))

        serializer = AnnotationSerializer(tmp_path)

        # Should still serialize all annotations
        result = serializer.serialize_all()
        assert len(result) == 1

        # But threads should be empty since it's not a root
        threads = serializer.serialize_threads()
        assert len(threads) == 0
