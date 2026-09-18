#!/usr/bin/env python3
"""Scoped gateway cgroup limit operation; never restarts or rewrites sessions."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

HOST = 'vmi3201429'
MACHINE = 'bfb5b1b8859546f9aac39a4c5bafa616'
UNIT = 'openclaw-gateway.service'
HIGH = 1024 ** 3
MAX = 2 * HIGH
LOCK_PATH = Path('/run/smartprop-gateway-limits.lock')
BACKUP_ROOT = Path('/var/lib/smartprop/gateway-limits')
IDENTITY = ('host', 'machine_id', 'source', 'config_sha256')
BOUND_UNIT = ('MainPID', 'InvocationID', 'MemoryHigh', 'MemoryMax')
PROPERTIES = ('ActiveState', 'SubState', 'MainPID', 'InvocationID', 'MemoryCurrent',
              'MemoryHigh', 'MemoryMax', 'ControlGroup', 'Restart', 'NRestarts')


def command(args):
    result = subprocess.run(args, env=dict(os.environ, XDG_RUNTIME_DIR='/run/user/0'),
                            capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise RuntimeError('gateway service-manager command failed')
    return result.stdout.strip()


def inspect():
    machine = Path('/etc/machine-id').read_text().strip()
    if machine != MACHINE or os.uname().nodename != HOST:
        raise ValueError('wrong target host')
    output = command(['systemctl', '--user', 'show', UNIT,
                      *['--property=' + key for key in PROPERTIES]])
    unit = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    group = unit.get('ControlGroup', '')
    if not group.startswith('/user.slice/') or '..' in Path(group).parts:
        raise ValueError('unexpected gateway cgroup')
    cg = Path('/sys/fs/cgroup') / group.lstrip('/')
    persisted = {}
    for key in ('MemoryHigh', 'MemoryMax'):
        path = Path('/root/.config/systemd/user.control') / (UNIT + '.d') / ('50-' + key + '.conf')
        if path.is_file():
            values = [line.split('=', 1)[1].strip() for line in path.read_text().splitlines()
                      if line.startswith(key + '=')]
            if len(values) == 1:
                persisted[key] = values[0]
    return {
        'host': HOST, 'machine_id': machine,
        'source': Path('/opt/smartprop/app/smartprop/.deploy-source-revision').read_text().strip(),
        'config_sha256': hashlib.sha256(Path('/root/.openclaw/openclaw.json').read_bytes()).hexdigest(),
        'unit': unit,
        'persisted': persisted,
        'cgroup': {key: (cg / key).read_text().strip() for key in ('memory.high', 'memory.max')},
    }


def validate_before(snapshot, expected):
    if snapshot.get('host') != HOST or snapshot.get('machine_id') != MACHINE:
        raise ValueError('wrong target identity')
    for key in IDENTITY:
        if not expected.get(key) or snapshot.get(key) != expected[key]:
            raise ValueError('target identity changed: ' + key)
    unit = snapshot.get('unit', {})
    bound = expected.get('unit', {})
    for key in BOUND_UNIT:
        if not bound.get(key) or unit.get(key) != bound[key]:
            raise ValueError('gateway baseline changed: ' + key)
    if unit.get('ActiveState') != 'active' or unit.get('SubState') != 'running':
        raise ValueError('gateway is not running')
    if int(unit.get('MainPID', '0')) <= 0 or not unit.get('InvocationID') or not unit.get('ControlGroup'):
        raise ValueError('gateway process identity missing')
    if unit.get('Restart') not in ('always', 'on-failure', 'on-abnormal'):
        raise ValueError('gateway automatic recovery is not configured')
    if not unit.get('NRestarts', '').isdigit():
        raise ValueError('gateway restart counter unavailable')
    current = int(unit.get('MemoryCurrent', '-1'))
    if current < 0 or current >= HIGH:
        raise ValueError('gateway current memory is outside safe application range')
    # This operation only qualifies the observed unlimited baseline. Never replace
    # a separately managed tighter limit or accept arbitrary rollback arguments.
    if unit.get('MemoryHigh') != 'infinity' or unit.get('MemoryMax') != 'infinity':
        raise ValueError('gateway limits already managed; requalification required')
    if snapshot.get('cgroup') != {'memory.high': 'max', 'memory.max': 'max'}:
        raise ValueError('kernel baseline does not match unlimited service settings')
    return {'status': 'passed'}


def verify_after(before, after):
    for key in IDENTITY:
        if not before.get(key) or before[key] != after.get(key):
            raise ValueError('preserved identity changed: ' + key)
    first, unit = before['unit'], after['unit']
    for key in ('MainPID', 'InvocationID', 'ControlGroup', 'NRestarts', 'Restart'):
        if first.get(key) != unit.get(key):
            raise ValueError('gateway process/recovery changed: ' + key)
    if unit.get('ActiveState') != 'active' or unit.get('SubState') != 'running':
        raise ValueError('gateway no longer running')
    if unit.get('MemoryHigh') != str(HIGH) or unit.get('MemoryMax') != str(MAX):
        raise ValueError('service-manager limit readback mismatch')
    if after.get('cgroup') != {'memory.high': str(HIGH), 'memory.max': str(MAX)}:
        raise ValueError('kernel limit readback mismatch')
    if after.get('persisted') != {'MemoryHigh': str(HIGH), 'MemoryMax': str(MAX)}:
        raise ValueError('persistent limit file readback mismatch')
    if int(unit.get('MemoryCurrent', '-1')) not in range(MAX):
        raise ValueError('gateway memory is outside expected range')
    return {'status': 'passed', 'restarted': False, 'session_changed': False}


def set_limits(high, maximum):
    if (high, maximum) not in ((str(HIGH), str(MAX)), ('infinity', 'infinity')):
        raise ValueError('unsupported limit values')
    command(['systemctl', '--user', 'set-property', UNIT,
             'MemoryHigh=' + high, 'MemoryMax=' + maximum])


def verify_rollback(before, restored):
    for key in IDENTITY:
        if restored.get(key) != before.get(key):
            raise ValueError('rollback identity mismatch')
    for key in (*BOUND_UNIT, 'ControlGroup', 'NRestarts', 'Restart', 'ActiveState', 'SubState'):
        if restored['unit'].get(key) != before['unit'].get(key):
            raise ValueError('rollback service baseline mismatch')
    if restored.get('cgroup') != before.get('cgroup'):
        raise ValueError('rollback kernel limit mismatch')


def apply(expected):
    descriptor = os.open(LOCK_PATH,
                         os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = inspect()
        validate_before(before, expected)
        directory = BACKUP_ROOT
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        backup = directory / (uuid.uuid4().hex + '.json')
        with backup.open('x') as handle:
            os.chmod(backup, 0o600)
            json.dump(before, handle, sort_keys=True)
        try:
            set_limits(str(HIGH), str(MAX))
            time.sleep(2)
            after = inspect()
            proof = verify_after(before, after)
        except Exception as error:
            try:
                set_limits(before['unit']['MemoryHigh'], before['unit']['MemoryMax'])
                restored = inspect()
                verify_rollback(before, restored)
                rollback = 'passed'
            except Exception:
                rollback = 'failed'
            return {'status': 'failed', 'rollback': rollback, 'error': type(error).__name__,
                    'backup': str(backup)}
        return {**proof, 'before': before, 'after': after, 'backup': str(backup),
                'persistent': True, 'scope': 'gateway-service-memory-only'}


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        if request.get('action') == 'inspect':
            result = {'status': 'passed', 'snapshot': inspect()}
        elif request.get('action') == 'apply':
            result = apply(request['expected'])
        else:
            raise ValueError('unsupported operation')
        print(json.dumps(result, sort_keys=True))
        sys.exit(0 if result['status'] == 'passed' else 1)
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': type(error).__name__}))
        sys.exit(1)
