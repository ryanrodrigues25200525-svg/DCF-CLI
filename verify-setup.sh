#!/bin/bash

echo "=========================================="
echo "DCF Builder Setup Verification"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Python
echo "Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✓${NC} Python found: $PYTHON_VERSION"
else
    echo -e "${RED}✗${NC} Python 3 not found. Please install Python 3.11 or higher."
    exit 1
fi

# Check Node.js
echo ""
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓${NC} Node.js found: $NODE_VERSION"
else
    echo -e "${RED}✗${NC} Node.js not found. Please install Node.js 18 or higher."
    exit 1
fi

# Check if backend virtual environment exists
echo ""
echo "Checking Python virtual environment..."
if [ -d "backend/.venv" ]; then
    echo -e "${GREEN}✓${NC} Virtual environment exists"
else
    echo -e "${YELLOW}⚠${NC} Virtual environment not found. Creating..."
    cd backend
    python3 -m venv .venv
    cd ..
    echo -e "${GREEN}✓${NC} Virtual environment created"
fi

# Check if Python dependencies are installed
echo ""
echo "Checking Python dependencies..."
cd backend
source .venv/bin/activate
if pip show edgartools &> /dev/null; then
    echo -e "${GREEN}✓${NC} edgartools installed"
else
    echo -e "${YELLOW}⚠${NC} edgartools not installed. Installing..."
    pip install -r requirements.txt
    echo -e "${GREEN}✓${NC} Dependencies installed"
fi
cd ..

# Check if node_modules exists
echo ""
echo "Checking Node.js dependencies..."
if [ -d "frontend/node_modules" ]; then
    echo -e "${GREEN}✓${NC} Node.js dependencies installed"
else
    echo -e "${YELLOW}⚠${NC} Node.js dependencies not found. Installing..."
    cd frontend && npm install && cd ..
    echo -e "${GREEN}✓${NC} Node.js dependencies installed"
fi

# Test Python service connection
echo ""
echo "Testing Python SEC service..."
if curl -s http://localhost:8000/health > /dev/null; then
    echo -e "${GREEN}✓${NC} Python SEC service is running"
else
    echo -e "${YELLOW}⚠${NC} Python SEC service is not running"
    echo "   To start it, run:"
    echo "   cd backend && source .venv/bin/activate && uvicorn main:app --reload"
fi

# Test DCF Builder
echo ""
echo "Testing DCF Builder..."
if curl -s http://localhost:3000 > /dev/null; then
    echo -e "${GREEN}✓${NC} DCF Builder is running"
else
    echo -e "${YELLOW}⚠${NC} DCF Builder is not running"
    echo "   To start it, run:"
    echo "   export NEXT_PUBLIC_SEC_SERVICE_URL=http://localhost:8000"
    echo "   cd frontend && npm run dev"
fi

echo ""
echo "=========================================="
echo "Setup verification complete!"
echo "=========================================="
echo ""
echo "Quick start commands:"
echo ""
echo "Terminal 1 (Python SEC Service):"
echo "  cd backend && source .venv/bin/activate && uvicorn main:app --reload"
echo ""
echo "Terminal 2 (DCF Builder):"
echo "  export NEXT_PUBLIC_SEC_SERVICE_URL=http://localhost:8000"
echo "  cd frontend && npm run dev"
echo ""
echo "Or use Docker:"
echo "  docker-compose up --build"
