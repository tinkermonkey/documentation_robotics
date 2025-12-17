"""Core annotation domain model and storage."""

from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict
import json
import secrets


@dataclass
class Annotation:
    """Individual annotation object stored in user's file.

    Attributes:
        id: Unique identifier in format ann-{8-char-random}
        entity_uri: Reference to entity (layer.type.name) or attribute (layer.type.name#properties.path)
        timestamp: ISO 8601 formatted timestamp
        user: Username of the annotation author
        message: Markdown-formatted annotation content
        parent_id: ID of parent annotation/reply (None for root annotations)
    """

    id: str
    entity_uri: str
    timestamp: str
    user: str
    message: str
    parent_id: Optional[str] = None

    def to_dict(self) -> Dict:
        """Convert annotation to dictionary for JSON serialization."""
        result = asdict(self)
        # Remove parent_id if it's None for cleaner JSON
        if result['parent_id'] is None:
            del result['parent_id']
        return result

    @classmethod
    def from_dict(cls, data: Dict) -> 'Annotation':
        """Create annotation from dictionary."""
        return cls(**data)


def generate_annotation_id() -> str:
    """Generate unique annotation ID in format ann-{8-char-random}."""
    return f"ann-{secrets.token_urlsafe(6)[:8]}"


class AnnotationStore:
    """Handles single-user annotation file operations.

    Each user has their own annotations.json file in a subdirectory
    under the base annotations directory. This design prevents merge
    conflicts when multiple users annotate concurrently.
    """

    def __init__(self, username: str, base_path: Path):
        """Initialize annotation store for a specific user.

        Args:
            username: Username for this store
            base_path: Base path of the documentation robotics project
        """
        self.username = username
        self.user_dir = base_path / "annotations" / username
        self.annotations_file = self.user_dir / "annotations.json"

    def load(self) -> List[Annotation]:
        """Load annotations from user's file.

        Returns:
            List of Annotation objects, empty list if file doesn't exist
        """
        if not self.annotations_file.exists():
            return []

        try:
            data = json.loads(self.annotations_file.read_text())
            annotations_data = data.get('annotations', [])
            return [Annotation.from_dict(ann_data) for ann_data in annotations_data]
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            raise ValueError(f"Failed to load annotations from {self.annotations_file}: {e}")

    def save(self, annotations: List[Annotation]) -> None:
        """Save annotations to user's file using atomic write.

        Creates user directory if it doesn't exist. Uses atomic write
        pattern (write to temp, then rename) to prevent corruption.

        Args:
            annotations: List of annotations to save
        """
        # Create user directory if it doesn't exist
        self.user_dir.mkdir(parents=True, exist_ok=True)

        # Prepare data
        data = {
            'annotations': [ann.to_dict() for ann in annotations]
        }

        # Atomic write: write to temp file, then rename
        temp_file = self.annotations_file.with_suffix('.tmp')
        temp_file.write_text(json.dumps(data, indent=2))
        temp_file.rename(self.annotations_file)

    def add_annotation(self, annotation: Annotation) -> None:
        """Add single annotation to user's file.

        Args:
            annotation: Annotation to add
        """
        annotations = self.load()
        annotations.append(annotation)
        self.save(annotations)


class AnnotationRegistry:
    """Aggregates annotations from all user directories and builds thread trees.

    The registry loads annotations from all users at initialization and
    provides methods to query, filter, and navigate annotation threads.
    """

    def __init__(self, base_path: Path):
        """Initialize annotation registry.

        Args:
            base_path: Base path of the documentation robotics project
        """
        self.base_path = base_path
        self.annotations_dir = base_path / "annotations"
        self._annotations: Dict[str, Annotation] = {}  # keyed by ID

    def load_all(self) -> None:
        """Load annotations from all user subdirectories.

        Scans the annotations directory for user subdirectories and
        loads each user's annotations.json file into the registry.
        """
        if not self.annotations_dir.exists():
            return

        # Scan for user subdirectories
        for user_dir in self.annotations_dir.iterdir():
            if not user_dir.is_dir():
                continue

            annotations_file = user_dir / "annotations.json"
            if not annotations_file.exists():
                continue

            # Load annotations from this user
            try:
                store = AnnotationStore(user_dir.name, self.base_path)
                annotations = store.load()

                # Add to registry
                for ann in annotations:
                    self._annotations[ann.id] = ann
            except ValueError:
                # Skip malformed annotation files
                continue

    def get_all(self) -> List[Annotation]:
        """Get all annotations across all users.

        Returns:
            List of all annotations
        """
        return list(self._annotations.values())

    def get_by_entity_uri(self, entity_uri: str) -> List[Annotation]:
        """Get annotations for specific entity or attribute.

        Args:
            entity_uri: Entity URI to filter by

        Returns:
            List of annotations matching the entity URI
        """
        return [ann for ann in self._annotations.values()
                if ann.entity_uri == entity_uri]

    def get_annotation(self, annotation_id: str) -> Optional[Annotation]:
        """Get single annotation by ID.

        Args:
            annotation_id: Annotation ID to look up

        Returns:
            Annotation if found, None otherwise
        """
        return self._annotations.get(annotation_id)

    def build_thread_tree(self, root_id: str) -> Optional[Dict]:
        """Build hierarchical tree for an annotation thread.

        Constructs a nested dictionary representing the annotation thread
        starting from the specified root annotation, with all replies
        nested under their parent annotations.

        Args:
            root_id: ID of the root annotation

        Returns:
            Nested dictionary with structure:
            {
                'annotation': Annotation object,
                'replies': [
                    {
                        'annotation': Annotation object,
                        'replies': [...]
                    },
                    ...
                ]
            }
            Returns None if root annotation not found.
        """
        root = self.get_annotation(root_id)
        if not root:
            return None

        def build_tree(ann_id: str) -> Dict:
            """Recursively build tree for an annotation."""
            ann = self._annotations[ann_id]

            # Find all direct replies to this annotation
            replies = [
                build_tree(reply.id)
                for reply in self._annotations.values()
                if reply.parent_id == ann_id
            ]

            # Sort replies by timestamp
            replies.sort(key=lambda r: r['annotation'].timestamp)

            return {
                'annotation': ann,
                'replies': replies
            }

        return build_tree(root_id)

    def get_root_annotations(self) -> List[Annotation]:
        """Get all root annotations (annotations without parent_id).

        Returns:
            List of root annotations
        """
        return [ann for ann in self._annotations.values()
                if ann.parent_id is None]

    def get_replies(self, annotation_id: str) -> List[Annotation]:
        """Get direct replies to an annotation.

        Args:
            annotation_id: ID of parent annotation

        Returns:
            List of annotations that are direct replies
        """
        return [ann for ann in self._annotations.values()
                if ann.parent_id == annotation_id]
