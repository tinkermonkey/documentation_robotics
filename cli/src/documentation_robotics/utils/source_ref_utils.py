"""Utilities for working with source references in elements."""

from typing import Any, Dict, List, Optional, Union


def get_source_reference(element_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extract source reference from element data.

    Args:
        element_data: Element data dictionary

    Returns:
        Source reference dict if present, None otherwise
    """
    if not element_data:
        return None

    # Check for source reference in properties
    properties = element_data.get("properties", {})
    if isinstance(properties, dict):
        source = properties.get("source", {})
        if isinstance(source, dict):
            return source.get("reference")

    return None


def has_source_reference(element_data: Dict[str, Any]) -> bool:
    """
    Check if element has a source reference.

    Args:
        element_data: Element data dictionary

    Returns:
        True if element has source reference, False otherwise
    """
    return get_source_reference(element_data) is not None


def get_source_provenance(element_data: Dict[str, Any]) -> Optional[str]:
    """
    Extract source provenance type from element.

    Args:
        element_data: Element data dictionary

    Returns:
        Provenance type (extracted, manual, inferred, generated) or None
    """
    source_ref = get_source_reference(element_data)
    if source_ref and isinstance(source_ref, dict):
        return source_ref.get("provenance")

    return None


def get_source_locations(element_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract source locations from element.

    Args:
        element_data: Element data dictionary

    Returns:
        List of location dicts (with 'file', 'symbol', etc.)
    """
    source_ref = get_source_reference(element_data)
    if source_ref and isinstance(source_ref, dict):
        return source_ref.get("locations", [])

    return []


def get_repository_info(element_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extract repository info from element's source reference.

    Args:
        element_data: Element data dictionary

    Returns:
        Repository dict (with 'url', 'commit', etc.) or None
    """
    source_ref = get_source_reference(element_data)
    if source_ref and isinstance(source_ref, dict):
        return source_ref.get("repository")

    return None


def filter_elements_by_source(
    elements: List[Union[Any, Dict[str, Any]]],
    has_source_ref: Optional[bool] = None,
    provenance: Optional[str] = None,
) -> List[Union[Any, Dict[str, Any]]]:
    """
    Filter elements by source reference criteria.

    Args:
        elements: List of Element objects or dicts with data
        has_source_ref: If True, keep only elements with source refs.
                       If False, keep only elements without source refs.
                       If None, no filtering.
        provenance: Filter by provenance type (extracted, manual, inferred, generated)
                   Only used if has_source_ref is not False

    Returns:
        Filtered list of elements (same type as input)
    """
    results = []

    for element in elements:
        # Get element data - handle both Element objects and dicts
        if hasattr(element, "data"):
            element_data = element.data
        elif isinstance(element, dict):
            element_data = element
        else:
            # Can't extract data, skip filtering
            results.append(element)
            continue

        # Apply has_source_ref filter
        element_has_source = has_source_reference(element_data)

        if has_source_ref is True and not element_has_source:
            continue
        if has_source_ref is False and element_has_source:
            continue

        # Apply provenance filter (only if element has source ref)
        if provenance:
            if not element_has_source:
                continue
            element_provenance = get_source_provenance(element_data)
            if element_provenance != provenance:
                continue

        results.append(element)

    return results
