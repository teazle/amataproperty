#!/usr/bin/env python3
"""Offline acceptance only; no target access or service operations."""
import os
from pathlib import Path
import subprocess
import sys

result = subprocess.run(['python3', '-B', '-m', 'unittest', 'discover', '-s',
                         str(Path(__file__).resolve().parents[1] / 'deploy'), '-p', 'test_edge_security.py'])
if result.returncode:
    sys.exit(result.returncode)
if os.environ.get('ACCEPTANCE_FALSIFY') == '1':
    print('deliberate acceptance falsification', file=sys.stderr)
    sys.exit(1)
