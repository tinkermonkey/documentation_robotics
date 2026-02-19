#!/bin/bash

# launch-neo4j.sh
# One-command script to start Neo4j and import spec metadata

set -e

# Configuration
CONTAINER_NAME="doc-robotics-neo4j"
NEO4J_PASSWORD="password"
NEO4J_USER="neo4j"
HTTP_PORT=7474
BOLT_PORT=7687
CORS_PORT=8000
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CYPHER_SCRIPT="$SCRIPT_DIR/import.cypher"
CORS_PID_FILE="$SCRIPT_DIR/.cors-server.pid"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Documentation Robotics Neo4j Launcher"
echo "========================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if Cypher script exists
if [ ! -f "$CYPHER_SCRIPT" ]; then
    echo "❌ Error: import.cypher not found at $CYPHER_SCRIPT"
    echo "   Run: npm run export:spec-neo4j"
    exit 1
fi

# Start CORS server for browser guides
echo "🌐 Starting CORS server for browser guides..."
if lsof -Pi :$CORS_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "✓ CORS server already running on port $CORS_PORT"
    # Clear stale PID file if it exists
    rm -f "$CORS_PID_FILE"
else
    cd "$SCRIPT_DIR"
    python3 cors-server.py > /dev/null 2>&1 &
    CORS_PID=$!
    echo $CORS_PID > "$CORS_PID_FILE"
    echo "✓ CORS server started on port $CORS_PORT (PID: $CORS_PID)"
    cd - > /dev/null
fi

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "📦 Container '$CONTAINER_NAME' already exists"

    # Check if it's running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "✓ Container is already running"
    else
        echo "▶️  Starting existing container..."
        docker start "$CONTAINER_NAME"
    fi
else
    echo "🐳 Creating new Neo4j container..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        -p $HTTP_PORT:7474 \
        -p $BOLT_PORT:7687 \
        -v "$SCRIPT_DIR/spec-explorer-guide.html:/var/lib/neo4j/import/spec-explorer-guide.html" \
        -v "$SCRIPT_DIR/browser-guide.html:/var/lib/neo4j/import/browser-guide.html" \
        -v "$SCRIPT_DIR/layer-explorer-guide.html:/var/lib/neo4j/import/layer-explorer-guide.html" \
        -e NEO4J_AUTH=${NEO4J_USER}/${NEO4J_PASSWORD} \
        -e NEO4J_PLUGINS='["apoc"]' \
        -e NEO4J_browser_remote__content__hostname__whitelist=localhost,127.0.0.1 \
        neo4j:latest
    echo "✓ Container created"
fi

# Wait for Neo4j to be ready
echo "⏳ Waiting for Neo4j to be ready..."
for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "RETURN 1;" > /dev/null 2>&1; then
        echo "✓ Neo4j is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Timeout waiting for Neo4j to start"
        exit 1
    fi
    sleep 2
done

# Check if data is already imported
echo "🔍 Checking if data is already loaded..."
NODE_COUNT=$(docker exec "$CONTAINER_NAME" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" --format plain "MATCH (n) RETURN count(n) AS count;" 2>/dev/null | tail -n 1 | tr -d ' ')

if [ "$NODE_COUNT" -gt "0" ]; then
    echo "✓ Database already contains $NODE_COUNT nodes"
    echo "  (Skipping import - data already loaded)"
else
    echo "📥 Importing spec metadata..."
    docker exec -i "$CONTAINER_NAME" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" < "$CYPHER_SCRIPT"
    echo "✓ Import complete!"
fi

echo ""
echo -e "${GREEN}✅ Neo4j is ready!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Open:${NC}     http://localhost:$HTTP_PORT"
echo -e "${GREEN}Username:${NC} $NEO4J_USER"
echo -e "${GREEN}Password:${NC} $NEO4J_PASSWORD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}📚 Interactive Guides Available!${NC}"
echo ""
echo "  ${GREEN}Option 1: Standalone Guide (Recommended)${NC}"
echo "  Open in your browser: http://localhost:$CORS_PORT/guide.html"
echo "  • Beautiful interface with copy-to-clipboard buttons"
echo "  • Optimized queries for clean visualizations"
echo "  • Use alongside Neo4j Browser"
echo ""
echo "  ${GREEN}Option 2: Browser Guide (In Neo4j)${NC}"
echo "  In Neo4j Browser, run:"
echo -e "  ${GREEN}:play http://localhost:$CORS_PORT/browser-guide.html${NC}"
echo "  • 14 interactive slides with clickable queries"
echo "  • Navigate with arrow buttons"
echo "  • CORS server running automatically"
echo ""
echo "  ${GREEN}Option 3: Layer Explorer Guide (In Neo4j)${NC}"
echo "  In Neo4j Browser, run:"
echo -e "  ${GREEN}:play http://localhost:$CORS_PORT/layer-explorer-guide.html${NC}"
echo "  • 25 slides covering all 12 layers"
echo "  • Intra-layer relationships (within each layer)"
echo "  • Inter-layer relationships (crossing layer boundaries)"
echo ""
echo "Run verification queries:"
echo "  MATCH (n:SpecNode) RETURN COUNT(n) AS specNodes;"
echo "  MATCH (n:Layer) RETURN COUNT(n) AS layers;"
echo "  MATCH (n:Predicate) RETURN COUNT(n) AS predicates;"
echo ""
echo "Explore cross-layer relationships:"
echo "  MATCH (sr:SpecRelationship)-[:HAS_SOURCE]->(source:SpecNode)-[:BELONGS_TO_LAYER]->(l1:Layer)"
echo "  MATCH (sr)-[:HAS_TARGET]->(target:SpecNode)-[:BELONGS_TO_LAYER]->(l2:Layer)"
echo "  WHERE l1.id <> l2.id"
echo "  RETURN l1.name AS sourceLayer, l2.name AS targetLayer, COUNT(sr) AS relationships"
echo "  ORDER BY relationships DESC;"
echo ""
echo "To stop all services:"
echo "  ./spec/neo4j/stop-neo4j.sh"
echo ""
echo "Or manually:"
echo "  docker stop $CONTAINER_NAME              # Stop Neo4j"
if [ -f "$CORS_PID_FILE" ]; then
    STORED_PID=$(cat "$CORS_PID_FILE")
    echo "  kill $STORED_PID                           # Stop CORS server"
fi
echo ""
echo "To remove container and data:"
echo "  docker rm $CONTAINER_NAME"
echo ""
