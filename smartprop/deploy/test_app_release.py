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

    def test_worker_stop_deadline_accommodates_drain(self):
        with patch.object(host, 'run') as run, patch.object(host, 'start_services'), patch.object(host, 'smoke'):
            host.rollback(Path('/old'), Path('/new'), False)
        worker = next(c for c in run.call_args_list if c.args[0] == ['pm2', 'stop', 'scraper-worker'])
        self.assertGreaterEqual(worker.kwargs.get('timeout', 55), 3720)

    def test_worker_config_preserves_command_and_sets_tree_signaling_explicitly(self):
        existing = {'script': '/root/.bun/bin/bun', 'cwd': str(host.POINTER),
                    'args': ['src/lib/queue/scraper-worker.ts'], 'interpreter': 'none'}
        for tree in [False, True]:
            configs = []
            def read_config(args):
                if args[-2:] == ['--only', 'scraper-worker']:
                    configs.append(json.loads(Path(args[2]).read_text())['apps'][0])
            with patch.object(host, 'processes', return_value={'scraper-worker': existing}), patch.object(host, 'run', side_effect=read_config) as run:
                host.start_services(3660000, tree)
                args = run.call_args_list[-1].args[0]
                self.assertEqual(args[0:2], ['pm2', 'start'])
                # The private temporary config was consumed while the PM2 command ran.
                self.assertEqual(args[-2:], ['--only', 'scraper-worker'])
                self.assertEqual(configs, [dict(existing, name='scraper-worker', kill_timeout=3660000, treekill=tree)])

    def test_rollback_restores_pointer_and_only_owned_services(self):
        with patch.object(host, 'run') as run, patch.object(host, 'switch') as switch, \
                patch.object(host, 'smoke', return_value={'status': 'passed'}), patch.object(host, 'start_services') as start:
            host.rollback(Path('/old'), Path('/new'), switched=True)
        switch.assert_called_once_with(Path('/old'), Path('/new'))
        start.assert_called_once_with(1600, True)
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ['pm2', 'stop', 'scraper-worker'], ['pm2', 'stop', 'smartprop'],
            ['pm2', 'save'],
        ])

    def lifecycle(self, failure=None, monitor_change=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            base = root / 'old'; base.mkdir()
            head = 'b' * 40
            stage = root / ('app-' + head[:12]); stage.mkdir()
            old_monitor = b'#!/bin/sh\n# old monitor\n'
            new_monitor = b'#!/bin/sh\n# new monitor\n' if monitor_change else old_monitor
            for directory in [base, stage]:
                (directory / 'scripts').mkdir()
            (base / 'scripts/smartprop-healthcheck.sh').write_bytes(old_monitor)
            (stage / 'scripts/smartprop-healthcheck.sh').write_bytes(new_monitor)
            monitor = root / 'installed-healthcheck.sh'; monitor.write_bytes(old_monitor)
            pointer = root / 'current'; pointer.symlink_to(base)
            before = {'app': str(base), 'source': 'a' * 40,
                      'processes': {name: {'status': 'online', 'pid': 123, 'kill_timeout': 1600, 'treekill': True} for name in host.SERVICES},
                      'env': {}, 'storage': '/shared', 'healthcheck': host.sha(old_monitor), 'nginx': 'edge', 'public': 'public',
                      'public_index': 'html', 'daily_report': 'report', 'gateway_config': 'config', 'gateway_pid': '456'}
            journal = {'status': 'passed', 'source': head, 'plan_sha256': 'c' * 64, 'before': before,
                       'entries': {}, 'runtime': {}, 'build_id': 'build'}
            (stage / '.app-staging.json').write_text(json.dumps(journal))
            after = dict(before, app=str(stage), source=head)
            after['healthcheck'] = host.sha(new_monitor)
            after['processes'] = {name: dict(value) for name, value in before['processes'].items()}
            after['processes']['scraper-worker']['kill_timeout'] = 3660000
            after['processes']['scraper-worker']['treekill'] = False
            if failure == 'preserved':
                after['gateway_config'] = 'unexpected-change'
            if failure == 'timeout':
                after['processes']['scraper-worker']['kill_timeout'] = 1600
            if failure == 'treekill':
                after['processes']['scraper-worker']['treekill'] = True
            snapshots = [before, before] if failure == 'smoke' else [before, after, before]
            if monitor_change:
                snapshots.insert(1, before)
            smokes = [ValueError('smoke failed'), {'status': 'passed'}] if failure == 'smoke' else [{'status': 'passed'}, {'status': 'passed'}]
            with patch.multiple(host, POINTER=pointer, RELEASES=root), \
                    patch.object(host, 'HEALTHCHECK', monitor, create=True), \
                    patch.object(host, 'pause_healthcheck', return_value=True, create=True), \
                    patch.object(host, 'resume_healthcheck', create=True), \
                    patch.object(host, 'liveness_smoke'), \
                    patch.object(host, 'snapshot', side_effect=snapshots), patch.object(host, 'run') as run, \
                    patch.object(host, 'configured_worker_timeout', return_value=3660000), \
                    patch.object(host, 'start_services') as start, \
                    patch.object(host.subprocess, 'run', return_value=SimpleNamespace(returncode=1)), \
                    patch.object(host, 'smoke', side_effect=smokes):
                result = host.host({'action': 'release', 'head': head, 'base': 'a' * 40, 'plan_sha256': 'c' * 64})
            self.assertEqual(result['status'], 'rolled-back' if failure else 'passed')
            self.assertEqual(pointer.resolve(), base if failure else stage)
            self.assertEqual(monitor.read_bytes(), old_monitor if failure else new_monitor)
            self.assertTrue((stage / '.app-activation.json').is_file())
            self.assertFalse(any('systemctl' in call.args[0] for call in run.call_args_list))
            return [call.args for call in start.call_args_list]

    def test_success_cuts_over_only_app_and_scraper(self):
        self.lifecycle()

    def test_monitor_source_is_installed_and_restored_on_rollback(self):
        self.lifecycle(monitor_change=True)
        self.lifecycle('preserved', monitor_change=True)
        self.lifecycle('smoke', monitor_change=True)

    def test_monitor_waits_for_existing_check_and_restores_only_its_timer(self):
        for timer in ['active', 'inactive']:
            with patch.object(host, 'run', side_effect=[timer, *([] if timer == 'inactive' else ['']), 'activating', 'inactive', *([] if timer == 'inactive' else [''])]) as run, patch.object(host.time, 'sleep'):
                was_active = host.pause_healthcheck()
                host.resume_healthcheck(was_active)
            actions = [call.args[0] for call in run.call_args_list if call.args[0][1] in ['start', 'stop']]
            self.assertEqual(actions, [] if timer == 'inactive' else [
                ['systemctl', 'stop', 'smartprop-healthcheck.timer'],
                ['systemctl', 'start', 'smartprop-healthcheck.timer']])

    def test_monitor_timeout_resumes_previously_active_timer(self):
        with patch.object(host, 'run', side_effect=['active', '', 'activating', '']) as run, \
                patch.object(host.time, 'monotonic', side_effect=[0, 121]), \
                self.assertRaisesRegex(ValueError, 'still running'):
            host.pause_healthcheck()
        self.assertEqual(run.call_args_list[-1].args[0], ['systemctl', 'start', 'smartprop-healthcheck.timer'])

    def test_liveness_requires_exact_typed_response(self):
        for response in [(503, {}, {'status': 'live'}), (200, {}, {'status': 'healthy'}), (200, {}, None)]:
            with patch.object(host, 'request', return_value=response), self.assertRaises(ValueError):
                host.liveness_smoke()
        with patch.object(host, 'request', return_value=(200, {}, {'status': 'live'})):
            host.liveness_smoke()

    def test_cutover_applies_the_worker_drain_timeout(self):
        commands = self.lifecycle()
        self.assertIn((3660000,), commands)

    def test_failed_live_smoke_restores_application(self):
        self.lifecycle('smoke')

    def test_preserved_gateway_drift_forces_rollback(self):
        self.lifecycle('preserved')

    def test_timeout_mismatch_rolls_back_with_original_timeout(self):
        commands = self.lifecycle('timeout')
        self.assertIn((1600, True), commands)

    def test_tree_signal_mismatch_restores_original_settings(self):
        self.assertIn((1600, True), self.lifecycle('treekill'))

    def test_reads_timeout_and_rejects_non_integer_configuration(self):
        for raw in ['3660000', '1600']:
            with patch.object(host, 'run', return_value=raw):
                self.assertEqual(host.configured_worker_timeout(Path('/stage')), int(raw))
        for raw in ['null', 'true', '-1', '"3660000"']:
            with patch.object(host, 'run', return_value=raw), self.assertRaises(ValueError):
                host.configured_worker_timeout(Path('/stage'))


if __name__ == '__main__':
    unittest.main()
