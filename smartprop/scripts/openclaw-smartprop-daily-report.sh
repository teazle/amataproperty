#!/usr/bin/env bash
set -euo pipefail

cd /opt/smartprop/app/smartprop

LOG_DIR=/root/.openclaw/workspace/logs/smartprop-daily-report
mkdir -p "$LOG_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_FILE="$LOG_DIR/report-$STAMP.txt"

bun scripts/smartprop-daily-report.ts --send --output "$REPORT_FILE"
