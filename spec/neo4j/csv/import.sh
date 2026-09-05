#!/bin/bash
# Neo4j Import Script
# Load spec metadata CSV files into Neo4j

neo4j-admin database import full \
  --nodes=spec/neo4j/csv/nodes.csv \
  --relationships=spec/neo4j/csv/edges.csv \
  --overwrite-destination \
  neo4j

echo "Import complete. Start Neo4j and visit http://localhost:7474"
