#!/usr/bin/env python3
"""Offline affected acceptance for the daily-report component."""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
commands = [
    (['bun', 'test', 'scripts/daily-report-send.test.ts', 'scripts/daily-report-listing-touches.test.ts',
      'scripts/messaging-provider-health.test.ts', 'scripts/build-daily-report.test.ts'], root / 'smartprop'),
    (['python3', '-B', '-m', 'unittest', 'discover', '-s', 'smartprop/deploy', '-p', 'test_daily_report_*.py'], root),
]
for argv, cwd in commands:
    result = subprocess.run(argv, cwd=cwd)
    if result.returncode:
        sys.exit(result.returncode)
if os.environ.get('ACCEPTANCE_FALSIFY') == '1':
    print('deliberate acceptance falsification', file=sys.stderr)
    sys.exit(1)
