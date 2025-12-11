#!/usr/bin/env python3
"""
LadybugDB Importer for Documentation Robotics Specification

Imports the complete spec ontology (layers, entities, links, predicates) into
a LadybugDB graph database for interactive exploration by spec maintainers.

Usage:
    python scripts/tools/ladybug_importer.py [--db-path PATH] [--force]

Requirements:
    pip install real_ladybug
"""

import json
import argparse
from pathlib import Path
from typing import Dict, List, Any
import sys

try:
    import real_ladybug as lb
except ImportError:
    print("ERROR: LadybugDB not found. Install with: pip install real_ladybug")
    print("Documentation: https://docs.ladybugdb.com/")
    sys.exit(1)


class SpecOntologyImporter:
    """Import Documentation Robotics specification into LadybugDB."""

    def __init__(self, db_path: str, schemas_path: str):
        self.db_path = Path(db_path)
        self.schemas_path = Path(schemas_path)
        self.db = None
        self.conn = None

    def connect(self, force: bool = False):
        """Connect to LadybugDB database, creating if needed."""
        if self.db_path.exists() and force:
            print(f"Removing existing database: {self.db_path}")
            import shutil
            shutil.rmtree(self.db_path)

        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Connecting to database: {self.db_path}")
        self.db = lb.Database(str(self.db_path))
        self.conn = lb.Connection(self.db)
        print("Connected successfully")

    def create_schema(self):
        """Create graph database schema for spec ontology."""
        print("Creating database schema...")

        # Layer node table
        self.conn.execute("""
            CREATE NODE TABLE IF NOT EXISTS Layer(
                id STRING,
                name STRING,
                description STRING,
                schemaPath STRING,
                PRIMARY KEY (id)
            )
        """)

        # EntityType node table (from schema definitions)
        self.conn.execute("""
            CREATE NODE TABLE IF NOT EXISTS EntityType(
                id STRING,
                name STRING,
                layer STRING,
                description STRING,
                isRequired BOOLEAN,
                PRIMARY KEY (id)
            )
        """)

        # LinkType node table
        self.conn.execute("""
            CREATE NODE TABLE IF NOT EXISTS LinkType(
                id STRING,
                name STRING,
                category STRING,
                predicate STRING,
                inversePredicate STRING,
                cardinality STRING,
                strength STRING,
                bidirectional BOOLEAN,
                relationshipCategory STRING,
                isRequired BOOLEAN,
                PRIMARY KEY (id)
            )
        """)

        # Predicate node table
        self.conn.execute("""
            CREATE NODE TABLE IF NOT EXISTS Predicate(
                name STRING,
                category STRING,
                inversePredicate STRING,
                transitivity BOOLEAN,
                symmetry BOOLEAN,
                directionality STRING,
                archimateAlignment STRING,
                PRIMARY KEY (name)
            )
        """)

        # Relationships
        self.conn.execute("""
            CREATE REL TABLE IF NOT EXISTS DEFINES(
                FROM Layer TO EntityType
            )
        """)

        self.conn.execute("""
            CREATE REL TABLE IF NOT EXISTS LINKS_FROM(
                FROM LinkType TO Layer
            )
        """)

        self.conn.execute("""
            CREATE REL TABLE IF NOT EXISTS LINKS_TO(
                FROM LinkType TO Layer
            )
        """)

        self.conn.execute("""
            CREATE REL TABLE IF NOT EXISTS TARGETS_ENTITY(
                FROM LinkType TO EntityType
            )
        """)

        self.conn.execute("""
            CREATE REL TABLE IF NOT EXISTS USES_PREDICATE(
                FROM LinkType TO Predicate
            )
        """)

        self.conn.execute("""
            CREATE REL TABLE IF NOT EXISTS INVERSE_OF(
                FROM Predicate TO Predicate
            )
        """)

        print("Schema created successfully")

    def import_layers(self):
        """Import layer definitions."""
        print("Importing layers...")

        layers = [
            {"id": "01", "name": "Motivation Layer", "description": "Strategic goals and requirements"},
            {"id": "02", "name": "Business Layer", "description": "Business architecture"},
            {"id": "03", "name": "Security Layer", "description": "Security models and controls"},
            {"id": "04", "name": "Application Layer", "description": "Application architecture"},
            {"id": "05", "name": "Technology Layer", "description": "Technology infrastructure"},
            {"id": "06", "name": "API Layer", "description": "API specifications"},
            {"id": "07", "name": "Data Model Layer", "description": "Data schemas"},
            {"id": "08", "name": "Datastore Layer", "description": "Database schemas"},
            {"id": "09", "name": "UX Layer", "description": "User experience"},
            {"id": "10", "name": "Navigation Layer", "description": "Navigation flows"},
            {"id": "11", "name": "APM/Observability Layer", "description": "Monitoring and observability"},
            {"id": "12", "name": "Testing Layer", "description": "Test specifications"},
        ]

        for layer in layers:
            schema_file = f"{layer['id']}-{layer['name'].lower().replace(' ', '-').replace('/', '-')}.schema.json"
            layer['schemaPath'] = f"spec/schemas/{schema_file}"

            # Escape single quotes in strings for Cypher
            name = layer["name"].replace("'", "\\'")
            desc = layer["description"].replace("'", "\\'")
            path = layer["schemaPath"].replace("'", "\\'")

            self.conn.execute(f"""
                CREATE (l:Layer {{
                    id: '{layer["id"]}',
                    name: '{name}',
                    description: '{desc}',
                    schemaPath: '{path}'
                }})
            """)

        print(f"Imported {len(layers)} layers")

    def import_link_types(self):
        """Import link types from link-registry.json."""
        print("Importing link types...")

        registry_path = self.schemas_path / "link-registry.json"
        if not registry_path.exists():
            print(f"WARNING: Link registry not found at {registry_path}")
            return

        with open(registry_path) as f:
            registry = json.load(f)

        link_types = registry.get("linkTypes", [])

        for lt in link_types:
            # Escape strings and handle None values
            def escape_str(s):
                if s is None:
                    return ""
                return str(s).replace("'", "\\'").replace("\\", "\\\\")

            # Create LinkType node
            query = f"""
                CREATE (lt:LinkType {{
                    id: '{escape_str(lt["id"])}',
                    name: '{escape_str(lt["name"])}',
                    category: '{escape_str(lt["category"])}',
                    predicate: '{escape_str(lt.get("predicate", ""))}',
                    inversePredicate: '{escape_str(lt.get("inversePredicate", ""))}',
                    cardinality: '{escape_str(lt.get("cardinality", "single"))}',
                    strength: '{escape_str(lt.get("strength", "medium"))}',
                    bidirectional: {str(lt.get("bidirectional", False)).lower()},
                    relationshipCategory: '{escape_str(lt.get("relationshipCategory", ""))}',
                    isRequired: {str(lt.get("isRequired", False)).lower()}
                }})
            """
            self.conn.execute(query)

            # Create relationships to source layers
            for source_layer in lt.get("sourceLayers", []):
                layer_id = source_layer.split("-")[0]
                self.conn.execute(f"""
                    MATCH (lt:LinkType {{id: '{escape_str(lt["id"])}'}}),
                          (l:Layer {{id: '{layer_id}'}})
                    CREATE (lt)-[:LINKS_FROM]->(l)
                """)

            # Create relationship to target layer
            if "targetLayer" in lt:
                target_layer_id = lt["targetLayer"].split("-")[0]
                self.conn.execute(f"""
                    MATCH (lt:LinkType {{id: '{escape_str(lt["id"])}'}}),
                          (l:Layer {{id: '{target_layer_id}'}})
                    CREATE (lt)-[:LINKS_TO]->(l)
                """)

        print(f"Imported {len(link_types)} link types")

    def import_predicates(self):
        """Import predicates from relationship-catalog.json."""
        print("Importing predicates...")

        catalog_path = self.schemas_path / "relationship-catalog.json"
        if not catalog_path.exists():
            print(f"WARNING: Relationship catalog not found at {catalog_path}")
            return

        with open(catalog_path) as f:
            catalog = json.load(f)

        relationship_types = catalog.get("relationshipTypes", [])

        def escape_str(s):
            if s is None:
                return ""
            return str(s).replace("'", "\\'").replace("\\", "\\\\")

        for rt in relationship_types:
            # Create Predicate node
            query = f"""
                CREATE (p:Predicate {{
                    name: '{escape_str(rt["predicate"])}',
                    category: '{escape_str(rt["category"])}',
                    inversePredicate: '{escape_str(rt.get("inversePredicate", ""))}',
                    transitivity: {str(rt["semantics"].get("transitivity", False)).lower()},
                    symmetry: {str(rt["semantics"].get("symmetry", False)).lower()},
                    directionality: '{escape_str(rt["semantics"].get("directionality", ""))}',
                    archimateAlignment: '{escape_str(rt.get("archimateAlignment", ""))}'
                }})
            """
            self.conn.execute(query)

        # Create inverse relationships in a second pass
        for rt in relationship_types:
            if rt.get("inversePredicate"):
                self.conn.execute(f"""
                    MATCH (p1:Predicate {{name: '{escape_str(rt["predicate"])}'}}),
                          (p2:Predicate {{name: '{escape_str(rt["inversePredicate"])}'}})
                    CREATE (p1)-[:INVERSE_OF]->(p2)
                """)

        print(f"Imported {len(relationship_types)} predicates")

    def link_types_to_predicates(self):
        """Create relationships between LinkTypes and Predicates."""
        print("Linking LinkTypes to Predicates...")

        result = self.conn.execute("""
            MATCH (lt:LinkType), (p:Predicate)
            WHERE lt.predicate = p.name
            CREATE (lt)-[:USES_PREDICATE]->(p)
            RETURN count(*) as count
        """)

        # Get count from result
        rows = result.get_all()
        count = rows[0][0] if rows else 0
        print(f"Created {count} LinkType->Predicate relationships")

    def import_entity_types(self):
        """Import entity type definitions from layer schemas."""
        print("Importing entity types from schemas...")

        def escape_str(s):
            if s is None:
                return ""
            return str(s).replace("'", "\\'").replace("\\", "\\\\")

        count = 0
        for schema_file in sorted(self.schemas_path.glob("*-layer.schema.json")):
            layer_id = schema_file.name[:2]

            with open(schema_file) as f:
                schema = json.load(f)

            definitions = schema.get("definitions", {})

            for entity_name, entity_def in definitions.items():
                entity_id = f"{layer_id}:{entity_name}"

                query = f"""
                    CREATE (e:EntityType {{
                        id: '{escape_str(entity_id)}',
                        name: '{escape_str(entity_name)}',
                        layer: '{layer_id}',
                        description: '{escape_str(entity_def.get("description", ""))}',
                        isRequired: {str(len(entity_def.get("required", [])) > 0).lower()}
                    }})
                """
                self.conn.execute(query)

                # Link to layer
                self.conn.execute(f"""
                    MATCH (l:Layer {{id: '{layer_id}'}}),
                          (e:EntityType {{id: '{escape_str(entity_id)}'}})
                    CREATE (l)-[:DEFINES]->(e)
                """)

                count += 1

        print(f"Imported {count} entity types")

    def link_types_to_entities(self):
        """Create relationships between LinkTypes and target EntityTypes."""
        print("Linking LinkTypes to target EntityTypes...")

        registry_path = self.schemas_path / "link-registry.json"
        with open(registry_path) as f:
            registry = json.load(f)

        def escape_str(s):
            if s is None:
                return ""
            return str(s).replace("'", "\\'").replace("\\", "\\\\")

        count = 0
        for lt in registry.get("linkTypes", []):
            target_layer = lt.get("targetLayer", "").split("-")[0]

            for target_entity_type in lt.get("targetElementTypes", []):
                entity_id = f"{target_layer}:{target_entity_type}"

                try:
                    result = self.conn.execute(f"""
                        MATCH (lt:LinkType {{id: '{escape_str(lt["id"])}'}}),
                              (e:EntityType {{id: '{escape_str(entity_id)}'}})
                        CREATE (lt)-[:TARGETS_ENTITY]->(e)
                        RETURN count(*) as count
                    """)
                    rows = result.get_all()
                    if rows and rows[0][0] > 0:
                        count += rows[0][0]
                except Exception as e:
                    # Entity might not exist - that's OK
                    pass

        print(f"Created {count} LinkType->EntityType relationships")

    def generate_summary(self):
        """Generate import summary statistics."""
        print("\n" + "="*60)
        print("Import Summary")
        print("="*60)

        queries = [
            ("Layers", "MATCH (l:Layer) RETURN count(*) as count"),
            ("Entity Types", "MATCH (e:EntityType) RETURN count(*) as count"),
            ("Link Types", "MATCH (lt:LinkType) RETURN count(*) as count"),
            ("Predicates", "MATCH (p:Predicate) RETURN count(*) as count"),
            ("DEFINES relationships", "MATCH ()-[r:DEFINES]->() RETURN count(*) as count"),
            ("LINKS_FROM relationships", "MATCH ()-[r:LINKS_FROM]->() RETURN count(*) as count"),
            ("LINKS_TO relationships", "MATCH ()-[r:LINKS_TO]->() RETURN count(*) as count"),
            ("USES_PREDICATE relationships", "MATCH ()-[r:USES_PREDICATE]->() RETURN count(*) as count"),
            ("TARGETS_ENTITY relationships", "MATCH ()-[r:TARGETS_ENTITY]->() RETURN count(*) as count"),
        ]

        for label, query in queries:
            try:
                result = self.conn.execute(query)
                rows = result.get_all()
                count = rows[0][0] if rows else 0
                print(f"{label:.<40} {count:>6}")
            except Exception as e:
                print(f"{label:.<40} ERROR: {e}")

        print("="*60)

    def import_all(self):
        """Execute complete import pipeline."""
        print("Starting import of Documentation Robotics specification...")
        print(f"Database: {self.db_path}")
        print(f"Schemas: {self.schemas_path}")
        print()

        self.create_schema()
        self.import_layers()
        self.import_link_types()
        self.import_predicates()
        self.link_types_to_predicates()
        self.import_entity_types()
        self.link_types_to_entities()
        self.generate_summary()

        print(f"\nImport complete! Database saved to: {self.db_path}")
        print("\nNext steps:")
        print(f"  1. Query the database: lbug {self.db_path}")
        print(f"  2. Run example queries: python scripts/tools/ladybug_queries.py")
        print(f"  3. Launch web explorer: lbug-explorer {self.db_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Import Documentation Robotics specification into LadybugDB"
    )
    parser.add_argument(
        "--db-path",
        default="tools/graph-db/spec-ontology.lbug",
        help="Path to LadybugDB database (default: tools/graph-db/spec-ontology.lbug)"
    )
    parser.add_argument(
        "--schemas-path",
        default="spec/schemas",
        help="Path to schema files (default: spec/schemas)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force rebuild (delete existing database)"
    )

    args = parser.parse_args()

    importer = SpecOntologyImporter(args.db_path, args.schemas_path)
    importer.connect(force=args.force)
    importer.import_all()


if __name__ == "__main__":
    main()
