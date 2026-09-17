#!/usr/bin/python3
"""Launch the scheduled article browser without application/root privileges."""
import os
from pathlib import Path
import pwd
import stat
import sys


def profile_for_launch(arguments):
    forbidden = {
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-namespace-sandbox',
        '--disable-seccomp-filter-sandbox', '--single-process', '--no-zygote',
    }
    if any(argument.split('=', 1)[0] in forbidden for argument in arguments):
        raise ValueError('sandbox-disabling browser arguments are not permitted')
    profiles = [argument.split('=', 1)[1] for argument in arguments
                if argument.startswith('--user-data-dir=')]
    if len(profiles) != 1:
        raise ValueError('one fresh Playwright profile is required')
    profile = Path(profiles[0])
    metadata = profile.lstat()
    # /tmp is sticky; other users cannot replace this root-owned, private folder.
    # Never change an existing browser profile or any application directory.
    if (profile.parent != Path('/tmp') or
            not profile.name.startswith('playwright_chromiumdev_profile-') or
            not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or
            stat.S_IMODE(metadata.st_mode) != 0o700 or any(profile.iterdir())):
        raise ValueError('browser profile must be a fresh private root-owned Playwright directory')
    return profile


def main(arguments):
    if os.geteuid() != 0:
        raise ValueError('this launcher requires the root-owned article controller')
    account = pwd.getpwnam('www-data')
    if account.pw_uid == 0 or account.pw_gid == 0:
        raise ValueError('browser account must be unprivileged')
    profile = profile_for_launch(arguments)
    os.chown(profile, account.pw_uid, account.pw_gid)
    # The browser must not inherit Supabase keys or the controller environment.
    environment = {'HOME': str(profile), 'PATH': '/usr/bin:/bin',
                   'LANG': 'C.UTF-8', 'TMPDIR': '/tmp'}
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    os.execve('/usr/bin/google-chrome', ['google-chrome', *arguments], environment)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(f'article browser isolation failed: {error}', file=sys.stderr)
        sys.exit(1)
