#!/bin/bash

# Quick Start Script for WAHA Integration
# This script helps you get WAHA up and running quickly

set -e

echo "🚀 SmartProp WAHA Quick Start"
echo "=============================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    echo "   Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✅ Docker is installed"

# Check if docker-compose.yml exists
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ docker-compose.yml not found"
    echo "   Please run this script from the smartprop directory"
    exit 1
fi

# Check if .env exists, if not create from example
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found"
    if [ -f "env.example" ]; then
        echo "   Creating .env from env.example..."
        cp env.example .env
        echo "✅ Created .env file"
        echo "   Please edit .env and configure your settings"
    else
        echo "❌ env.example not found"
        exit 1
    fi
else
    echo "✅ .env file exists"
fi

# Start WAHA
echo ""
echo "📦 Pulling latest WAHA image..."
docker compose pull waha

echo ""
echo "🚀 Starting WAHA container..."
docker compose up -d

echo ""
echo "⏳ Waiting for WAHA to start..."
sleep 5

# Check if WAHA is running
if docker compose ps | grep -q "smartprop-waha.*Up"; then
    echo "✅ WAHA is running!"
else
    echo "❌ WAHA failed to start"
    echo "   Check logs with: docker compose logs waha"
    exit 1
fi

echo ""
echo "🎉 WAHA Setup Complete!"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Open WAHA Dashboard:"
echo "   http://localhost:3030"
echo ""
echo "2. Create a WhatsApp session:"
echo "   - Click 'Create Session'"
echo "   - Name: default"
echo "   - Scan QR code with WhatsApp on your phone"
echo ""
echo "3. Run the test script:"
echo "   npx tsx scripts/test-waha.ts 6591234567"
echo ""
echo "4. Run database migration:"
echo "   psql \$DATABASE_URL -f migrations/004_add_viewing_timeslots.sql"
echo ""
echo "5. Start sending viewing requests:"
echo "   curl -X POST http://localhost:3000/api/jobs/viewing-request?limit=10"
echo ""
echo "📚 For more information, see WAHA_SETUP.md"
echo ""
echo "🔧 Useful commands:"
echo "   docker compose logs -f waha    # View logs"
echo "   docker compose restart waha    # Restart WAHA"
echo "   docker compose down            # Stop WAHA"
echo ""
