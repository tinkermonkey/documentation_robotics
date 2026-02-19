#!/bin/bash

# stop-neo4j.sh
# Stop Neo4j container and CORS server

set -e

# Configuration
CONTAINER_NAME="doc-robotics-neo4j"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORS_PID_FILE="$SCRIPT_DIR/.cors-server.pid"
CORS_PORT=8000

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🛑 Stopping Documentation Robotics Services"
echo "============================================"
echo ""

# Stop Neo4j container
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "🐳 Stopping Neo4j container..."
    docker stop "$CONTAINER_NAME"
    echo "✓ Neo4j container stopped"
else
    echo "ℹ️  Neo4j container is not running"
fi

# Stop CORS server
if [ -f "$CORS_PID_FILE" ]; then
    CORS_PID=$(cat "$CORS_PID_FILE")
    if kill -0 "$CORS_PID" 2>/dev/null; then
        echo "🌐 Stopping CORS server (PID: $CORS_PID)..."
        kill "$CORS_PID"
        rm -f "$CORS_PID_FILE"
        echo "✓ CORS server stopped"
    else
        echo "ℹ️  CORS server not running (stale PID file)"
        rm -f "$CORS_PID_FILE"
    fi
elif lsof -Pi :$CORS_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    CORS_PID=$(lsof -Pi :$CORS_PORT -sTCP:LISTEN -t)
    echo "🌐 Stopping CORS server (PID: $CORS_PID)..."
    kill "$CORS_PID"
    echo "✓ CORS server stopped"
else
    echo "ℹ️  CORS server is not running"
fi

echo ""
echo -e "${GREEN}✅ All services stopped${NC}"
echo ""
echo "To start again:"
echo "  ./spec/neo4j/launch-neo4j.sh"
echo ""
echo "To remove container and all data:"
echo "  docker rm $CONTAINER_NAME"
echo ""
