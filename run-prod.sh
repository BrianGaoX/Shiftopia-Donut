#!/bin/bash
# Production launch script for Shiftopia

set -e

echo "🚀 Starting Shiftopia Production Services in Docker..."

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker daemon is not running. Please start Docker first."
    exit 1
fi

# Build and start services in background
echo "📦 Building containers and starting services..."
docker-compose up --build -d

echo ""
echo "✅ Shiftopia Stack is running successfully!"
echo "--------------------------------------------------------"
echo "🌐 Frontend URL:          http://localhost:8080"
echo "⚙️  Optimizer Service URL:  http://localhost:5005 (mapped from 8080)"
echo "🤖 ML Service URL:         http://localhost:8000"
echo "--------------------------------------------------------"
echo "To view service logs, run:       docker-compose logs -f"
echo "To shut down the services, run:  docker-compose down"
echo "--------------------------------------------------------"
