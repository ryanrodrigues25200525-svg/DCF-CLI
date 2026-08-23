#!/bin/bash

# DCF Builder - One Command Launcher
# Starts both Python SEC Service and Next.js DCF Builder in one terminal

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         DCF Builder - Auto-Launch Script                   ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Function to check if a port is in use
check_port() {
    lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1
}

# Function to kill process on a port
kill_port() {
    lsof -ti:$1 | xargs kill -9 2>/dev/null
}

echo -e "${BLUE}Step 1: Checking for existing processes...${NC}"

# Check if services are already running
if check_port 8000; then
    echo -e "${YELLOW}⚠ Python SEC service already running on port 8000${NC}"
    echo -e "${YELLOW}  Stopping existing service...${NC}"
    kill_port 8000
    sleep 1
fi

if check_port 3000; then
    echo -e "${YELLOW}⚠ DCF Builder already running on port 3000${NC}"
    echo -e "${YELLOW}  Stopping existing service...${NC}"
    kill_port 3000
    sleep 1
fi

echo -e "${GREEN}✓ Ports cleared${NC}"
echo ""

# Step 2: Start Python SEC Service
echo -e "${BLUE}Step 2: Starting Python SEC Service...${NC}"
cd "$PROJECT_ROOT/backend"

# Check if venv exists
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv .venv
fi

# Activate venv and start service
source .venv/bin/activate

# Check if edgartools is installed
if ! pip show edgartools >/dev/null 2>&1; then
    echo -e "${YELLOW}Installing Python dependencies...${NC}"
    pip install -q -r requirements.txt
fi

# Set EDGAR identity (never hardcode personal email in repo)
export EDGAR_IDENTITY="${EDGAR_IDENTITY:-DCF Builder User security@example.com}"

# Start Python service in background
python main.py > /tmp/sec-service.log 2>&1 &
PYTHON_PID=$!

# Wait for Python service to be ready
echo -e "${YELLOW}  Waiting for Python service to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:8000/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Python SEC Service running on port 8000${NC}"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗ Python service failed to start!${NC}"
        echo -e "${RED}  Check logs: /tmp/sec-service.log${NC}"
        exit 1
    fi
done

echo ""

# Step 3: Start DCF Builder
echo -e "${BLUE}Step 3: Starting DCF Builder...${NC}"
cd "$PROJECT_ROOT/frontend"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
    npm install
fi

# Set environment variable
export NEXT_PUBLIC_SEC_SERVICE_URL=http://localhost:8000

# Start DCF Builder in background
npm run dev > /tmp/dcf-builder.log 2>&1 &
NODE_PID=$!

# Wait for DCF Builder to be ready
echo -e "${YELLOW}  Waiting for DCF Builder to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:3000 >/dev/null 2>&1; then
        echo -e "${GREEN}✓ DCF Builder running on port 3000${NC}"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗ DCF Builder failed to start!${NC}"
        echo -e "${RED}  Check logs: /tmp/dcf-builder.log${NC}"
        kill $PYTHON_PID 2>/dev/null
        exit 1
    fi
done

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo -e "║${GREEN}         ✓ All Services Running Successfully!              ${NC}║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}📊 DCF Builder:${NC}     http://localhost:3000"
echo -e "${GREEN}🔌 SEC Service:${NC}     http://localhost:8000"
echo -e "${GREEN}📚 API Docs:${NC}        http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down services...${NC}"
    kill $PYTHON_PID 2>/dev/null
    kill $NODE_PID 2>/dev/null
    kill_port 8000
    kill_port 3000
    echo -e "${GREEN}✓ Services stopped${NC}"
    exit 0
}

trap cleanup INT

# Keep script running
while true; do
    sleep 1
    # Check if processes are still running
    if ! kill -0 $PYTHON_PID 2>/dev/null; then
        echo -e "${RED}⚠ Python SEC Service crashed!${NC}"
        echo -e "${YELLOW}  Check logs: /tmp/sec-service.log${NC}"
        kill $NODE_PID 2>/dev/null
        exit 1
    fi
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo -e "${RED}⚠ DCF Builder crashed!${NC}"
        echo -e "${YELLOW}  Check logs: /tmp/dcf-builder.log${NC}"
        kill $PYTHON_PID 2>/dev/null
        exit 1
    fi
done
