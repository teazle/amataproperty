#!/usr/bin/env python3
"""Offline application release contract checks; no server or provider access."""
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
directory = Path(__file__).resolve().parents[1] / 'deploy'
suite = unittest.defaultTestLoader.discover(str(directory), pattern='test_app_release.py')
result = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(0 if result.wasSuccessful() and result.testsRun >= 5 else 1)
