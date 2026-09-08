#!/usr/bin/env python3
"""Host-side daily-report component lifecycle. Never starts the sending service."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HOST = 'vmi3201429'
MACHINE = 'bfb5b1b8859546f9aac39a4c5bafa616'
APP = Path('/opt/smartprop/app/smartprop')
COMPONENT = Path('/opt/smartprop/components/daily-report')
UNIT = 'openclaw-smartprop-daily-report.service'
DROPIN = Path('/etc/systemd/system') / (UNIT + '.d') / '50-report-component.conf'
LEGACY_SHA = '09f1f2ed32910c4a7715ba56ddd2b67febf657b7d5282e71120321328cf40997'
RUNNER = '''#!/usr/bin/env bash
set -euo pipefail
cd /opt/smartprop/app/smartprop
log_dir=/root/.openclaw/workspace/logs/smartprop-daily-report
mkdir -p "$log_dir"
exec /usr/local/bin/bun /opt/smartprop/components/daily-report/current/report.js --send --output "$log_dir/report-$(date -u +%Y%m%dT%H%M%SZ).txt"
'''
DROPIN_TEXT = '[Service]\nExecStart=\nExecStart=/opt/smartprop/components/daily-report/current/run.sh\n'


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=180, **kwargs).stdout.strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def exec_path(value):
    match = re.match(r'^\{ path=([^ ;]+) ;', value)
    if not match:
        raise ValueError('invalid systemd ExecStart value')
    return match.group(1)


def assert_payload(payload):
    if set(payload) != {'head', 'bundle', 'sha256'}:
        raise ValueError('unexpected artifact fields')
    head = payload['head']
    if not isinstance(head, str) or len(head) != 40 or any(c not in '0123456789abcdef' for c in head):
        raise ValueError('invalid source identity')
    raw = base64.b64decode(payload['bundle'], validate=True)
    if not raw or digest(raw) != payload['sha256']:
        raise ValueError('bundle digest mismatch')
    return raw


def atomic_bytes(path, data, mode=0o644):
    temporary = path.with_name(path.name + '.new-' + str(os.getpid()))
    with temporary.open('xb') as handle:
        handle.write(data)
    temporary.chmod(mode)
    os.replace(temporary, path)


def atomic_link(path, target):
    temporary = path.with_name(path.name + '.new-' + str(os.getpid()))
    temporary.symlink_to(target)
    os.replace(temporary, path)


def assert_target():
    if run(['hostname', '-s']) != HOST or Path('/etc/machine-id').read_text().strip() != MACHINE:
        raise ValueError('target identity mismatch')


def preflight():
    assert_target()
    if str(APP.resolve()) != '/opt/smartprop/releases/baseline-20260907-pW8Hlz':
        raise ValueError('serving app changed; reconcile before component release')
    if digest((APP / 'scripts/smartprop-daily-report.ts').read_bytes()) != LEGACY_SHA:
        raise ValueError('legacy report source changed')
    state = run(['systemctl', 'show', UNIT, '-p', 'ActiveState', '--value'])
    if state not in ('inactive', 'failed'):
        raise ValueError('report is running; no cutover permitted')
    if run(['/usr/local/bin/bun', '--version']) != '1.3.13':
        raise ValueError('target Bun changed')
    if DROPIN.exists() or DROPIN.is_symlink() or (COMPONENT / 'current').exists() or (COMPONENT / 'current').is_symlink():
        raise ValueError('component already exists; use its recorded rollback or reconcile')
    return {'host': HOST, 'machine_id': MACHINE, 'app': str(APP.resolve())}


def no_send_smoke(bundle):
    # Match service env and cwd without starting its sending ExecStart.
    output = run(['systemd-run', '--quiet', '--wait', '--pipe', '--collect',
                  '--property=Type=exec', '--property=WorkingDirectory=' + str(APP),
                  '--property=EnvironmentFile=/root/.openclaw/workspace/smartprop-daily-report.env',
                  '--setenv=HOME=/root', '--setenv=PM2_HOME=/root/.pm2',
                  '--setenv=DRY_RUN=1', '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                  '/usr/local/bin/bun', str(bundle), '--json', '--dry-run'])
    data = json.loads(output)
    report = data['report']
    if not isinstance(data['text'], str) or not data['text'].startswith('SmartProp Daily Run Report - '):
        raise ValueError('missing rendered report')
    if not isinstance(report['scrapers']['totalJobs'], int) or not isinstance(report['scheduledJobs'], list):
        raise ValueError('invalid report data')
    if report['currentHealth']['app'] != 'healthy':
        raise ValueError('app health smoke failed')
    return {'report_date': report['reportDate'], 'text_sha256': digest(data['text'].encode()),
            'text_length': len(data['text']), 'verdict': report['verdict'], 'no_send': True}


def preserved_processes():
    rows = json.loads(run(['pm2', 'jlist']))
    result = {row['name']: {'pid': row['pid'], 'status': row['pm2_env']['status']}
              for row in rows if row['name'] in ('smartprop', 'scraper-worker')}
    if set(result) != {'smartprop', 'scraper-worker'} or any(x['status'] != 'online' for x in result.values()):
        raise ValueError('preserved process not online')
    return result


def rollback(expected_sha):
    assert_target()
    current = COMPONENT / 'current'
    if not current.is_symlink() or current.resolve().parent != COMPONENT / 'releases':
        raise ValueError('rollback artifact mismatch')
    if json.loads((current / 'provenance.json').read_text()).get('sha256') != expected_sha:
        raise ValueError('rollback source mismatch')
    if run(['systemctl', 'show', UNIT, '-p', 'ActiveState', '--value']) not in ('inactive', 'failed'):
        raise ValueError('report running; cannot roll back')
    if not DROPIN.is_file() or DROPIN.is_symlink() or DROPIN.read_text() != DROPIN_TEXT:
        raise ValueError('rollback override mismatch')
    backup = COMPONENT / ('rolled-back-' + expected_sha + '.conf')
    if backup.exists():
        raise ValueError('rollback receipt already exists')
    DROPIN.rename(backup)
    run(['systemctl', 'daemon-reload'])
    effective = run(['systemctl', 'show', UNIT, '-p', 'ExecStart', '--value'])
    if exec_path(effective) != '/opt/smartprop/app/smartprop/scripts/openclaw-smartprop-daily-report.sh':
        raise ValueError('rollback effective command mismatch')
    return {'status': 'rolled-back', 'artifact_sha256': expected_sha, 'override_backup': str(backup)}


def activate(payload):
    raw = assert_payload(payload)
    identity = preflight()
    processes = preserved_processes()
    # Capture the exact original unit and app pointer as the preservation boundary.
    fragment = Path(run(['systemctl', 'show', UNIT, '-p', 'FragmentPath', '--value']))
    original_unit_sha = digest(fragment.read_bytes())
    previous_dropins = run(['systemctl', 'show', UNIT, '-p', 'DropInPaths', '--value'])
    if previous_dropins:
        raise ValueError('unexpected existing unit overrides')
    release = COMPONENT / 'releases' / payload['head']
    release.mkdir(parents=True, exist_ok=False, mode=0o755)
    (release / 'report.js').write_bytes(raw)
    (release / 'run.sh').write_text(RUNNER)
    (release / 'run.sh').chmod(0o755)
    (release / 'provenance.json').write_text(json.dumps({'head': payload['head'], 'sha256': payload['sha256']}))
    (release / 'report.js').chmod(0o444)
    (release / 'provenance.json').chmod(0o444)
    (release / 'run.sh').chmod(0o555)
    release.chmod(0o555)
    smoke = no_send_smoke(release / 'report.js')
    # The retained original fragment is the one-command rollback target.
    switched = False
    try:
        preflight()
        atomic_link(COMPONENT / 'current', release)
        switched = True
        DROPIN.parent.mkdir(exist_ok=True)
        atomic_bytes(DROPIN, DROPIN_TEXT.encode())
        run(['systemctl', 'daemon-reload'])
        actual = run(['systemctl', 'show', UNIT, '-p', 'ExecStart', '--value'])
        if exec_path(actual) != '/opt/smartprop/components/daily-report/current/run.sh':
            raise ValueError('effective report command mismatch')
        if digest(fragment.read_bytes()) != original_unit_sha or str(APP.resolve()) != identity['app']:
            raise ValueError('preserved app or unit changed')
        if preserved_processes() != processes:
            raise ValueError('preserved process identity changed')
        if run(['systemctl', 'show', UNIT, '-p', 'ActiveState', '--value']) not in ('inactive', 'failed'):
            raise ValueError('unexpected concurrent report execution')
    except Exception:
        if switched:
            # Retain the exact override for recovery; original unit and artifact stay untouched.
            if DROPIN.exists() and DROPIN.read_text() == DROPIN_TEXT:
                rollback(payload['sha256'])
        raise
    return {'status': 'passed', 'head': payload['head'], 'artifact_sha256': payload['sha256'],
            'no_send_smoke': smoke, 'preserved_app': identity['app'], 'original_unit_sha256': original_unit_sha,
            'preserved_processes': processes,
            'rollback': 'smartprop/deploy/daily_report_release.py rollback --artifact-sha256 ' + payload['sha256'],
            'service_started': False}


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        if request == {'action': 'preflight'}:
            result = preflight()
        else:
            with open('/run/lock/smartprop-daily-report-release.lock', 'a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = rollback(request['sha256']) if set(request) == {'action', 'sha256'} and request['action'] == 'rollback' else activate(request)
        print(json.dumps(result))
    except Exception as exc:
        # Do not echo subprocess output: it may contain report data or private env details.
        print(json.dumps({'status': 'failed', 'error': type(exc).__name__ + ': ' + str(exc)[:180]}))
        sys.exit(1)
