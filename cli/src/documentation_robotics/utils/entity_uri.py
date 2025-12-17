"""Entity URI parsing and validation.

Entity URIs reference elements in the architecture model and optionally
their attributes using fragment notation:
  - Entity: layer.type.name
  - Attribute: layer.type.name#properties.path.to.attribute
"""

from typing import Optional, Tuple, Any


class EntityUriParser:
    """Parse and validate entity URIs."""

    @staticmethod
    def parse(uri: str) -> Tuple[str, Optional[str]]:
        """Parse URI into (element_id, attribute_path).

        Args:
            uri: Entity URI to parse

        Returns:
            Tuple of (element_id, attribute_path). attribute_path is None
            if URI references an entity without a specific attribute.

        Examples:
            >>> EntityUriParser.parse("motivation.goal.deliver-value")
            ("motivation.goal.deliver-value", None)

            >>> EntityUriParser.parse("motivation.goal.deliver-value#properties.priority")
            ("motivation.goal.deliver-value", "properties.priority")
        """
        if '#' in uri:
            element_id, fragment = uri.split('#', 1)
            return element_id, fragment
        return uri, None

    @staticmethod
    def validate(uri: str, model) -> bool:
        """Validate URI references exist in model.

        Checks that:
        1. The element referenced by the URI exists in the model
        2. If an attribute path is specified, it resolves to a valid value

        Args:
            uri: Entity URI to validate
            model: Model instance from core.model.Model

        Returns:
            True if entity exists and attribute path is valid (if specified),
            False otherwise
        """
        element_id, attribute_path = EntityUriParser.parse(uri)

        # Check entity exists using model.get_element()
        element = model.get_element(element_id)
        if not element:
            return False

        # If no attribute path specified, validation passes
        if not attribute_path:
            return True

        # Validate attribute path exists in element data
        return EntityUriParser._resolve_attribute_path(element.data, attribute_path) is not None

    @staticmethod
    def _resolve_attribute_path(data: Any, path: str) -> Optional[Any]:
        """Resolve attribute path in element data.

        Navigates through nested dictionaries following the path.

        Args:
            data: Element data dictionary
            path: Dot-separated attribute path (e.g., "properties.priority")

        Returns:
            Value at the path if it exists, None otherwise
        """
        parts = path.split('.')
        current = data

        for part in parts:
            if not isinstance(current, dict) or part not in current:
                return None
            current = current[part]

        return current

    @staticmethod
    def format_entity_uri(element_id: str, attribute_path: Optional[str] = None) -> str:
        """Format element ID and attribute path into entity URI.

        Args:
            element_id: Element ID (layer.type.name)
            attribute_path: Optional attribute path

        Returns:
            Formatted entity URI

        Examples:
            >>> EntityUriParser.format_entity_uri("motivation.goal.deliver-value")
            "motivation.goal.deliver-value"

            >>> EntityUriParser.format_entity_uri("motivation.goal.deliver-value", "properties.priority")
            "motivation.goal.deliver-value#properties.priority"
        """
        if attribute_path:
            return f"{element_id}#{attribute_path}"
        return element_id
