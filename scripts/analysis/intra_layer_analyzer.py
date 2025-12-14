"""Intra-Layer Relationship Analyzer - Extracts and validates same-layer relationships.

This module identifies relationships between entities within the same layer,
providing gap analysis and coverage metrics for internal layer structure.
"""

import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from generators.markdown_parser import MarkdownLayerParser, EntityDefinition, LayerSpec


@dataclass
class IntraLayerRelationship:
    """Represents a relationship between entities within the same layer."""

    relationship_type: str  # "aggregation", "realization", "influence", etc.
    source_entity: str  # e.g., "Goal"
    target_entity: str  # e.g., "Outcome"
    predicate: str  # e.g., "aggregates", "realizes"
    inverse_predicate: Optional[str] = None  # e.g., "aggregated-by", "realized-by"
    source_location: str = ""  # Where found: "xml_example", "relationships_section", "property"
    layer_id: str = ""  # e.g., "01-motivation"
    documented: bool = False  # True if in Relationships section
    has_xml_example: bool = False  # True if demonstrated in XML
    in_relationship_catalog: bool = False  # True if in relationship-catalog.json
    archimate_alignment: Optional[str] = None  # ArchiMate relationship type if aligned


@dataclass
class EntityRelationshipProfile:
    """Complete relationship profile for a single entity."""

    entity_name: str
    entity_description: str
    layer_id: str

    # Relationships where this entity is the source
    outgoing_relationships: List[IntraLayerRelationship] = field(default_factory=list)

    # Relationships where this entity is the target
    incoming_relationships: List[IntraLayerRelationship] = field(default_factory=list)

    @property
    def total_relationships(self) -> int:
        """Total number of relationships (incoming + outgoing)."""
        return len(self.outgoing_relationships) + len(self.incoming_relationships)

    @property
    def documented_count(self) -> int:
        """Number of relationships documented in Relationships section."""
        return sum(
            1
            for r in self.outgoing_relationships + self.incoming_relationships
            if r.documented
        )

    @property
    def xml_example_count(self) -> int:
        """Number of relationships with XML examples."""
        return sum(
            1
            for r in self.outgoing_relationships + self.incoming_relationships
            if r.has_xml_example
        )

    @property
    def catalog_coverage_count(self) -> int:
        """Number of relationships in relationship catalog."""
        return sum(
            1
            for r in self.outgoing_relationships + self.incoming_relationships
            if r.in_relationship_catalog
        )


@dataclass
class LayerIntraRelationshipReport:
    """Complete intra-layer relationship report for a single layer."""

    layer_id: str
    layer_spec: LayerSpec
    entity_profiles: Dict[str, EntityRelationshipProfile]

    # All relationships extracted (for validation)
    xml_relationships: List[IntraLayerRelationship] = field(default_factory=list)
    documented_relationships: List[IntraLayerRelationship] = field(default_factory=list)

    # Coverage target: minimum relationships per entity
    COVERAGE_TARGET = 2

    @property
    def total_entities(self) -> int:
        """Total number of entities in layer."""
        return len(self.entity_profiles)

    @property
    def total_relationships(self) -> int:
        """Total number of intra-layer relationships."""
        # Count unique relationships (avoid double-counting bidirectional)
        seen = set()
        count = 0
        for profile in self.entity_profiles.values():
            for rel in profile.outgoing_relationships:
                key = (rel.source_entity, rel.predicate, rel.target_entity)
                if key not in seen:
                    seen.add(key)
                    count += 1
        return count

    @property
    def entities_meeting_target(self) -> int:
        """Number of entities with at least COVERAGE_TARGET relationships."""
        return sum(
            1 for profile in self.entity_profiles.values()
            if profile.total_relationships >= self.COVERAGE_TARGET
        )

    @property
    def entity_coverage_percentage(self) -> float:
        """Percentage of entities meeting coverage target (at least 2 relationships)."""
        if self.total_entities == 0:
            return 0.0
        return (self.entities_meeting_target / self.total_entities) * 100

    @property
    def catalog_coverage_percentage(self) -> float:
        """Percentage of relationships in catalog."""
        if self.total_relationships == 0:
            return 0.0
        catalog_count = sum(
            profile.catalog_coverage_count for profile in self.entity_profiles.values()
        )
        # Avoid double counting
        return (catalog_count / (self.total_relationships * 2)) * 100


class IntraLayerAnalyzer:
    """Analyzes and extracts intra-layer relationships from layer specifications."""

    def __init__(self, spec_root: Optional[Path] = None):
        """Initialize the analyzer.

        Args:
            spec_root: Path to spec/ directory. If None, auto-detects.
        """
        self.spec_root = spec_root or self._find_spec_root()
        self.layers_path = self.spec_root / "layers"

        # CLOSED LOOP: Reuse existing parser
        self.markdown_parser = MarkdownLayerParser()

        # NEW: Use shared relationship parser
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from utils.relationship_parser import RelationshipParser
        self.relationship_parser = RelationshipParser()

        # Load relationship catalog
        self.relationship_catalog = self._load_relationship_catalog()

    def _find_spec_root(self) -> Path:
        """Auto-detect spec root directory."""
        script_dir = Path(__file__).parent.parent
        spec_root = script_dir.parent / "spec"

        if not spec_root.exists() or not (spec_root / "layers").exists():
            raise FileNotFoundError(
                f"Could not find spec/layers directory at {spec_root}. "
                "Run from repository root."
            )

        return spec_root

    def _load_relationship_catalog(self) -> Dict:
        """Load relationship catalog from JSON."""
        catalog_path = self.spec_root / "schemas" / "relationship-catalog.json"

        if not catalog_path.exists():
            print(f"Warning: Relationship catalog not found at {catalog_path}")
            return {"relationshipTypes": []}

        with open(catalog_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def analyze_layer(self, layer_id: str) -> LayerIntraRelationshipReport:
        """Analyze all intra-layer relationships for a single layer.

        Args:
            layer_id: Layer identifier (e.g., "01-motivation")

        Returns:
            Complete intra-layer relationship report
        """
        # Find layer file
        layer_files = list(self.layers_path.glob(f"{layer_id}*.md"))
        if not layer_files:
            raise FileNotFoundError(f"Layer file not found for {layer_id}")

        layer_file = layer_files[0]

        # CLOSED LOOP: Parse layer using standard parser
        layer_spec = self.markdown_parser.parse(layer_file)

        # Read raw content for relationship extraction
        content = layer_file.read_text(encoding="utf-8")

        # NEW: Use shared parser for XML relationships
        parse_result = self.relationship_parser.parse_all_formats(content, layer_id, layer_file)

        # Filter to intra-layer XML relationships only
        xml_relationships = [
            self._convert_to_intra_layer_relationship(r)
            for r in parse_result.relationships
            if r.format_type == "xml_relationship" and r.is_intra_layer
        ]

        # Keep existing documented relationship extraction
        documented_relationships = self._extract_documented_relationships(content, layer_id)

        # Build entity profiles
        entity_profiles = {}
        for entity_name, entity_def in layer_spec.entities.items():
            profile = self._build_entity_profile(
                entity_name,
                entity_def,
                xml_relationships,
                documented_relationships,
                layer_id,
            )
            entity_profiles[entity_name] = profile

        return LayerIntraRelationshipReport(
            layer_id=layer_id,
            layer_spec=layer_spec,
            entity_profiles=entity_profiles,
            xml_relationships=xml_relationships,
            documented_relationships=documented_relationships,
        )

    def analyze_all_layers(self) -> Dict[str, LayerIntraRelationshipReport]:
        """Analyze all layers and produce comprehensive report.

        Returns:
            Dictionary mapping layer ID to report
        """
        reports = {}

        for layer_file in sorted(self.layers_path.glob("*.md")):
            # Extract layer ID from filename (e.g., "02-business-layer.md" -> "02-business")
            if not layer_file.stem.endswith("-layer"):
                continue

            layer_id = layer_file.stem.replace("-layer", "")

            try:
                report = self.analyze_layer(layer_id)
                reports[layer_id] = report
            except Exception as e:
                print(f"Warning: Failed to analyze layer {layer_id}: {e}")
                continue

        return reports

    def _convert_to_intra_layer_relationship(
        self, parsed_rel
    ) -> IntraLayerRelationship:
        """Convert ParsedRelationship to IntraLayerRelationship.

        Args:
            parsed_rel: ParsedRelationship from shared parser

        Returns:
            IntraLayerRelationship for this analyzer
        """
        rel = IntraLayerRelationship(
            relationship_type=parsed_rel.relationship_type,
            source_entity=parsed_rel.source,
            target_entity=parsed_rel.target,
            predicate=parsed_rel.predicate or "",
            inverse_predicate=parsed_rel.inverse_predicate,
            source_location="xml_example",
            layer_id=parsed_rel.layer_id,
            has_xml_example=True,
        )

        # Check if in catalog
        rel.in_relationship_catalog = self._match_to_catalog(rel, parsed_rel.layer_id)
        rel.archimate_alignment = self._get_archimate_alignment(parsed_rel.relationship_type)

        return rel

    def _extract_documented_relationships(
        self, content: str, layer_id: str
    ) -> List[IntraLayerRelationship]:
        """Extract relationships from ## Relationships section.

        Args:
            content: Layer markdown content
            layer_id: Layer identifier

        Returns:
            List of documented relationships
        """
        relationships = []

        # Find Relationships section (stop at next h2 header or end of file)
        relationships_section_match = re.search(
            r"^##\s+Relationships\s*$(.+?)(?=^##\s+[^#]|\Z)",
            content,
            re.MULTILINE | re.DOTALL,
        )

        if not relationships_section_match:
            return relationships

        section_content = relationships_section_match.group(1)

        # Pattern: - **SourceEntity predicate TargetEntity**: Description
        # Example: - **Product aggregates BusinessService**: Products bundle services...
        relationship_line_pattern = re.compile(
            r"-\s+\*\*(\w+)\s+([\w-]+)\s+(\w+)\*\*:",
            re.IGNORECASE,
        )

        for match in relationship_line_pattern.finditer(section_content):
            source_entity = match.group(1)
            predicate = match.group(2)
            target_entity = match.group(3)
            # Infer relationship type from predicate
            relationship_type = predicate.replace("-", " ")

            rel = IntraLayerRelationship(
                relationship_type=relationship_type.lower(),
                source_entity=source_entity,
                target_entity=target_entity,
                predicate=predicate,
                inverse_predicate=self._infer_inverse_predicate(predicate),
                source_location="relationships_section",
                layer_id=layer_id,
                documented=True,
            )

            rel.in_relationship_catalog = self._match_to_catalog(rel, layer_id)
            rel.archimate_alignment = self._get_archimate_alignment(rel.relationship_type)

            relationships.append(rel)

        return relationships

    def _build_entity_profile(
        self,
        entity_name: str,
        entity_def: EntityDefinition,
        xml_relationships: List[IntraLayerRelationship],
        documented_relationships: List[IntraLayerRelationship],
        layer_id: str,
    ) -> EntityRelationshipProfile:
        """Build complete relationship profile for an entity.

        Args:
            entity_name: Name of the entity
            entity_def: Entity definition from parser
            xml_relationships: Relationships from XML examples
            documented_relationships: Relationships from docs
            layer_id: Layer identifier

        Returns:
            Complete entity relationship profile
        """
        profile = EntityRelationshipProfile(
            entity_name=entity_name,
            entity_description=entity_def.description,
            layer_id=layer_id,
        )

        # Combine all relationships
        all_relationships = xml_relationships + documented_relationships

        # Deduplicate and categorize
        seen_outgoing = set()
        seen_incoming = set()

        for rel in all_relationships:
            # Outgoing relationships (this entity is source)
            if rel.source_entity == entity_name:
                key = (rel.predicate, rel.target_entity)
                if key not in seen_outgoing:
                    seen_outgoing.add(key)
                    profile.outgoing_relationships.append(rel)

            # Incoming relationships (this entity is target)
            if rel.target_entity == entity_name:
                key = (rel.predicate, rel.source_entity)
                if key not in seen_incoming:
                    seen_incoming.add(key)
                    profile.incoming_relationships.append(rel)

        return profile

    def _is_intra_layer_relationship(
        self, source: str, target: str, content: str
    ) -> bool:
        """Check if both source and target are entities in the same layer.

        Args:
            source: Source entity name
            target: Target entity name
            content: Layer markdown content

        Returns:
            True if both are likely entities in this layer
        """
        # Simple heuristic: check if both appear as entity headers (### EntityName)
        source_pattern = re.compile(rf"^###\s+{re.escape(source)}\s*$", re.MULTILINE)
        target_pattern = re.compile(rf"^###\s+{re.escape(target)}\s*$", re.MULTILINE)

        return bool(source_pattern.search(content) and target_pattern.search(content))

    def _get_predicate_for_type(self, relationship_type: str) -> str:
        """Get predicate from relationship catalog for a type.

        Args:
            relationship_type: Relationship type (e.g., "Aggregation")

        Returns:
            Predicate string (e.g., "aggregates")
        """
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("id", "").lower() == relationship_type.lower():
                return rel.get("predicate", relationship_type.lower())

        # Fallback: use type name as predicate
        return relationship_type.lower()

    def _get_inverse_predicate_for_type(self, relationship_type: str) -> Optional[str]:
        """Get inverse predicate from relationship catalog.

        Args:
            relationship_type: Relationship type

        Returns:
            Inverse predicate or None
        """
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("id", "").lower() == relationship_type.lower():
                return rel.get("inversePredicate")

        return None

    def _get_archimate_alignment(self, relationship_type: str) -> Optional[str]:
        """Get ArchiMate alignment from relationship catalog.

        Args:
            relationship_type: Relationship type

        Returns:
            ArchiMate alignment or None
        """
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("id", "").lower() == relationship_type.lower():
                return rel.get("archimateAlignment")

        return None

    def _infer_type_from_predicate(self, predicate: str) -> str:
        """Infer relationship type from predicate.

        Args:
            predicate: Predicate string (e.g., "aggregates")

        Returns:
            Relationship type (e.g., "aggregation")
        """
        # Look up in catalog
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("predicate") == predicate:
                return rel.get("id", predicate)

        # Fallback: use predicate itself
        return predicate

    def _infer_inverse_predicate(self, predicate: str) -> Optional[str]:
        """Infer inverse predicate.

        Args:
            predicate: Forward predicate

        Returns:
            Inverse predicate or None
        """
        # Look up in catalog
        for rel in self.relationship_catalog.get("relationshipTypes", []):
            if rel.get("predicate") == predicate:
                return rel.get("inversePredicate")

        # Fallback: add "-by" suffix
        if not predicate.endswith("-by"):
            return f"{predicate}-by"

        return None

    def _match_to_catalog(self, rel: IntraLayerRelationship, layer_id: str) -> bool:
        """Check if relationship exists in relationship catalog.

        Args:
            rel: Relationship to check
            layer_id: Layer ID (e.g., "01-motivation")

        Returns:
            True if relationship is in catalog and applicable to this layer
        """
        # Extract layer number from ID
        layer_num = layer_id.split("-")[0]

        for catalog_rel in self.relationship_catalog.get("relationshipTypes", []):
            # Match by relationship type, predicate, or inverse predicate
            type_match = (
                catalog_rel.get("id", "").lower() == rel.relationship_type.lower()
                or catalog_rel.get("predicate") == rel.predicate
                or catalog_rel.get("inversePredicate") == rel.predicate
            )

            if type_match:
                # Check if applicable to this layer
                applicable_layers = catalog_rel.get("applicableLayers", [])

                if layer_num in applicable_layers:
                    return True

        return False
