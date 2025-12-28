"""
Element ID generation utilities.
"""

import re


def generate_element_id(layer: str, element_type: str, name: str) -> str:
    """
    Generate element ID following convention: {layer}.{type}.{kebab-name}

    Args:
        layer: Layer name
        element_type: Element type
        name: Element name

    Returns:
        Generated ID string

    Examples:
        >>> generate_element_id("business", "service", "Customer Management")
        'business.service.customer-management'
    """
    # Convert name to kebab-case
    kebab_name = to_kebab_case(name)

    return f"{layer}.{element_type}.{kebab_name}"


def to_kebab_case(text: str) -> str:
    """
    Convert text to kebab-case.

    Examples:
        >>> to_kebab_case("Customer Management")
        'customer-management'
        >>> to_kebab_case("CustomerManagement")
        'customer-management'
        >>> to_kebab_case("customer_management")
        'customer-management'
    """
    # Replace spaces and underscores with hyphens
    text = re.sub(r"[\s_]+", "-", text)

    # Insert hyphen before capital letters (for camelCase/PascalCase)
    text = re.sub(r"([a-z])([A-Z])", r"\1-\2", text)

    # Convert to lowercase
    text = text.lower()

    # Remove multiple consecutive hyphens
    text = re.sub(r"-+", "-", text)

    # Remove leading/trailing hyphens
    text = text.strip("-")

    return text
