"""Annotation serialization for visualization."""

from pathlib import Path
from typing import Any, Dict, List

from ..core.annotations import AnnotationRegistry


class AnnotationSerializer:
    """Serializes annotations for WebSocket transmission."""

    def __init__(self, project_path: Path):
        """
        Initialize annotation serializer.

        Args:
            project_path: Path to project root directory
        """
        self.registry = AnnotationRegistry(project_path)

    def serialize_all(self) -> List[Dict[str, Any]]:
        """
        Serialize all annotations across all users.

        Returns:
            List of annotation dicts ready for JSON serialization
        """
        self.registry.load_all()
        annotations = self.registry.get_all()

        return [
            {
                "id": a.id,
                "entity_uri": a.entity_uri,
                "timestamp": a.timestamp,
                "user": a.user,
                "message": a.message,
                "parent_id": a.parent_id,
            }
            for a in annotations
        ]

    def serialize_threads(self) -> Dict[str, Any]:
        """
        Serialize annotations organized into threads.

        Returns:
            Dict mapping root annotation IDs to their thread trees
        """
        self.registry.load_all()
        roots = self.registry.get_root_annotations()

        threads = {}
        for root in roots:
            thread = self.registry.build_thread_tree(root.id)
            if thread:
                threads[root.id] = self._thread_to_dict(thread)

        return threads

    def _thread_to_dict(self, thread: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert thread tree to serializable dict.

        Args:
            thread: Thread tree from registry.build_thread_tree()

        Returns:
            Serializable dictionary representation
        """
        annotation = thread["annotation"]
        return {
            "id": annotation.id,
            "entity_uri": annotation.entity_uri,
            "timestamp": annotation.timestamp,
            "user": annotation.user,
            "message": annotation.message,
            "replies": [self._thread_to_dict(reply) for reply in thread["replies"]],
        }
