#!/usr/bin/env python3
"""Offline watchdog decision and guarded replacement checks."""
from pathlib import Path
import os
import subprocess
import sys

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    for directory, pattern in [('smartprop/scripts', 'test_gateway_watchdog.py'),
                               ('smartprop/deploy', 'test_gateway_watchdog_*.py')]:
        subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', directory,
                        '-p', pattern], cwd=root, env=env, check=True)
