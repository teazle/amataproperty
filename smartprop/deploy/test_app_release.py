import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import zipfile

import app_release_host as host


class AppReleaseTests(unittest.TestCase):
    def archive(self, entries):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        return output.getvalue()

    def test_rejects_private_or_escaping_archive_entries(self):
        for name in ['../escape', '/absolute', 'src/.env.local', 'src/key.pem', 'storage/session.json']:
            raw = self.archive({name: 'unsafe'})
            with self.subTest(name=name), self.assertRaises(ValueError):
                host.inspect_archive(raw, host.sha(raw), 'source')

    def test_requires_exact_artifact_bytes(self):
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            host.inspect_archive(b'changed', '0' * 64, 'source')

    def test_runtime_archive_cannot_write_source(self):
        raw = self.archive({'src/app/page.tsx': 'unexpected'})
        with self.assertRaises(ValueError):
            host.inspect_archive(raw, host.sha(raw), 'runtime')

    def test_pointer_switch_is_atomic_and_baseline_guarded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            old = root / 'old'; old.mkdir()
            new = root / 'new'; new.mkdir()
            pointer = root / 'current'; pointer.symlink_to(old)
            with patch.object(host, 'POINTER', pointer):
                host.switch(new, old)
                self.assertEqual(pointer.resolve(), new)
                with self.assertRaisesRegex(ValueError, 'baseline'):
                    host.switch(old, old)
                self.assertEqual(pointer.resolve(), new)

    def test_rollback_restores_pointer_and_only_owned_services(self):
        with patch.object(host, 'run') as run, patch.object(host, 'switch') as switch, \
                patch.object(host, 'smoke', return_value={'status': 'passed'}):
            host.rollback(Path('/old'), Path('/new'), switched=True)
        switch.assert_called_once_with(Path('/old'), Path('/new'))
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ['pm2', 'stop', 'scraper-worker'], ['pm2', 'stop', 'smartprop'],
            ['pm2', 'start', 'smartprop'], ['pm2', 'start', 'scraper-worker'], ['pm2', 'save'],
        ])

    def lifecycle(self, failure=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            base = root / 'old'; base.mkdir()
            head = 'b' * 40
            stage = root / ('app-' + head[:12]); stage.mkdir()
            pointer = root / 'current'; pointer.symlink_to(base)
            before = {'app': str(base), 'source': 'a' * 40,
                      'processes': {name: {'status': 'online', 'pid': 123} for name in host.SERVICES},
                      'env': {}, 'storage': '/shared', 'nginx': 'edge', 'public': 'public',
                      'public_index': 'html', 'daily_report': 'report', 'gateway_config': 'config', 'gateway_pid': '456'}
            journal = {'status': 'passed', 'source': head, 'plan_sha256': 'c' * 64, 'before': before,
                       'entries': {}, 'runtime': {}, 'build_id': 'build'}
            (stage / '.app-staging.json').write_text(json.dumps(journal))
            after = dict(before, app=str(stage), source=head)
            if failure == 'preserved':
                after['gateway_config'] = 'unexpected-change'
            snapshots = [before, after, before]
            smokes = [ValueError('smoke failed'), {'status': 'passed'}] if failure == 'smoke' else [{'status': 'passed'}, {'status': 'passed'}]
            with patch.multiple(host, POINTER=pointer, RELEASES=root), \
                    patch.object(host, 'snapshot', side_effect=snapshots), patch.object(host, 'run') as run, \
                    patch.object(host.subprocess, 'run', return_value=SimpleNamespace(returncode=1)), \
                    patch.object(host, 'smoke', side_effect=smokes):
                result = host.host({'action': 'release', 'head': head, 'base': 'a' * 40, 'plan_sha256': 'c' * 64})
            self.assertEqual(result['status'], 'rolled-back' if failure else 'passed')
            self.assertEqual(pointer.resolve(), base if failure else stage)
            self.assertTrue((stage / '.app-activation.json').is_file())
            self.assertFalse(any('systemctl' in call.args[0] for call in run.call_args_list))

    def test_success_cuts_over_only_app_and_scraper(self):
        self.lifecycle()

    def test_failed_live_smoke_restores_application(self):
        self.lifecycle('smoke')

    def test_preserved_gateway_drift_forces_rollback(self):
        self.lifecycle('preserved')


if __name__ == '__main__':
    unittest.main()
