import base64
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import edge_security_host as host


class EdgeSecurityTests(unittest.TestCase):
    before = b'upstream smartprop_app { server 127.0.0.1:3000; }\nserver {\n    listen 80;\n    server_name _;\n    location / { root /opt/luxe-realty-design/current; }\n}\n#     server_name _;\n'

    def test_only_adds_expected_security_locations(self):
        with patch.object(host, 'BASE_SHA', host.digest(self.before)):
            after = host.harden(self.before)
        self.assertEqual(after.decode().replace(host.ZONE, '', 1).replace(host.LOCATIONS, '', 1), self.before.decode())
        self.assertIn('location = /api/test-listings { return 404; }', after.decode())
        self.assertIn('location = /api/sign/submit { return 503; }', after.decode())
        self.assertIn('limit_req zone=smartprop_login burst=5 nodelay;', after.decode())

    def test_rejects_changed_baseline(self):
        with self.assertRaisesRegex(ValueError, 'baseline changed'):
            host.harden(b'changed')

    def test_tls_only_adds_encryption_to_qualified_http_routes(self):
        with patch.object(host, 'TLS_BASE_SHA', host.digest(self.before), create=True):
            after = host.harden(self.before)
        self.assertEqual(after.decode().replace(host.TLS_DIRECTIVES, '', 1), self.before.decode())
        self.assertIn('listen 443 ssl;', after.decode())
        self.assertIn('ssl_protocols TLSv1.2 TLSv1.3;', after.decode())

    def test_tls_baseline_rollback_is_its_actual_input(self):
        self.lifecycle(fail_smoke=True, tls=True)

    def test_rejects_bad_artifact_before_target(self):
        with patch.object(host, 'target') as target:
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                host.activate({'head': 'a' * 40, 'config': base64.b64encode(b'bad').decode(), 'sha256': 'b' * 64})
            target.assert_not_called()

    def lifecycle(self, fail_smoke=False, fail_syntax=False, tls=False):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / 'smartprop.conf'; config.write_bytes(self.before)
            calls = []

            def run(argv):
                calls.append(argv)
                if fail_syntax and argv == ['nginx', '-t'] and config.read_bytes() != self.before:
                    raise ValueError('invalid syntax')
                return ''

            baselines = {'TLS_BASE_SHA' if tls else 'BASE_SHA': host.digest(self.before)}
            with patch.multiple(host, CONFIG=config, RELEASES=Path(temp) / 'releases', **baselines), \
                    patch.object(host, 'target', side_effect=lambda: {'nginx_sha256': host.digest(config.read_bytes())}), \
                    patch.object(host, 'preserved', return_value={'processes': 'unchanged'}), \
                    patch.object(host, 'http', return_value=(200, b'public site')), \
                    patch.object(host, 'run', side_effect=run), \
                    patch.object(host, 'smoke', side_effect=ValueError('failed smoke') if fail_smoke else None, return_value={'passed': True}):
                after = host.harden(self.before)
                request = {'head': 'a' * 40, 'config': base64.b64encode(after).decode(), 'sha256': host.digest(after)}
                if fail_smoke or fail_syntax:
                    with self.assertRaises(ValueError):
                        host.activate(request)
                    self.assertEqual(config.read_bytes(), self.before)
                else:
                    result = host.activate(request)
                    self.assertEqual(result['status'], 'passed')
                    self.assertEqual(config.read_bytes(), after)
                self.assertEqual(calls[-2:], [['nginx', '-t'], ['systemctl', 'reload', 'nginx']])
                self.assertFalse(any('pm2' in c or 'restart' in c for c in calls))

    def test_success_preserves_consumers(self):
        self.lifecycle()

    def test_failed_smoke_rolls_back(self):
        self.lifecycle(fail_smoke=True)

    def test_invalid_nginx_never_activates_bad_config(self):
        self.lifecycle(fail_syntax=True)


if __name__ == '__main__':
    unittest.main()
