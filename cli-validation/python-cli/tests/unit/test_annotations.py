"""Unit tests for core.annotations module."""

import json

import pytest
from documentation_robotics.core.annotations import (
    Annotation,
    AnnotationRegistry,
    AnnotationStore,
    generate_annotation_id,
)


class TestAnnotation:
    """Tests for Annotation dataclass."""

    def test_annotation_creation(self):
        """Test basic annotation creation."""
        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="This is a test annotation",
        )

        assert ann.id == "ann-12345678"
        assert ann.entity_uri == "motivation.goal.deliver-value"
        assert ann.timestamp == "2025-01-15T10:30:00Z"
        assert ann.user == "alice"
        assert ann.message == "This is a test annotation"
        assert ann.parent_id is None

    def test_annotation_with_parent(self):
        """Test annotation with parent_id (reply)."""
        ann = Annotation(
            id="ann-87654321",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:35:00Z",
            user="bob",
            message="This is a reply",
            parent_id="ann-12345678",
        )

        assert ann.parent_id == "ann-12345678"

    def test_to_dict(self):
        """Test conversion to dictionary."""
        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Test",
        )

        result = ann.to_dict()
        assert result["id"] == "ann-12345678"
        assert result["entity_uri"] == "motivation.goal.deliver-value"
        assert result["timestamp"] == "2025-01-15T10:30:00Z"
        assert result["user"] == "alice"
        assert result["message"] == "Test"
        assert "parent_id" not in result  # None parent_id should be omitted

    def test_to_dict_with_parent(self):
        """Test to_dict includes parent_id when present."""
        ann = Annotation(
            id="ann-87654321",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:35:00Z",
            user="bob",
            message="Reply",
            parent_id="ann-12345678",
        )

        result = ann.to_dict()
        assert result["parent_id"] == "ann-12345678"

    def test_from_dict(self):
        """Test creation from dictionary."""
        data = {
            "id": "ann-12345678",
            "entity_uri": "motivation.goal.deliver-value",
            "timestamp": "2025-01-15T10:30:00Z",
            "user": "alice",
            "message": "Test",
        }

        ann = Annotation.from_dict(data)
        assert ann.id == "ann-12345678"
        assert ann.entity_uri == "motivation.goal.deliver-value"
        assert ann.parent_id is None

    def test_from_dict_with_parent(self):
        """Test from_dict with parent_id."""
        data = {
            "id": "ann-87654321",
            "entity_uri": "motivation.goal.deliver-value",
            "timestamp": "2025-01-15T10:35:00Z",
            "user": "bob",
            "message": "Reply",
            "parent_id": "ann-12345678",
        }

        ann = Annotation.from_dict(data)
        assert ann.parent_id == "ann-12345678"


class TestGenerateAnnotationId:
    """Tests for generate_annotation_id function."""

    def test_id_format(self):
        """Test ID has correct format."""
        ann_id = generate_annotation_id()
        assert ann_id.startswith("ann-")
        assert len(ann_id) == 12  # "ann-" + 8 chars

    def test_ids_are_unique(self):
        """Test generated IDs are unique."""
        ids = {generate_annotation_id() for _ in range(100)}
        assert len(ids) == 100  # All unique


class TestAnnotationStore:
    """Tests for AnnotationStore class."""

    def test_init(self, tmp_path):
        """Test store initialization."""
        store = AnnotationStore("alice", tmp_path)
        assert store.username == "alice"
        assert store.user_dir == tmp_path / "annotations" / "alice"
        assert store.annotations_file == tmp_path / "annotations" / "alice" / "annotations.json"

    def test_load_nonexistent_file(self, tmp_path):
        """Test loading when file doesn't exist returns empty list."""
        store = AnnotationStore("alice", tmp_path)
        annotations = store.load()
        assert annotations == []

    def test_save_creates_directory(self, tmp_path):
        """Test save creates user directory if it doesn't exist."""
        store = AnnotationStore("alice", tmp_path)
        assert not store.user_dir.exists()

        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Test",
        )

        store.save([ann])
        assert store.user_dir.exists()
        assert store.annotations_file.exists()

    def test_save_and_load(self, tmp_path):
        """Test save and load roundtrip."""
        store = AnnotationStore("alice", tmp_path)

        ann1 = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="First annotation",
        )

        ann2 = Annotation(
            id="ann-87654321",
            entity_uri="business.service.checkout",
            timestamp="2025-01-15T11:00:00Z",
            user="alice",
            message="Second annotation",
            parent_id="ann-12345678",
        )

        store.save([ann1, ann2])

        # Load and verify
        loaded = store.load()
        assert len(loaded) == 2
        assert loaded[0].id == "ann-12345678"
        assert loaded[0].message == "First annotation"
        assert loaded[0].parent_id is None
        assert loaded[1].id == "ann-87654321"
        assert loaded[1].parent_id == "ann-12345678"

    def test_save_uses_atomic_write(self, tmp_path):
        """Test save uses atomic write (temp file then rename)."""
        store = AnnotationStore("alice", tmp_path)

        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Test",
        )

        store.save([ann])

        # Temp file should not exist after successful write
        temp_file = store.annotations_file.with_suffix(".tmp")
        assert not temp_file.exists()
        assert store.annotations_file.exists()

    def test_save_json_formatting(self, tmp_path):
        """Test saved JSON is pretty-printed for git readability."""
        store = AnnotationStore("alice", tmp_path)

        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Test",
        )

        store.save([ann])

        # Check JSON formatting
        content = store.annotations_file.read_text()
        assert content.startswith("{\n  ")  # Indented
        data = json.loads(content)
        assert "annotations" in data

    def test_add_annotation(self, tmp_path):
        """Test adding single annotation."""
        store = AnnotationStore("alice", tmp_path)

        ann1 = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="First",
        )

        store.add_annotation(ann1)

        ann2 = Annotation(
            id="ann-87654321",
            entity_uri="business.service.checkout",
            timestamp="2025-01-15T11:00:00Z",
            user="alice",
            message="Second",
        )

        store.add_annotation(ann2)

        # Verify both annotations were added
        loaded = store.load()
        assert len(loaded) == 2

    def test_load_invalid_json(self, tmp_path):
        """Test loading invalid JSON raises error."""
        store = AnnotationStore("alice", tmp_path)
        store.user_dir.mkdir(parents=True)
        store.annotations_file.write_text("invalid json {")

        with pytest.raises(ValueError, match="Failed to load annotations"):
            store.load()


class TestAnnotationRegistry:
    """Tests for AnnotationRegistry class."""

    def test_init(self, tmp_path):
        """Test registry initialization."""
        registry = AnnotationRegistry(tmp_path)
        assert registry.base_path == tmp_path
        assert registry.annotations_dir == tmp_path / "annotations"
        assert registry._annotations == {}

    def test_load_all_empty_directory(self, tmp_path):
        """Test loading when annotations directory doesn't exist."""
        registry = AnnotationRegistry(tmp_path)
        registry.load_all()
        assert registry.get_all() == []

    def test_load_all_single_user(self, tmp_path):
        """Test loading annotations from single user."""
        # Create annotation
        store = AnnotationStore("alice", tmp_path)
        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Test",
        )
        store.add_annotation(ann)

        # Load via registry
        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        annotations = registry.get_all()
        assert len(annotations) == 1
        assert annotations[0].id == "ann-12345678"

    def test_load_all_multiple_users(self, tmp_path):
        """Test loading annotations from multiple users."""
        # Create annotations for alice
        store_alice = AnnotationStore("alice", tmp_path)
        ann1 = Annotation(
            id="ann-11111111",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Alice's annotation",
        )
        store_alice.add_annotation(ann1)

        # Create annotations for bob
        store_bob = AnnotationStore("bob", tmp_path)
        ann2 = Annotation(
            id="ann-22222222",
            entity_uri="business.service.checkout",
            timestamp="2025-01-15T11:00:00Z",
            user="bob",
            message="Bob's annotation",
        )
        store_bob.add_annotation(ann2)

        # Load via registry
        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        annotations = registry.get_all()
        assert len(annotations) == 2
        ids = {ann.id for ann in annotations}
        assert ids == {"ann-11111111", "ann-22222222"}

    def test_get_by_entity_uri(self, tmp_path):
        """Test filtering annotations by entity URI."""
        store = AnnotationStore("alice", tmp_path)

        ann1 = Annotation(
            id="ann-11111111",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="First",
        )

        ann2 = Annotation(
            id="ann-22222222",
            entity_uri="business.service.checkout",
            timestamp="2025-01-15T11:00:00Z",
            user="alice",
            message="Second",
        )

        ann3 = Annotation(
            id="ann-33333333",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T12:00:00Z",
            user="alice",
            message="Third",
        )

        store.save([ann1, ann2, ann3])

        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        # Get annotations for specific entity
        results = registry.get_by_entity_uri("motivation.goal.deliver-value")
        assert len(results) == 2
        ids = {ann.id for ann in results}
        assert ids == {"ann-11111111", "ann-33333333"}

    def test_get_annotation(self, tmp_path):
        """Test getting single annotation by ID."""
        store = AnnotationStore("alice", tmp_path)
        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Test",
        )
        store.add_annotation(ann)

        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        result = registry.get_annotation("ann-12345678")
        assert result is not None
        assert result.id == "ann-12345678"
        assert result.message == "Test"

        # Non-existent ID returns None
        assert registry.get_annotation("ann-99999999") is None

    def test_build_thread_tree_simple(self, tmp_path):
        """Test building thread tree with single root and reply."""
        store = AnnotationStore("alice", tmp_path)

        root = Annotation(
            id="ann-root",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Root annotation",
        )

        reply = Annotation(
            id="ann-reply",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:35:00Z",
            user="bob",
            message="Reply to root",
            parent_id="ann-root",
        )

        store.save([root, reply])

        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        tree = registry.build_thread_tree("ann-root")
        assert tree is not None
        assert tree["annotation"].id == "ann-root"
        assert len(tree["replies"]) == 1
        assert tree["replies"][0]["annotation"].id == "ann-reply"

    def test_build_thread_tree_nested(self, tmp_path):
        """Test building deeply nested thread tree."""
        store = AnnotationStore("alice", tmp_path)

        root = Annotation(
            id="ann-root",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Root",
        )

        reply1 = Annotation(
            id="ann-reply1",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:35:00Z",
            user="bob",
            message="First reply",
            parent_id="ann-root",
        )

        reply2 = Annotation(
            id="ann-reply2",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:40:00Z",
            user="charlie",
            message="Reply to reply",
            parent_id="ann-reply1",
        )

        store.save([root, reply1, reply2])

        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        tree = registry.build_thread_tree("ann-root")
        assert tree is not None
        assert tree["annotation"].id == "ann-root"
        assert len(tree["replies"]) == 1
        assert tree["replies"][0]["annotation"].id == "ann-reply1"
        assert len(tree["replies"][0]["replies"]) == 1
        assert tree["replies"][0]["replies"][0]["annotation"].id == "ann-reply2"

    def test_build_thread_tree_multiple_replies(self, tmp_path):
        """Test thread tree with multiple replies to same annotation."""
        store = AnnotationStore("alice", tmp_path)

        root = Annotation(
            id="ann-root",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Root",
        )

        reply1 = Annotation(
            id="ann-reply1",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:35:00Z",
            user="bob",
            message="First reply",
            parent_id="ann-root",
        )

        reply2 = Annotation(
            id="ann-reply2",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:36:00Z",
            user="charlie",
            message="Second reply",
            parent_id="ann-root",
        )

        store.save([root, reply1, reply2])

        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        tree = registry.build_thread_tree("ann-root")
        assert tree is not None
        assert len(tree["replies"]) == 2
        # Should be sorted by timestamp
        assert tree["replies"][0]["annotation"].id == "ann-reply1"
        assert tree["replies"][1]["annotation"].id == "ann-reply2"

    def test_build_thread_tree_nonexistent(self, tmp_path):
        """Test building tree for nonexistent annotation returns None."""
        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        tree = registry.build_thread_tree("ann-nonexistent")
        assert tree is None

    def test_get_root_annotations(self, tmp_path):
        """Test getting root annotations (no parent_id)."""
        store = AnnotationStore("alice", tmp_path)

        root1 = Annotation(
            id="ann-root1",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Root 1",
        )

        root2 = Annotation(
            id="ann-root2",
            entity_uri="business.service.checkout",
            timestamp="2025-01-15T11:00:00Z",
            user="alice",
            message="Root 2",
        )

        reply = Annotation(
            id="ann-reply",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:35:00Z",
            user="bob",
            message="Reply",
            parent_id="ann-root1",
        )

        store.save([root1, root2, reply])

        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        roots = registry.get_root_annotations()
        assert len(roots) == 2
        ids = {ann.id for ann in roots}
        assert ids == {"ann-root1", "ann-root2"}

    def test_get_replies(self, tmp_path):
        """Test getting direct replies to an annotation."""
        store = AnnotationStore("alice", tmp_path)

        root = Annotation(
            id="ann-root",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Root",
        )

        reply1 = Annotation(
            id="ann-reply1",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:35:00Z",
            user="bob",
            message="First reply",
            parent_id="ann-root",
        )

        reply2 = Annotation(
            id="ann-reply2",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:40:00Z",
            user="charlie",
            message="Reply to reply",
            parent_id="ann-reply1",
        )

        store.save([root, reply1, reply2])

        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        # Get direct replies to root
        replies = registry.get_replies("ann-root")
        assert len(replies) == 1
        assert replies[0].id == "ann-reply1"

        # Get direct replies to first reply
        nested_replies = registry.get_replies("ann-reply1")
        assert len(nested_replies) == 1
        assert nested_replies[0].id == "ann-reply2"

    def test_load_all_skips_invalid_files(self, tmp_path):
        """Test load_all skips malformed annotation files."""
        # Create valid annotation
        store_alice = AnnotationStore("alice", tmp_path)
        ann = Annotation(
            id="ann-12345678",
            entity_uri="motivation.goal.deliver-value",
            timestamp="2025-01-15T10:30:00Z",
            user="alice",
            message="Valid",
        )
        store_alice.add_annotation(ann)

        # Create invalid annotation file
        bob_dir = tmp_path / "annotations" / "bob"
        bob_dir.mkdir(parents=True)
        (bob_dir / "annotations.json").write_text("invalid json")

        # Load via registry - should skip invalid file
        registry = AnnotationRegistry(tmp_path)
        registry.load_all()

        annotations = registry.get_all()
        assert len(annotations) == 1  # Only alice's valid annotation
        assert annotations[0].id == "ann-12345678"
