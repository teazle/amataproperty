#!/bin/bash

# Start ngrok for the SmartProp application
# This script will expose your local Next.js app to the internet

PORT="${1:-3000}"
echo "🚀 Starting ngrok tunnel for port $PORT..."
echo ""
echo "📝 Make sure your Next.js app is running on port $PORT"
echo "   Run this in another terminal: cd /Users/vincent/propertydemo/smartprop && bun run dev"
echo ""
echo "🌐 Starting ngrok..."
echo ""

ngrok http $PORT

# To use with authentication:
# ngrok http $PORT --basic-auth="username:password"

# To use with a custom subdomain (requires ngrok account):
# ngrok http $PORT --subdomain=your-custom-name

