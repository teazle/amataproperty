#!/usr/bin/env python3
"""Replace only the verified watchdog script, retaining process and session state."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

HOST = 'vmi3201429'
MACHINE = 'bfb5b1b8859546f9aac39a4c5bafa616'
TARGET = Path('/usr/local/bin/openclaw-gateway-watchdog')
LOCK = Path('/run/openclaw-gateway-watchdog.lock')
BACKUPS = Path('/var/lib/smartprop/gateway-watchdog')
ORIGINAL_SHA = 'fc73b1d18397f1a466dd9c0def8a71d5e8eebe52840eb43d6fef37d2fb11fbc7'

def sha(value):
    return hashlib.sha256(value).hexdigest()

def command(args):
    return subprocess.run(args, env=dict(os.environ, XDG_RUNTIME_DIR='/run/user/0'),
                          capture_output=True, text=True, check=True, timeout=30).stdout.strip()

def inspect():
    if os.uname().nodename != HOST or Path('/etc/machine-id').read_text().strip() != MACHINE:
        raise ValueError('wrong target')
    if TARGET.is_symlink() or not TARGET.is_file():
        raise ValueError('watchdog target is not a regular file')
    unit = dict(line.split('=', 1) for line in command([
        'systemctl', '--user', 'show', 'openclaw-gateway.service',
        '--property=MainPID,InvocationID,ActiveState,SubState,NRestarts,MemoryHigh,MemoryMax'
    ]).splitlines() if '=' in line)
    raw = json.loads(command(['pm2', 'jlist']))
    processes = {p['name']: {'pid': p['pid'], 'status': p['pm2_env']['status'],
                             'restarts': p['pm2_env']['restart_time']}
                 for p in raw if p['name'] in ('smartprop', 'scraper-worker')}
    st = TARGET.stat()
    return {'host': HOST, 'machine_id': MACHINE, 'unit': unit, 'processes': processes,
            'source': Path('/opt/smartprop/app/smartprop/.deploy-source-revision').read_text().strip(),
            'config_sha256': sha(Path('/root/.openclaw/openclaw.json').read_bytes()),
            'env_sha256': {name: sha((Path('/opt/smartprop/app/smartprop') / name).read_bytes())
                           for name in ('.env', '.env.local')},
            'watchdog_sha256': sha(TARGET.read_bytes()),
            'mode': st.st_mode & 0o7777, 'uid': st.st_uid, 'gid': st.st_gid,
            'timer': command(['systemctl', 'is-active', 'openclaw-gateway-watchdog.timer'])}

def validate(before, expected):
    if before != expected:
        raise ValueError('baseline changed')
    if before['watchdog_sha256'] != ORIGINAL_SHA or before['uid'] != 0 or before['gid'] != 0:
        raise ValueError('watchdog baseline not qualified')
    if before['mode'] != 0o755:
        raise ValueError('unexpected watchdog mode')
    unit = before['unit']
    if unit.get('ActiveState') != 'active' or unit.get('SubState') != 'running' or int(unit.get('MainPID', '0')) <= 0:
        raise ValueError('gateway not running')
    if set(before['processes']) != {'smartprop', 'scraper-worker'} or any(p['status'] != 'online' for p in before['processes'].values()):
        raise ValueError('application processes not online')
    if before['timer'] != 'active':
        raise ValueError('watchdog timer not active')

def verify(before, after, digest):
    expected = dict(before, watchdog_sha256=digest)
    if after != expected:
        raise ValueError('preserved state or installed script changed')

def replace(raw, before):
    descriptor, name = tempfile.mkstemp(prefix='.smartprop-watchdog-', dir=TARGET.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temporary, before['uid'], before['gid'])
        os.chmod(temporary, before['mode'])
        command(['bash', '-n', str(temporary)])
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)

def apply(expected, payload, digest):
    raw = base64.b64decode(payload, validate=True)
    if sha(raw) != digest:
        raise ValueError('payload hash mismatch')
    with os.fdopen(os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = inspect()
        validate(before, expected)
        original = TARGET.read_bytes()
        BACKUPS.mkdir(parents=True, mode=0o700, exist_ok=True)
        backup = BACKUPS / (uuid.uuid4().hex + '.sh')
        with backup.open('xb') as handle:
            os.chmod(backup, 0o600)
            handle.write(original)
        try:
            replace(raw, before)
            after = inspect()
            verify(before, after, digest)
            command(['curl', '--fail', '--silent', '--max-time', '8', 'http://127.0.0.1:18789/'])
        except Exception as error:
            try:
                replace(original, before)
                verify(before, inspect(), before['watchdog_sha256'])
                rollback = 'passed'
            except Exception:
                rollback = 'failed'
            return {'status': 'failed', 'error': type(error).__name__, 'rollback': rollback,
                    'backup': str(backup)}
        return {'status': 'passed', 'before': before, 'after': after, 'backup': str(backup),
                'restarted': False, 'session_changed': False, 'scope': 'watchdog-script-only'}

if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        if request['action'] == 'inspect':
            result = {'status': 'passed', 'snapshot': inspect()}
        elif request['action'] == 'apply':
            result = apply(request['expected'], request['payload'], request['payload_sha256'])
        else:
            raise ValueError('unsupported operation')
        print(json.dumps(result, sort_keys=True))
        sys.exit(0 if result['status'] == 'passed' else 1)
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': type(error).__name__, 'detail': str(error)[:160]}))
        sys.exit(1)
