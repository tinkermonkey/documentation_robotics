#!/usr/bin/env python3
"""
LadybugDB Query Library for Documentation Robotics Specification

Provides a collection of pre-built queries for spec maintainers to explore
and validate the ontology.

Usage:
    python scripts/tools/ladybug_queries.py [--db-path PATH] [--query QUERY_NAME]
"""

import argparse
from pathlib import Path
import sys

try:
    import real_ladybug as lb
except ImportError:
    print("ERROR: LadybugDB not found. Install with: pip install real_ladybug")
    print("Documentation: https://docs.ladybugdb.com/")
    sys.exit(1)


class SpecQueries:
    """Pre-built queries for spec exploration and validation."""

    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            print(f"ERROR: Database not found at {self.db_path}")
            print("Run: python scripts/tools/ladybug_importer.py")
            sys.exit(1)

        self.db = lb.Database(str(self.db_path))
        self.conn = lb.Connection(self.db)

    def execute_query(self, name: str, query: str, description: str = None):
        """Execute a query and print formatted results."""
        print("=" * 80)
        print(f"Query: {name}")
        if description:
            print(f"Description: {description}")
        print("=" * 80)
        print(f"\nCypher:\n{query}\n")
        print("-" * 80)

        try:
            result = self.conn.execute(query)

            # Get all results using LadybugDB API
            rows = result.get_all()

            # Print results
            if rows:
                print("Results:")
                for row in rows:
                    print("  ", row)
                print(f"\nTotal: {len(rows)} row(s)")
            else:
                print("No results found.")

        except Exception as e:
            print(f"ERROR: {e}")

        print("=" * 80)
        print()

    # ========================================================================
    # Layer Exploration Queries
    # ========================================================================

    def list_layers(self):
        """List all layers in the specification."""
        self.execute_query(
            name="List All Layers",
            description="Show all 12 layers in the Documentation Robotics specification",
            query="""
                MATCH (l:Layer)
                RETURN l.id AS ID, l.name AS Name, l.description AS Description
                ORDER BY l.id
            """
        )

    def layer_entity_counts(self):
        """Count entities defined in each layer."""
        self.execute_query(
            name="Entity Count by Layer",
            description="Count how many entity types are defined in each layer",
            query="""
                MATCH (l:Layer)-[:DEFINES]->(e:EntityType)
                RETURN l.id AS LayerID, l.name AS Layer, count(e) AS EntityCount
                ORDER BY l.id
            """
        )

    def layer_link_matrix(self):
        """Show cross-layer link matrix."""
        self.execute_query(
            name="Cross-Layer Link Matrix",
            description="Show which layers link to which other layers",
            query="""
                MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer),
                      (lt)-[:LINKS_TO]->(target:Layer)
                RETURN source.id AS From,
                       target.id AS To,
                       count(lt) AS LinkTypes,
                       collect(lt.category) AS Categories
                ORDER BY source.id, target.id
            """
        )

    # ========================================================================
    # Traceability Queries
    # ========================================================================

    def traceability_paths(self):
        """Find all traceability relationship paths."""
        self.execute_query(
            name="Traceability Paths",
            description="Find paths using traceability relationships (goals, requirements, value)",
            query="""
                MATCH (lt:LinkType)
                WHERE lt.relationshipCategory = 'traceability'
                RETURN lt.id AS LinkID,
                       lt.name AS Name,
                       lt.predicate AS Predicate,
                       lt.inversePredicate AS Inverse,
                       lt.strength AS Strength
                ORDER BY lt.strength DESC, lt.name
            """
        )

    def motivation_links(self):
        """Find all links to Motivation layer."""
        self.execute_query(
            name="Motivation Layer Links",
            description="Show all link types that reference the Motivation layer",
            query="""
                MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer),
                      (lt)-[:LINKS_TO]->(target:Layer {id: '01'})
                RETURN source.name AS SourceLayer,
                       lt.name AS LinkType,
                       lt.predicate AS Predicate,
                       lt.strength AS Strength
                ORDER BY source.id, lt.name
            """
        )

    def requirement_fulfillment_chain(self):
        """Show requirement fulfillment relationships."""
        self.execute_query(
            name="Requirement Fulfillment Chain",
            description="Links showing how requirements are fulfilled across layers",
            query="""
                MATCH (lt:LinkType)
                WHERE lt.predicate = 'fulfills-requirements'
                      OR lt.predicate = 'fulfilled-by'
                RETURN lt.id AS LinkID,
                       lt.name AS Name,
                       lt.predicate AS Predicate,
                       lt.bidirectional AS Bidirectional
            """
        )

    # ========================================================================
    # Security & Governance Queries
    # ========================================================================

    def security_links(self):
        """Find all security-related links."""
        self.execute_query(
            name="Security Links",
            description="Show all link types in the security category",
            query="""
                MATCH (lt:LinkType)
                WHERE lt.category = 'security'
                RETURN lt.id AS LinkID,
                       lt.name AS Name,
                       lt.predicate AS Predicate,
                       lt.strength AS Strength
                ORDER BY lt.strength DESC, lt.name
            """
        )

    def governance_predicates(self):
        """Find governance-related predicates."""
        self.execute_query(
            name="Governance Predicates",
            description="Show predicates used for governance relationships",
            query="""
                MATCH (p:Predicate)
                WHERE p.category = 'governance'
                RETURN p.name AS Predicate,
                       p.inversePredicate AS Inverse,
                       p.transitivity AS Transitive,
                       p.archimateAlignment AS ArchiMate
                ORDER BY p.name
            """
        )

    def critical_links(self):
        """Find all critical strength links."""
        self.execute_query(
            name="Critical Strength Links",
            description="Link types with critical or high strength ratings",
            query="""
                MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer),
                      (lt)-[:LINKS_TO]->(target:Layer)
                WHERE lt.strength IN ['critical', 'high']
                RETURN lt.strength AS Strength,
                       lt.name AS LinkName,
                       source.name AS From,
                       target.name AS To,
                       lt.predicate AS Predicate
                ORDER BY lt.strength DESC, lt.name
            """
        )

    # ========================================================================
    # Predicate Analysis Queries
    # ========================================================================

    def predicate_usage(self):
        """Show predicate usage statistics."""
        self.execute_query(
            name="Predicate Usage Statistics",
            description="Count how many link types use each predicate",
            query="""
                MATCH (lt:LinkType)-[:USES_PREDICATE]->(p:Predicate)
                RETURN p.name AS Predicate,
                       p.category AS Category,
                       count(lt) AS UsageCount,
                       p.inversePredicate AS Inverse
                ORDER BY UsageCount DESC, p.name
            """
        )

    def bidirectional_relationships(self):
        """Find all bidirectional relationships."""
        self.execute_query(
            name="Bidirectional Relationships",
            description="Link types that support inverse traversal",
            query="""
                MATCH (lt:LinkType)
                WHERE lt.bidirectional = true
                RETURN lt.name AS LinkType,
                       lt.predicate AS Predicate,
                       lt.inversePredicate AS Inverse,
                       lt.relationshipCategory AS Category
                ORDER BY lt.relationshipCategory, lt.name
            """
        )

    def predicates_without_inverse(self):
        """Find predicates with no inverse defined."""
        self.execute_query(
            name="Predicates Without Inverse",
            description="Predicates that don't have an inverse predicate defined",
            query="""
                MATCH (p:Predicate)
                WHERE p.inversePredicate = '' OR p.inversePredicate IS NULL
                RETURN p.name AS Predicate,
                       p.category AS Category
                ORDER BY p.category, p.name
            """
        )

    # ========================================================================
    # Coverage & Gap Analysis Queries
    # ========================================================================

    def link_type_by_category(self):
        """Show distribution of link types by category."""
        self.execute_query(
            name="Link Types by Category",
            description="Count and list link types grouped by category",
            query="""
                MATCH (lt:LinkType)
                RETURN lt.category AS Category,
                       count(*) AS Count,
                       collect(lt.name) AS LinkTypes
                ORDER BY Count DESC, Category
            """
        )

    def layers_without_outgoing_links(self):
        """Find layers with no outgoing links."""
        self.execute_query(
            name="Layers Without Outgoing Links",
            description="Layers that don't reference other layers",
            query="""
                MATCH (l:Layer)
                WHERE NOT EXISTS {
                    MATCH (lt:LinkType)-[:LINKS_FROM]->(l)
                }
                RETURN l.id AS LayerID, l.name AS LayerName
                ORDER BY l.id
            """
        )

    def entity_types_not_targeted(self):
        """Find entity types that aren't targeted by any link."""
        self.execute_query(
            name="Untargeted Entity Types",
            description="Entity types that are not targeted by any LinkType",
            query="""
                MATCH (e:EntityType)
                WHERE NOT EXISTS {
                    MATCH (lt:LinkType)-[:TARGETS_ENTITY]->(e)
                }
                RETURN e.layer AS Layer, e.name AS EntityType
                ORDER BY e.layer, e.name
            """
        )

    # ========================================================================
    # ArchiMate Alignment Queries
    # ========================================================================

    def archimate_relationships(self):
        """Show ArchiMate-aligned relationships."""
        self.execute_query(
            name="ArchiMate-Aligned Relationships",
            description="Predicates that align with ArchiMate relationship types",
            query="""
                MATCH (p:Predicate)
                WHERE p.archimateAlignment <> '' AND p.archimateAlignment IS NOT NULL
                RETURN p.name AS Predicate,
                       p.archimateAlignment AS ArchiMateType,
                       p.category AS Category,
                       p.directionality AS Directionality
                ORDER BY p.archimateAlignment, p.name
            """
        )

    def archimate_link_types(self):
        """Show link types in ArchiMate category."""
        self.execute_query(
            name="ArchiMate Category Links",
            description="Link types categorized as ArchiMate references",
            query="""
                MATCH (lt:LinkType)
                WHERE lt.category = 'archimate'
                RETURN lt.id AS LinkID,
                       lt.name AS Name,
                       lt.predicate AS Predicate
                ORDER BY lt.name
            """
        )

    # ========================================================================
    # Validation Queries
    # ========================================================================

    def validate_link_targets(self):
        """Validate that all link target entities exist."""
        self.execute_query(
            name="Validate Link Target Entities",
            description="Check if all LinkType target entities are defined",
            query="""
                MATCH (lt:LinkType)
                WHERE NOT EXISTS {
                    MATCH (lt)-[:TARGETS_ENTITY]->(:EntityType)
                }
                RETURN lt.id AS LinkID,
                       lt.name AS LinkName,
                       lt.category AS Category
                ORDER BY lt.category, lt.name
            """
        )

    def validate_predicate_usage(self):
        """Find predicates not used by any link type."""
        self.execute_query(
            name="Unused Predicates",
            description="Predicates defined but not used by any LinkType",
            query="""
                MATCH (p:Predicate)
                WHERE NOT EXISTS {
                    MATCH (lt:LinkType)-[:USES_PREDICATE]->(p)
                }
                RETURN p.name AS Predicate, p.category AS Category
                ORDER BY p.category, p.name
            """
        )

    # ========================================================================
    # Summary Queries
    # ========================================================================

    def ontology_summary(self):
        """Generate complete ontology summary."""
        print("\n" + "=" * 80)
        print("DOCUMENTATION ROBOTICS ONTOLOGY SUMMARY")
        print("=" * 80 + "\n")

        summaries = [
            ("Total Layers", "MATCH (l:Layer) RETURN count(*) as count"),
            ("Total Entity Types", "MATCH (e:EntityType) RETURN count(*) as count"),
            ("Total Link Types", "MATCH (lt:LinkType) RETURN count(*) as count"),
            ("Total Predicates", "MATCH (p:Predicate) RETURN count(*) as count"),
            ("Bidirectional Links", "MATCH (lt:LinkType) WHERE lt.bidirectional = true RETURN count(*) as count"),
            ("Critical Links", "MATCH (lt:LinkType) WHERE lt.strength = 'critical' RETURN count(*) as count"),
            ("High Strength Links", "MATCH (lt:LinkType) WHERE lt.strength = 'high' RETURN count(*) as count"),
            ("ArchiMate Alignments", "MATCH (p:Predicate) WHERE p.archimateAlignment <> '' RETURN count(*) as count"),
        ]

        for label, query in summaries:
            result = self.conn.execute(query)
            rows = result.get_all()
            count = rows[0][0] if rows else 0
            print(f"{label:.<50} {count:>6}")

        print("\n" + "=" * 80 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Query Documentation Robotics specification graph database"
    )
    parser.add_argument(
        "--db-path",
        default="tools/graph-db/spec-ontology.lbug",
        help="Path to LadybugDB database"
    )
    parser.add_argument(
        "--query",
        help="Specific query to run (use --list-queries to see options)"
    )
    parser.add_argument(
        "--list-queries",
        action="store_true",
        help="List all available queries"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all queries"
    )

    args = parser.parse_args()

    queries = SpecQueries(args.db_path)

    # Define available query methods
    query_methods = {
        # Layer Exploration
        "list-layers": queries.list_layers,
        "layer-entity-counts": queries.layer_entity_counts,
        "layer-link-matrix": queries.layer_link_matrix,

        # Traceability
        "traceability-paths": queries.traceability_paths,
        "motivation-links": queries.motivation_links,
        "requirement-fulfillment": queries.requirement_fulfillment_chain,

        # Security & Governance
        "security-links": queries.security_links,
        "governance-predicates": queries.governance_predicates,
        "critical-links": queries.critical_links,

        # Predicate Analysis
        "predicate-usage": queries.predicate_usage,
        "bidirectional": queries.bidirectional_relationships,
        "predicates-without-inverse": queries.predicates_without_inverse,

        # Coverage & Gaps
        "link-categories": queries.link_type_by_category,
        "layers-no-outgoing": queries.layers_without_outgoing_links,
        "untargeted-entities": queries.entity_types_not_targeted,

        # ArchiMate
        "archimate-relationships": queries.archimate_relationships,
        "archimate-links": queries.archimate_link_types,

        # Validation
        "validate-targets": queries.validate_link_targets,
        "validate-predicates": queries.validate_predicate_usage,

        # Summary
        "summary": queries.ontology_summary,
    }

    if args.list_queries:
        print("\nAvailable Queries:")
        print("=" * 80)
        for name in sorted(query_methods.keys()):
            print(f"  {name}")
        print("=" * 80)
        print("\nUsage: python scripts/tools/ladybug_queries.py --query <query-name>")
        print("       python scripts/tools/ladybug_queries.py --all")
        return

    if args.all:
        for name, method in query_methods.items():
            method()
    elif args.query:
        if args.query in query_methods:
            query_methods[args.query]()
        else:
            print(f"ERROR: Unknown query '{args.query}'")
            print("Use --list-queries to see available options")
            sys.exit(1)
    else:
        # Default: run summary
        queries.ontology_summary()


if __name__ == "__main__":
    main()
