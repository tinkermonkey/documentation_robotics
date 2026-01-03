#!/bin/bash
# SigNoz stack management script
# Usage: ./signoz-stack.sh [start|stop|status|logs|clean]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.signoz.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

command="${1:-status}"

case "$command" in
  start)
    echo -e "${YELLOW}Starting SigNoz stack...${NC}"
    docker compose -f "$COMPOSE_FILE" up -d

    # Wait for services to be ready
    echo -e "${YELLOW}Waiting for services to be ready...${NC}"
    for i in {1..30}; do
      if curl -s http://localhost:13133 > /dev/null 2>&1; then
        echo -e "${GREEN}✓ OTEL Collector is ready${NC}"
        break
      fi
      echo "  Attempt $i/30..."
      sleep 2
    done

    echo -e "${YELLOW}Waiting for SigNoz UI...${NC}"
    for i in {1..30}; do
      if curl -s http://localhost:3301 > /dev/null 2>&1; then
        echo -e "${GREEN}✓ SigNoz UI is ready${NC}"
        break
      fi
      echo "  Attempt $i/30..."
      sleep 2
    done

    echo ""
    echo -e "${GREEN}SigNoz stack is running!${NC}"
    echo ""
    echo "Access points:"
    echo "  - SigNoz UI: http://localhost:3301"
    echo "  - OTEL HTTP Receiver: http://localhost:4318"
    echo "  - OTEL gRPC Receiver: localhost:4317"
    echo "  - OTEL Health Check: http://localhost:13133"
    echo ""
    ;;

  stop)
    echo -e "${YELLOW}Stopping SigNoz stack...${NC}"
    docker compose -f "$COMPOSE_FILE" down
    echo -e "${GREEN}✓ SigNoz stack stopped${NC}"
    ;;

  status)
    echo -e "${YELLOW}SigNoz stack status:${NC}"
    docker compose -f "$COMPOSE_FILE" ps
    ;;

  logs)
    docker compose -f "$COMPOSE_FILE" logs -f "${2:-}"
    ;;

  clean)
    echo -e "${RED}Removing SigNoz stack and volumes...${NC}"
    read -p "Are you sure? This will delete all data. (yes/no) " -r
    echo
    if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
      docker compose -f "$COMPOSE_FILE" down -v
      echo -e "${GREEN}✓ SigNoz stack and volumes removed${NC}"
    else
      echo "Cancelled."
    fi
    ;;

  *)
    echo "SigNoz Stack Manager"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start          - Start SigNoz stack"
    echo "  stop           - Stop SigNoz stack"
    echo "  status         - Show stack status"
    echo "  logs [service] - Show logs (optionally for specific service)"
    echo "  clean          - Remove stack and volumes"
    echo ""
    exit 1
    ;;
esac
