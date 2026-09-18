import base64
from contextlib import ExitStack
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import gateway_watchdog_host as host


class GatewayWatchdogHostTests(unittest.TestCase):
    original = b'#!/usr/bin/env bash\necho original\n'
    replacement = b'#!/usr/bin/env bash\necho replacement\n'

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.target = self.root / 'openclaw-gateway-watchdog'
        self.target.write_bytes(self.original)
        self.target.chmod(0o755)
        self.backups = self.root / 'backups'
        self.lock = self.root / 'watchdog.lock'

    def tearDown(self):
        self.temporary.cleanup()

    def snapshot(self, watchdog_bytes=None):
        return {
            'host': host.HOST,
            'machine_id': host.MACHINE,
            'unit': {
                'MainPID': '1234',
                'InvocationID': 'invocation',
                'ActiveState': 'active',
                'SubState': 'running',
                'NRestarts': '5',
                'MemoryHigh': '1G',
                'MemoryMax': '2G',
            },
            'processes': {
                'smartprop': {'pid': 11, 'status': 'online', 'restarts': 3},
                'scraper-worker': {'pid': 22, 'status': 'online', 'restarts': 4},
            },
            'source': 'a' * 40,
            'config_sha256': 'b' * 64,
            'env_sha256': 'c' * 64,
            'watchdog_sha256': host.ORIGINAL_SHA if watchdog_bytes is None else host.sha(watchdog_bytes),
            'mode': 0o755,
            'uid': 0,
            'gid': 0,
            'timer': 'active',
        }

    def request(self, expected=None, payload=None):
        payload = self.replacement if payload is None else payload
        return {
            'expected': self.snapshot() if expected is None else expected,
            'payload': base64.b64encode(payload).decode(),
            'digest': host.sha(payload),
        }

    def patches(self):
        stack = ExitStack()
        stack.enter_context(patch.multiple(host, TARGET=self.target, BACKUPS=self.backups, LOCK=self.lock))
        stack.enter_context(patch.object(host.os, 'chown'))
        stack.enter_context(patch.object(host, 'command', return_value=''))
        return stack

    def assert_not_replaced(self):
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertEqual(self.target.stat().st_mode & 0o7777, 0o755)
        self.assertFalse(self.backups.exists())

    def test_replace_atomically_installs_contents_and_preserves_mode(self):
        before = self.snapshot()
        with self.patches():
            host.replace(self.replacement, before)

        self.assertEqual(self.target.read_bytes(), self.replacement)
        self.assertEqual(self.target.stat().st_mode & 0o7777, 0o755)
        self.assertEqual(list(self.root.glob('.smartprop-watchdog-*')), [])

    def test_apply_rejects_wrong_baseline_hash_or_identity_before_replacing_target(self):
        cases = {
            'baseline': (self.snapshot(), {**self.snapshot(), 'source': 'd' * 40}),
            'hash': ({**self.snapshot(), 'watchdog_sha256': 'e' * 64}, {**self.snapshot(), 'watchdog_sha256': 'e' * 64}),
            'identity': (ValueError('wrong target'), self.snapshot()),
        }
        for name, (inspected, expected) in cases.items():
            with self.subTest(name=name), self.patches(), patch.object(host, 'inspect', return_value=inspected) as inspect:
                request = self.request(expected=expected)
                if name == 'identity':
                    inspect.side_effect = inspected
                with self.assertRaises(ValueError):
                    host.apply(request['expected'], request['payload'], request['digest'])
                self.assert_not_replaced()

    def test_apply_does_not_replace_target_when_lock_is_held(self):
        request = self.request()
        with self.patches(), patch.object(host, 'inspect') as inspect, \
                patch.object(host.fcntl, 'flock', side_effect=BlockingIOError):
            with self.assertRaises(BlockingIOError):
                host.apply(request['expected'], request['payload'], request['digest'])
            inspect.assert_not_called()
            self.assert_not_replaced()

    def test_apply_restores_original_when_post_apply_verification_fails(self):
        before = self.snapshot()
        changed_state = {**before, 'config_sha256': 'f' * 64}
        request = self.request(expected=before)
        with self.patches(), patch.object(host, 'inspect', side_effect=[before, changed_state, before]):
            result = host.apply(request['expected'], request['payload'], request['digest'])

        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['error'], 'ValueError')
        self.assertEqual(result['rollback'], 'passed')
        self.assertEqual(self.target.read_bytes(), self.original)
        self.assertEqual(self.target.stat().st_mode & 0o7777, 0o755)
        backup = Path(result['backup'])
        self.assertEqual(backup.read_bytes(), self.original)
        self.assertEqual(backup.stat().st_mode & 0o7777, 0o600)

    def test_apply_preserves_service_and_session_snapshot_except_script_hash(self):
        before = self.snapshot()
        request = self.request(expected=before)
        after = {**before, 'watchdog_sha256': request['digest']}
        with self.patches(), patch.object(host, 'inspect', side_effect=[before, after]):
            result = host.apply(request['expected'], request['payload'], request['digest'])

        self.assertEqual(result['status'], 'passed')
        self.assertEqual(result['before'], before)
        self.assertEqual(result['after'], after)
        self.assertFalse(result['restarted'])
        self.assertFalse(result['session_changed'])
        self.assertEqual(self.target.read_bytes(), self.replacement)
        self.assertEqual(self.target.stat().st_mode & 0o7777, 0o755)


if __name__ == '__main__':
    unittest.main()
