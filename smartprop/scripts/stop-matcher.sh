#!/bin/bash

# Stop Matcher Job Script
# This script stops the running matcher job by releasing the advisory lock

set -e

# Get the base URL from environment or use default
BASE_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
API_URL="${BASE_URL}/api/jobs/match"

echo "Stopping matcher job..."
echo "API URL: $API_URL"

# Make DELETE request to stop the job
response=$(curl -s -w "\n%{http_code}" -X DELETE \
  -H "Content-Type: application/json" \
  "$API_URL")

# Extract status code and body
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo ""
echo "Response Status: $http_code"
echo "Response Body:"
echo "$body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" -eq 200 ]; then
  echo ""
  echo "✅ Matcher job stopped successfully!"
  exit 0
else
  echo ""
  echo "❌ Failed to stop matcher job"
  exit 1
fi

