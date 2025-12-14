"""Relationship Parser - Unified parser for all relationship formats in the ontology.

This module provides a centralized parsing infrastructure for extracting relationships
from markdown layer specifications in all supported formats:
1. XML <relationship> tags (intra-layer relationships in Example Models)
2. YAML properties (cross-layer properties in entity definitions)
3. XML <property> tags (cross-layer properties in XML examples)
4. Integration Points markdown (cross-layer documentation)

This eliminates code duplication across 7+ scripts and enables comprehensive validation
of all 342+ relationships in the ontology.

Usage:
    parser = RelationshipParser()
    result = parser.parse_all_formats(content, layer_id, file_path)

    for relationship in result.relationships:
        print(f"{relationship.source} -> {relationship.target}")
"""

import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))
from link_registry import LinkRegistry


@dataclass
class ParsedRelationship:
    """Universal representation of a parsed relationship instance.

    This dataclass serves as a common format for relationships extracted from
    any of the 4 supported formats. It enables consistent validation and
    processing regardless of the source format.
    """

    # Core identification
    relationship_type: str          # e.g., "aggregation", "realization", "association"
    source: str                      # Source entity ID or type
    target: str                      # Target entity ID or type

    # Semantic metadata
    predicate: Optional[str] = None  # e.g., "supports-goals", "realizes", "aggregates"
    inverse_predicate: Optional[str] = None  # e.g., "supported-by-goals", "realized-by"

    # Source tracking
    format_type: str = ""            # "xml_relationship", "yaml_property", "integration_point", "xml_property"
    field_path: Optional[str] = None # For property-based: "motivation.supports-goals"
    location: str = ""               # File path where found
    layer_id: str = ""               # Layer identifier (e.g., "02-business")
    line_number: Optional[int] = None  # Line number in source file

    # Classification
    is_cross_layer: bool = False     # True if crosses layer boundaries
    is_intra_layer: bool = False     # True if within same layer
    value: Optional[str] = None      # Property value (for YAML/XML properties)

    # Additional context
    properties: Dict[str, Any] = field(default_factory=dict)  # Extra metadata


@dataclass
class RelationshipParseResult:
    """Result of parsing relationships from a source.

    Contains all parsed relationships plus any errors/warnings encountered
    during parsing, and aggregate metadata about the results.
    """

    relationships: List[ParsedRelationship]
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class RelationshipParser:
    """Unified parser for all relationship formats in the ontology.

    This class consolidates relationship parsing logic from 7+ scripts into
    a single shared implementation. It supports 4 relationship formats and
    provides comprehensive validation helpers.

    The parser integrates with the LinkRegistry and relationship catalog to
    provide semantic validation (predicates, types) in addition to syntactic
    validation (formats, cardinality).
    """

    # Regex patterns (compiled once, reused across parsing operations)
    # Consolidated from: intra_layer_analyzer.py, relationship_validator.py, predicate_extractor.py

    XML_RELATIONSHIP_PATTERN = re.compile(
        r'<relationship\s+type="([^"]+)"\s+source="([^"]+)"\s+target="([^"]+)"\s*/?>',
        re.IGNORECASE
    )

    XML_PROPERTY_PATTERN = re.compile(
        r'<property\s+key="([^"]+)">([^<]*)</property>',
        re.IGNORECASE
    )

    YAML_PROPERTY_PATTERN = re.compile(
        r'^\s*-\s+key:\s*"([^"]+)"\s*\n\s*value:\s*"([^"]*)"',
        re.MULTILINE
    )

    # Integration Points pattern
    # Matches: "**Entity** verb **Entity** (property.name property)"
    # Matches: "**Entity** verb **Entity**"
    INTEGRATION_POINT_PATTERN = re.compile(
        r'\*\*([A-Za-z]+(?:[A-Za-z]+)?)\*\*\s+([a-z\s-]+?)\s+\*\*([A-Za-z]+(?:[A-Za-z]+)?)\*\*(?:\s+\(([^)]+)\))?',
        re.IGNORECASE
    )

    # Element pattern for building ID -> Type mapping
    ELEMENT_PATTERN = re.compile(
        r'<element\s+id="([^"]+)"\s+type="([^"]+)"',
        re.IGNORECASE
    )

    # UUID pattern for validation
    UUID_PATTERN = re.compile(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        re.IGNORECASE
    )

    # Duration pattern (e.g., "200ms", "2s", "5m", "1h")
    DURATION_PATTERN = re.compile(r'^\d+(?:ms|s|m|h)$')

    # Percentage pattern (e.g., "99.9%", "99.95%")
    PERCENTAGE_PATTERN = re.compile(r'^\d+(?:\.\d+)?%$')

    def __init__(
        self,
        registry: Optional[LinkRegistry] = None,
        relationship_catalog: Optional[Dict] = None
    ):
        """Initialize parser with optional registry and catalog.

        Args:
            registry: LinkRegistry instance for cross-layer link validation
            relationship_catalog: Relationship catalog dict for predicate validation
        """
        self.registry = registry or LinkRegistry()
        self.relationship_catalog = relationship_catalog or self._load_catalog()

        # Element ID → Type mapping (built during parsing)
        self._element_map: Dict[str, str] = {}

    def parse_all_formats(
        self,
        content: str,
        layer_id: str,
        file_path: Path
    ) -> RelationshipParseResult:
        """Parse all relationship formats from content.

        This is the main entry point for parsing. It calls all 4 format-specific
        parsers and combines the results into a unified result.

        Args:
            content: Markdown file content
            layer_id: Layer identifier (e.g., "02-business")
            file_path: Path to the layer file

        Returns:
            RelationshipParseResult with all parsed relationships and metadata
        """
        result = RelationshipParseResult(relationships=[])
        location = str(file_path)

        # Build element map first (needed for XML relationship resolution)
        self._build_element_map(content)

        # Parse each format
        result.relationships.extend(self.parse_xml_relationships(content, layer_id, location))
        result.relationships.extend(self.parse_yaml_properties(content, layer_id, location))
        result.relationships.extend(self.parse_xml_properties(content, layer_id, location))
        result.relationships.extend(self.parse_integration_points(content, layer_id, location))

        # Add metadata
        result.metadata = {
            'total_relationships': len(result.relationships),
            'by_format': self._count_by_format(result.relationships),
            'cross_layer_count': sum(1 for r in result.relationships if r.is_cross_layer),
            'intra_layer_count': sum(1 for r in result.relationships if r.is_intra_layer),
            'with_predicates': sum(1 for r in result.relationships if r.predicate),
        }

        return result

    def parse_xml_relationships(
        self,
        content: str,
        layer_id: str,
        location: str
    ) -> List[ParsedRelationship]:
        """Parse <relationship type="..." source="..." target="..."/> tags.

        These represent intra-layer relationships in Example Model sections.
        The element IDs are resolved to entity types using the element map.

        Example:
            <relationship type="Aggregation" source="goal-1" target="goal-2"/>

        Args:
            content: Markdown file content
            layer_id: Layer identifier
            location: File path for error reporting

        Returns:
            List of ParsedRelationship objects
        """
        relationships = []

        for match in self.XML_RELATIONSHIP_PATTERN.finditer(content):
            rel_type = match.group(1)
            source_id = match.group(2)
            target_id = match.group(3)

            # Resolve element IDs to types using element map
            source_type = self._element_map.get(source_id, source_id)
            target_type = self._element_map.get(target_id, target_id)

            # Get predicate from catalog
            predicate, inverse = self._get_predicates_for_type(rel_type)

            # Determine if intra-layer (both entities in same layer)
            # For XML relationships, they're typically intra-layer by definition
            is_intra = True

            relationship = ParsedRelationship(
                relationship_type=rel_type.lower(),
                source=source_type,
                target=target_type,
                predicate=predicate,
                inverse_predicate=inverse,
                format_type="xml_relationship",
                location=location,
                layer_id=layer_id,
                is_intra_layer=is_intra,
                is_cross_layer=not is_intra,
                line_number=content[:match.start()].count('\n') + 1,
                properties={
                    'source_id': source_id,
                    'target_id': target_id,
                }
            )

            relationships.append(relationship)

        return relationships

    def parse_yaml_properties(
        self,
        content: str,
        layer_id: str,
        location: str
    ) -> List[ParsedRelationship]:
        """Parse YAML property definitions.

        These represent cross-layer properties in entity definitions.
        The format is:
            - key: "motivation.supports-goals"
              value: "goal-id-1,goal-id-2"

        Args:
            content: Markdown file content
            layer_id: Layer identifier
            location: File path for error reporting

        Returns:
            List of ParsedRelationship objects
        """
        relationships = []

        for match in self.YAML_PROPERTY_PATTERN.finditer(content):
            field_path = match.group(1)
            value = match.group(2)

            # Extract predicate from field path
            predicate = self._extract_predicate_from_field_path(field_path)

            # Find link type in registry
            link_types = self.registry.find_links_by_field_path(field_path)

            if link_types:
                link_type = link_types[0]

                # Determine relationship type from predicate or default to "property"
                rel_type = self._infer_type_from_predicate(predicate) if predicate else "property"

                relationship = ParsedRelationship(
                    relationship_type=rel_type,
                    source=layer_id,  # Source is current layer
                    target=link_type.target_layer,
                    predicate=predicate,
                    inverse_predicate=link_type.inverse_predicate,
                    format_type="yaml_property",
                    field_path=field_path,
                    location=location,
                    layer_id=layer_id,
                    is_cross_layer=True,  # YAML properties are cross-layer by definition
                    is_intra_layer=False,
                    value=value,
                    line_number=content[:match.start()].count('\n') + 1,
                    properties={
                        'link_type_id': link_type.id,
                        'cardinality': link_type.cardinality,
                        'format': link_type.format,
                    }
                )

                relationships.append(relationship)

        return relationships

    def parse_xml_properties(
        self,
        content: str,
        layer_id: str,
        location: str
    ) -> List[ParsedRelationship]:
        """Parse XML <property key="...">value</property> tags.

        These represent cross-layer properties in XML examples.

        Example:
            <property key="motivation.supports-goals">goal-example</property>

        Args:
            content: Markdown file content
            layer_id: Layer identifier
            location: File path for error reporting

        Returns:
            List of ParsedRelationship objects
        """
        relationships = []

        for match in self.XML_PROPERTY_PATTERN.finditer(content):
            field_path = match.group(1)
            value = match.group(2)

            # Extract predicate
            predicate = self._extract_predicate_from_field_path(field_path)

            # Find link type
            link_types = self.registry.find_links_by_field_path(field_path)

            if link_types:
                link_type = link_types[0]
                rel_type = self._infer_type_from_predicate(predicate) if predicate else "property"

                relationship = ParsedRelationship(
                    relationship_type=rel_type,
                    source=layer_id,
                    target=link_type.target_layer,
                    predicate=predicate,
                    inverse_predicate=link_type.inverse_predicate,
                    format_type="xml_property",
                    field_path=field_path,
                    location=location,
                    layer_id=layer_id,
                    is_cross_layer=True,
                    is_intra_layer=False,
                    value=value,
                    line_number=content[:match.start()].count('\n') + 1,
                    properties={
                        'link_type_id': link_type.id,
                    }
                )

                relationships.append(relationship)

        return relationships

    def parse_integration_points(
        self,
        content: str,
        layer_id: str,
        location: str
    ) -> List[ParsedRelationship]:
        """Parse Integration Points section markdown.

        These document cross-layer relationships in standardized markdown format.

        Examples:
            - **BusinessService** realized by **ApplicationService**
            - **BusinessProcess** automated by **ApplicationProcess** (application.realized-by-process property)

        Args:
            content: Markdown file content
            layer_id: Layer identifier
            location: File path for error reporting

        Returns:
            List of ParsedRelationship objects
        """
        relationships = []

        # First, find Integration Points section
        integration_section = self._extract_integration_points_section(content)
        if not integration_section:
            return relationships

        # Calculate offset for line numbers
        section_start = content.find(integration_section)
        lines_before_section = content[:section_start].count('\n') if section_start >= 0 else 0

        for match in self.INTEGRATION_POINT_PATTERN.finditer(integration_section):
            source_entity = match.group(1)
            verb = match.group(2).strip()
            target_entity = match.group(3)
            property_ref = match.group(4) if match.group(4) else None

            # Parse property reference if exists
            field_path = None
            if property_ref:
                # Extract field path from: "application.realized-by-process property"
                field_match = re.search(r'([\w.-]+)\s+property', property_ref)
                if field_match:
                    field_path = field_match.group(1)

            # Infer predicate from verb or field path
            predicate = self._normalize_verb_to_predicate(verb)
            if field_path:
                extracted_predicate = self._extract_predicate_from_field_path(field_path)
                if extracted_predicate:
                    predicate = extracted_predicate

            # Determine target layer from entity type
            target_layer = self._infer_layer_from_entity_type(target_entity)

            relationship = ParsedRelationship(
                relationship_type=self._infer_type_from_verb(verb),
                source=source_entity,
                target=target_entity,
                predicate=predicate,
                format_type="integration_point",
                field_path=field_path,
                location=location,
                layer_id=layer_id,
                is_cross_layer=True,  # Integration points are cross-layer
                is_intra_layer=False,
                line_number=lines_before_section + integration_section[:match.start()].count('\n') + 1,
                properties={
                    'verb': verb,
                    'target_layer': target_layer,
                }
            )

            relationships.append(relationship)

        return relationships

    # ==================== Helper Methods ====================

    def _build_element_map(self, content: str) -> None:
        """Build mapping of element IDs to types from XML examples.

        This is used to resolve XML relationship source/target IDs to
        entity types.

        Args:
            content: Markdown file content
        """
        self._element_map.clear()

        for match in self.ELEMENT_PATTERN.finditer(content):
            element_id = match.group(1)
            element_type = match.group(2)
            self._element_map[element_id] = element_type

    def _extract_predicate_from_field_path(self, field_path: str) -> Optional[str]:
        """Extract predicate from field path.

        Examples:
            "motivation.supports-goals" → "supports-goals"
            "x-supports-goals" → "supports-goals"
            "supports-goals" → "supports-goals"

        Args:
            field_path: Property field path

        Returns:
            Extracted predicate or None
        """
        if not field_path:
            return None

        if field_path.startswith("x-"):
            return field_path[2:]
        elif "." in field_path:
            return field_path.split(".", 1)[1]
        else:
            return field_path

    def _get_predicates_for_type(self, rel_type: str) -> Tuple[Optional[str], Optional[str]]:
        """Get forward and inverse predicates from relationship catalog.

        Args:
            rel_type: Relationship type (e.g., "Aggregation", "Realization")

        Returns:
            Tuple of (predicate, inverse_predicate)
        """
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("id", "").lower() == rel_type.lower():
                return rel.get("predicate"), rel.get("inversePredicate")
        return None, None

    def _infer_type_from_predicate(self, predicate: str) -> str:
        """Infer relationship type from predicate.

        Looks up predicate in catalog and returns the relationship type.

        Args:
            predicate: Relationship predicate

        Returns:
            Relationship type or the predicate itself if not found
        """
        if not predicate:
            return "unknown"

        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("predicate") == predicate:
                return rel.get("id", predicate).lower()
        return predicate

    def _normalize_verb_to_predicate(self, verb: str) -> str:
        """Normalize integration point verb to predicate.

        Examples:
            "realized by" → "realized-by"
            "automated by" → "automated-by"
            "supports" → "supports"

        Args:
            verb: Verb phrase from Integration Points

        Returns:
            Normalized predicate
        """
        return verb.replace(" ", "-").lower()

    def _infer_type_from_verb(self, verb: str) -> str:
        """Infer relationship type from verb.

        Args:
            verb: Verb phrase

        Returns:
            Inferred relationship type
        """
        verb_lower = verb.lower()

        if "realize" in verb_lower:
            return "realization"
        elif "automat" in verb_lower:
            return "automation"
        elif "represent" in verb_lower:
            return "representation"
        elif "trigger" in verb_lower:
            return "triggering"
        elif "deliver" in verb_lower or "support" in verb_lower:
            return "traceability"
        elif "govern" in verb_lower:
            return "governance"
        elif "reference" in verb_lower:
            return "reference"
        elif "link" in verb_lower:
            return "association"
        elif "define" in verb_lower:
            return "composition"
        elif "track" in verb_lower or "monitor" in verb_lower:
            return "observation"

        return verb_lower.replace(" ", "_")

    def _extract_integration_points_section(self, content: str) -> Optional[str]:
        """Extract Integration Points section from markdown.

        Args:
            content: Markdown file content

        Returns:
            Integration Points section content or None
        """
        match = re.search(
            r'^##\s+Integration Points\s*$(.+?)(?=^##|\Z)',
            content,
            re.MULTILINE | re.DOTALL
        )
        return match.group(1) if match else None

    def _infer_layer_from_entity_type(self, entity_type: str) -> str:
        """Infer layer ID from entity type name.

        Examples:
            "ApplicationService" → "04-application"
            "BusinessService" → "02-business"
            "Goal" → "01-motivation"

        Args:
            entity_type: Entity type name

        Returns:
            Inferred layer ID
        """
        entity_lower = entity_type.lower()

        if entity_lower.startswith("business"):
            return "02-business"
        elif entity_lower.startswith("security"):
            return "03-security"
        elif entity_lower.startswith("application"):
            return "04-application"
        elif entity_lower.startswith("technology"):
            return "05-technology"
        elif entity_lower.startswith("api"):
            return "06-api"
        elif entity_lower.startswith("data") or entity_lower.startswith("schema"):
            return "07-data-model"
        elif entity_lower.startswith("table") or entity_lower.startswith("database"):
            return "08-datastore"
        elif entity_lower.startswith("ux") or entity_lower.startswith("experience") or entity_lower.startswith("screen"):
            return "09-ux"
        elif entity_lower.startswith("navigation") or entity_lower.startswith("route") or entity_lower.startswith("flow"):
            return "10-navigation"
        elif entity_lower.startswith("metric") or entity_lower.startswith("apm"):
            return "11-apm-observability"
        elif entity_lower.startswith("test"):
            return "12-testing"
        elif any(x in entity_lower for x in ["goal", "value", "stakeholder", "requirement", "principle"]):
            return "01-motivation"

        return "unknown"

    def _count_by_format(self, relationships: List[ParsedRelationship]) -> Dict[str, int]:
        """Count relationships by format type.

        Args:
            relationships: List of parsed relationships

        Returns:
            Dict mapping format type to count
        """
        counts = defaultdict(int)
        for rel in relationships:
            counts[rel.format_type] += 1
        return dict(counts)

    def _load_catalog(self) -> Dict:
        """Load relationship catalog from JSON.

        Returns:
            Relationship catalog dict or empty dict if not found
        """
        script_dir = Path(__file__).parent.parent
        catalog_path = script_dir.parent / "spec" / "schemas" / "relationship-catalog.json"

        if catalog_path.exists():
            with open(catalog_path, "r", encoding="utf-8") as f:
                return json.load(f)

        return {"relationshipTypes": []}

    # ==================== Validation Helpers ====================

    def validate_relationship(
        self,
        relationship: ParsedRelationship,
        strict: bool = False
    ) -> List[Dict[str, Any]]:
        """Validate a single parsed relationship.

        Performs format validation, cardinality checks, and predicate validation.

        Args:
            relationship: Parsed relationship to validate
            strict: If True, perform stricter validation

        Returns:
            List of validation issues (dicts with severity, category, message, etc.)
        """
        issues = []

        # Format validation for property-based relationships
        if relationship.format_type in ["yaml_property", "xml_property"]:
            if relationship.value:
                link_type_id = relationship.properties.get('link_type_id')
                if link_type_id:
                    link_type = self.registry.link_types.get(link_type_id)
                    if link_type:
                        format_issues = self._validate_value_format(
                            relationship.value,
                            link_type,
                            relationship.field_path,
                            relationship.location
                        )
                        issues.extend(format_issues)

        # Predicate consistency - only validate predicates for structural relationships
        # Property-based relationships (yaml_property, xml_property) use predicates
        # derived from field paths and don't need to be in the catalog
        if relationship.predicate and relationship.format_type == "xml_relationship":
            if not self._is_valid_predicate(relationship.predicate):
                issues.append({
                    'severity': 'warning',
                    'category': 'predicate',
                    'message': f"Predicate '{relationship.predicate}' not found in catalog",
                    'location': relationship.location,
                    'field_path': relationship.field_path,
                    'suggestion': 'Add this predicate to relationship-catalog.json or verify the relationship type is correct',
                })

        return issues

    def _validate_value_format(
        self,
        value: str,
        link_type: Any,
        field_path: str,
        location: str
    ) -> List[Dict[str, Any]]:
        """Validate value format for property-based relationships.

        Args:
            value: Property value
            link_type: LinkType from registry
            field_path: Property field path
            location: File path

        Returns:
            List of validation issues
        """
        issues = []

        # Skip documentation examples (pipe-separated options)
        if '|' in value:
            return issues

        # Split if array
        values = [v.strip() for v in value.split(',')] if ',' in value else [value]

        # Cardinality check
        if not link_type.is_array and len(values) > 1:
            issues.append({
                'severity': 'error',
                'category': 'cardinality',
                'message': f"Link expects single value but has {len(values)}",
                'location': location,
                'field_path': field_path,
                'expected': 'Single value',
                'actual': value,
            })

        # Format validation
        for val in values:
            if not val:
                continue

            if link_type.format == "uuid":
                if not self._is_valid_uuid(val):
                    issues.append({
                        'severity': 'error',
                        'category': 'format',
                        'message': 'Invalid UUID format',
                        'location': location,
                        'field_path': field_path,
                        'expected': 'UUID',
                        'actual': val,
                    })
            elif link_type.format == "duration":
                if not self.DURATION_PATTERN.match(val):
                    issues.append({
                        'severity': 'warning',
                        'category': 'format',
                        'message': 'Invalid duration format',
                        'location': location,
                        'field_path': field_path,
                        'expected': 'Duration (e.g., 200ms, 2s, 5m)',
                        'actual': val,
                    })
            elif link_type.format == "percentage":
                if not self.PERCENTAGE_PATTERN.match(val):
                    issues.append({
                        'severity': 'warning',
                        'category': 'format',
                        'message': 'Invalid percentage format',
                        'location': location,
                        'field_path': field_path,
                        'expected': 'Percentage (e.g., 99.9%)',
                        'actual': val,
                    })

        return issues

    def _is_valid_uuid(self, value: str) -> bool:
        """Check if value is valid UUID.

        Args:
            value: String to validate

        Returns:
            True if valid UUID
        """
        return bool(self.UUID_PATTERN.match(value))

    def _is_valid_predicate(self, predicate: str) -> bool:
        """Check if predicate exists in catalog.

        Args:
            predicate: Predicate to validate

        Returns:
            True if predicate exists in catalog
        """
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("predicate") == predicate or rel.get("inversePredicate") == predicate:
                return True
        return False
