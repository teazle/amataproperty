import base64
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import ExitStack
from unittest.mock import patch
import daily_report_host as host


class ReportHostTests(unittest.TestCase):
    def test_activate_and_rollback_restore_original_function_without_start(self):
        with tempfile.TemporaryDirectory() as root, ExitStack() as stack:
            base = Path(root).resolve()
            app = base / 'app'; app.mkdir()
            fragment = base / 'original.service'; fragment.write_text('original')
            dropin = base / 'unit.d' / '50-report-component.conf'
            component = base / 'component'
            payload = {'head': 'a' * 40, 'bundle': base64.b64encode(b'hello').decode(), 'sha256': host.digest(b'hello')}
            for name, value in [('APP', app), ('COMPONENT', component), ('DROPIN', dropin)]:
                stack.enter_context(patch.object(host, name, value))
            stack.enter_context(patch.object(host, 'preflight', return_value={'app': str(app)}))
            stack.enter_context(patch.object(host, 'assert_target'))
            stack.enter_context(patch.object(host, 'preserved_processes', return_value={'smartprop': {'pid': 7}}))
            stack.enter_context(patch.object(host, 'no_send_smoke', return_value={'no_send': True}))
            calls = []
            def command(argv):
                calls.append(argv)
                if 'FragmentPath' in argv: return str(fragment)
                if 'DropInPaths' in argv: return ''
                if 'ActiveState' in argv: return 'failed'
                if 'ExecStart' in argv:
                    path = '/opt/smartprop/components/daily-report/current/run.sh' if dropin.exists() else '/opt/smartprop/app/smartprop/scripts/openclaw-smartprop-daily-report.sh'
                    return '{ path=' + path + ' ; argv[]=' + path + ' ; }'
                self.assertEqual(argv, ['systemctl', 'daemon-reload'])
                return ''
            stack.enter_context(patch.object(host, 'run', side_effect=command))
            result = host.activate(payload)
            self.assertEqual(result['status'], 'passed')
            self.assertFalse(result['service_started'])
            self.assertEqual((component / 'current' / 'report.js').read_bytes(), b'hello')
            self.assertEqual(dropin.read_text(), host.DROPIN_TEXT)
            rolled_back = host.rollback(payload['sha256'])
            self.assertEqual(rolled_back['status'], 'rolled-back')
            self.assertFalse(dropin.exists())
            self.assertTrue(Path(rolled_back['override_backup']).is_file())
            self.assertEqual(fragment.read_text(), 'original')
            self.assertTrue(all('start' not in argv and 'restart' not in argv and 'stop' not in argv for argv in calls))

    def test_digest_and_source_fail_closed(self):
        payload = {'head': 'a' * 40, 'bundle': base64.b64encode(b'hello').decode(), 'sha256': host.digest(b'hello')}
        self.assertEqual(host.assert_payload(payload), b'hello')
        with self.assertRaises(ValueError):
            host.assert_payload({**payload, 'sha256': 'b' * 64})
        with self.assertRaises(ValueError):
            host.assert_payload({**payload, 'head': '../etc'})

    def test_real_report_schema_and_no_send_command(self):
        value = {'text': 'SmartProp Daily Run Report - 2026-09-07 SGT\nCounts',
                 'report': {'reportDate': '2026-09-07', 'verdict': 'ATTENTION',
                            'scrapers': {'totalJobs': 3}, 'scheduledJobs': [], 'currentHealth': {'app': 'healthy'}}}
        with patch.object(host, 'run', return_value=json.dumps(value)) as run:
            result = host.no_send_smoke(Path('/fixture/report.js'))
            args = run.call_args.args[0]
            self.assertIn('--dry-run', args)
            self.assertNotIn('--send', args)
            self.assertIn('--setenv=DRY_RUN=1', args)
            self.assertTrue(result['no_send'])

    def test_pointer_atomic_replacement_keeps_previous_artifact(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            old, new = base / 'old', base / 'new'
            old.mkdir(); new.mkdir()
            pointer = base / 'current'
            pointer.symlink_to(old)
            host.atomic_link(pointer, new)
            self.assertEqual(pointer.resolve(), new.resolve())
            self.assertTrue(old.is_dir())

    def test_smoke_failure_leaves_unit_and_current_unchanged(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            fragment = base / 'original.service'
            fragment.write_text('original')
            payload = {'head': 'a' * 40, 'bundle': base64.b64encode(b'hello').decode(), 'sha256': host.digest(b'hello')}
            with patch.object(host, 'COMPONENT', base / 'component'), patch.object(host, 'DROPIN', base / 'override'), \
                 patch.object(host, 'preflight', return_value={'app': 'old'}), \
                 patch.object(host, 'preserved_processes', return_value={}), \
                 patch.object(host, 'run', side_effect=[str(fragment), '']), \
                 patch.object(host, 'no_send_smoke', side_effect=ValueError('bad report')):
                with self.assertRaises(ValueError):
                    host.activate(payload)
            self.assertFalse((base / 'component/current').exists())
            self.assertFalse((base / 'override').exists())
            self.assertEqual(fragment.read_text(), 'original')


if __name__ == '__main__':
    unittest.main()
