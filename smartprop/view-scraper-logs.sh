#!/bin/bash
# Script to view EdgeProp scraper logs on EC2

EC2_HOST="18.142.253.142"
EC2_USER="ec2-user"
KEY_FILE="/Users/vincent/propertydemo/smartprop-new-key.pem"

echo "🔍 Finding latest EdgeProp scraper log..."
echo ""

# Get the latest log file
LATEST_LOG=$(ssh -i "$KEY_FILE" "$EC2_USER@$EC2_HOST" "ls -t /tmp/ep-scraper-*.log 2>/dev/null | head -1")

if [ -z "$LATEST_LOG" ]; then
  echo "❌ No log files found"
  exit 1
fi

echo "📄 Latest log: $LATEST_LOG"
echo ""
echo "📋 Last 100 lines:"
echo "=========================================="
ssh -i "$KEY_FILE" "$EC2_USER@$EC2_HOST" "tail -100 $LATEST_LOG"
echo ""
echo "=========================================="
echo ""
echo "💡 To follow logs in real-time, run:"
echo "   ssh -i $KEY_FILE $EC2_USER@$EC2_HOST 'tail -f $LATEST_LOG'"

