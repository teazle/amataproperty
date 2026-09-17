import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('chrome_unprivileged', Path(__file__).with_name('chrome-unprivileged.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class BrowserIsolationTests(unittest.TestCase):
    def test_rejects_sandbox_bypass_and_nonfresh_profile(self):
        for flag in ['--no-sandbox', '--no-sandbox=true', '--disable-setuid-sandbox',
                     '--disable-namespace-sandbox', '--disable-seccomp-filter-sandbox',
                     '--single-process', '--no-zygote']:
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                launcher.profile_for_launch([flag])
        for arguments in [[], ['--user-data-dir=/tmp/a', '--user-data-dir=/tmp/b']]:
            with self.assertRaises(ValueError):
                launcher.profile_for_launch(arguments)
        for owner, mode, entries in [(501, 0o40700, []), (0, 0o40755, []),
                                      (0, 0o120700, []), (0, 0o40700, [Path('existing')])]:
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_uid=owner, st_mode=mode)), \
                    patch.object(Path, 'iterdir', return_value=iter(entries)), self.assertRaises(ValueError):
                launcher.profile_for_launch(['--user-data-dir=/tmp/playwright_chromiumdev_profile-test'])

    def test_clears_environment_and_drops_groups_and_ids_before_exec(self):
        calls = []
        profile = Path('/tmp/playwright_chromiumdev_profile-test')
        account = SimpleNamespace(pw_uid=33, pw_gid=33)
        with patch.object(launcher.os, 'geteuid', return_value=0), \
                patch.object(launcher.pwd, 'getpwnam', return_value=account), \
                patch.object(launcher, 'profile_for_launch', return_value=profile), \
                patch.object(launcher.os, 'chown', side_effect=lambda *a: calls.append(('chown', a))), \
                patch.object(launcher.os, 'setgroups', side_effect=lambda *a: calls.append(('groups', a))), \
                patch.object(launcher.os, 'setgid', side_effect=lambda *a: calls.append(('gid', a))), \
                patch.object(launcher.os, 'setuid', side_effect=lambda *a: calls.append(('uid', a))), \
                patch.object(launcher.os, 'execve', side_effect=lambda *a: calls.append(('exec', a))), \
                patch.dict(launcher.os.environ, {'SUPABASE_SERVICE_ROLE': 'must-not-reach-browser'}):
            launcher.main(['--headless', f'--user-data-dir={profile}'])
        self.assertEqual([name for name, _ in calls], ['chown', 'groups', 'gid', 'uid', 'exec'])
        self.assertEqual(calls[1][1], ([],))
        self.assertEqual(calls[2][1], (33,))
        self.assertEqual(calls[3][1], (33,))
        self.assertEqual(calls[4][1][0], '/usr/bin/google-chrome')
        self.assertEqual(calls[4][1][2], {'HOME': str(profile), 'PATH': '/usr/bin:/bin',
                                       'LANG': 'C.UTF-8', 'TMPDIR': '/tmp'})


if __name__ == '__main__':
    unittest.main()
