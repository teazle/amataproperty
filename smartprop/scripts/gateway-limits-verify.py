#!/usr/bin/env python3
"""Offline gateway limit contract tests. No remote or provider calls."""
from pathlib import Path
import os
import subprocess
import sys

if __name__ == '__main__':
    subprocess.run([sys.executable, '-m', 'unittest', 'discover',
                    '-s', 'smartprop/deploy', '-p', 'test_gateway_limits_*.py'],
                   cwd=Path(__file__).resolve().parents[2], check=True,
                   env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
