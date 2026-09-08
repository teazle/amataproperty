"""Controller-only immutable application staging and scoped PM2 cutover."""
import base64
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile

POINTER = Path('/opt/smartprop/app/smartprop')
RELEASES = Path('/opt/smartprop/releases')
SERVICES = ['smartprop', 'scraper-worker']
SOURCE_ROOTS = {'src', 'public', 'scripts', 'deploy', 'openclaw', 'bun.lock', 'package.json',
                'ecosystem.config.js', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json',
                'next-env.d.ts', 'components.json', 'eslint.config.mjs'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, text=True,
                          timeout=55, **kwargs).stdout.strip()


def inspect_archive(raw, expected, kind):
    if sha(raw) != expected:
        raise ValueError('artifact hash mismatch')
    archive = zipfile.ZipFile(io.BytesIO(raw))
    seen = set()
    for entry in archive.infolist():
        name = entry.filename
        parts = name.rstrip('/').split('/')
        if (not name or name.startswith('/') or '\\' in name or '\0' in name or
                any(part in ('', '.', '..') for part in parts) or name in seen or
                stat.S_ISLNK(entry.external_attr >> 16)):
            raise ValueError('unsafe archive path')
        seen.add(name)
        if (any(part.startswith('.env') or part.lower() in
                {'storage', 'sessions', 'credentials', 'secrets', '.ssh', '.openclaw', 'node_modules'}
                for part in parts) or re.search(r'\.(pem|key|p12|pfx)$', name, re.I)):
            raise ValueError('private archive entry')
        if kind == 'source' and parts[0] not in SOURCE_ROOTS:
            raise ValueError('unsupported source root')
        if kind == 'runtime' and parts[0] != '.next':
            raise ValueError('unsupported runtime root')
    if kind == 'source' and not {'package.json', 'bun.lock', 'src/lib/queue/scraper-worker.ts'} <= seen:
        raise ValueError('incomplete application archive')
    return archive


def processes():
    rows = json.loads(run(['pm2', 'jlist']))
    result = {row['name']: {'pid': row['pid'], 'status': row['pm2_env']['status'],
                          'cwd': row['pm2_env']['pm_cwd']} for row in rows if row['name'] in SERVICES}
    if set(result) != set(SERVICES) or any(x['cwd'] != str(POINTER) for x in result.values()):
        raise ValueError('PM2 topology differs')
    return result


def snapshot():
    if (run(['hostname', '-s']) != 'vmi3201429' or
            Path('/etc/machine-id').read_text().strip() != 'bfb5b1b8859546f9aac39a4c5bafa616'):
        raise ValueError('target identity differs')
    root = POINTER.resolve(strict=True)
    return {'app': str(root), 'source': (root / '.deploy-source-revision').read_text().strip(),
            'processes': processes(), 'env': {name: sha((root / name).read_bytes()) for name in ['.env', '.env.local']},
            'storage': str((root / 'storage').resolve(strict=True)),
            'nginx': sha(Path('/etc/nginx/conf.d/smartprop.conf').read_bytes()),
            'public': str(Path('/opt/luxe-realty-design/current').resolve(strict=True)),
            'public_index': sha(Path('/opt/luxe-realty-design/current/index.html').read_bytes()),
            'daily_report': str(Path('/opt/smartprop/components/daily-report/current').resolve(strict=True)),
            'gateway_config': sha(Path('/root/.openclaw/openclaw.json').read_bytes()),
            'gateway_pid': run(['systemctl', '--user', 'show', 'openclaw-gateway.service', '-p', 'MainPID', '--value'])}


def request(port, path, password=None, cookie=None):
    headers = {'Content-Type': 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    req = urllib.request.Request(f'http://127.0.0.1:{port}' + path,
                                 data=json.dumps({'password': password}).encode() if password is not None else None,
                                 headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    return response.status, response.headers, json.loads(raw) if 'application/json' in response.headers.get('Content-Type', '') else None


def smoke(root, port=3000):
    for _ in range(50):
        try:
            if request(port, '/login')[0] == 200:
                break
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(.4)
    else:
        raise ValueError('application readiness failed')
    if request(port, '/api/admin/listings?limit=1')[0] != 401:
        raise ValueError('anonymous access boundary failed')
    password = next(x.split('=', 1)[1] for x in (root / '.env.local').read_text().splitlines() if x.startswith('ADMIN_PASSWORD='))
    status, headers, body = request(port, '/api/admin/auth/login', password=password)
    cookie = headers.get('Set-Cookie', '')
    if status != 200 or body.get('ok') is not True or not all(x in cookie.lower() for x in ['secure', 'httponly', 'samesite=lax']):
        raise ValueError('configured admin login failed')
    checks = []
    for path in ['/api/admin/listings?limit=2', '/api/admin/agents?limit=2', '/api/admin/crm/leads?pageSize=2']:
        status, _, body = request(port, path, cookie=cookie.split(';', 1)[0])
        total = body.get('pagination', {}).get('total', body.get('total')) if isinstance(body, dict) else None
        if status != 200 or type(total) is not int or total <= 0:
            raise ValueError('authenticated data journey failed')
        checks.append({'path': path, 'total': total, 'status': status})
    return {'status': 'passed', 'anonymous_api': 401, 'login': 200, 'data': checks}


def switch(target, expected):
    if not POINTER.is_symlink() or POINTER.resolve() != expected:
        raise ValueError('pointer baseline changed')
    temporary = POINTER.with_name('.app-release-' + str(os.getpid()))
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, POINTER)


def rollback(base, stage, switched):
    for service in reversed(SERVICES):
        run(['pm2', 'stop', service])
    if switched:
        switch(base, stage)
    for service in SERVICES:
        run(['pm2', 'start', service])
    result = smoke(base)
    run(['pm2', 'save'])
    return result


def save(path, value):
    path.write_text(json.dumps(value, sort_keys=True) + '\n')
    path.chmod(0o600)


def source_proof(stage):
    # Real source invocation, offline fixtures only: never transports or writes DB.
    env = dict(os.environ, SMARTPROP_BACKGROUND_SERVICES_ENABLED='false')
    result = subprocess.run(['/root/.bun/bin/bun', 'test', 'scripts/article-body-cleanup.test.ts',
                             'scripts/newsletter-lead-code.test.ts', 'scripts/newsletter-campaign-runner.test.ts'],
                            cwd=stage, env=env, check=True, capture_output=True, text=True, timeout=60)
    output = result.stdout + result.stderr
    matches = re.findall(r'^\s*(\d+) pass$', output, re.M)
    if len(matches) != 1 or int(matches[0]) < 65 or not re.search(r'^\s*0 fail$', output, re.M):
        raise ValueError('focused runtime tests produced no passing verdict')
    return {'status': 'passed', 'focused_tests': int(matches[0]), 'output_sha256': sha(output.encode())}


def stage_release(request, before, stage, base):
    if stage.exists():
        raise ValueError('stage already exists; inspect instead of overwriting')
    archive = inspect_archive(base64.b64decode(request['source'], validate=True), request['source_sha256'], 'source')
    if shutil.disk_usage(RELEASES).free < 8 * 1024**3 or not run(['node', '--version']).startswith('v24.'):
        raise ValueError('build environment preflight failed')
    for name in ['package.json', 'bun.lock']:
        if archive.read(name) != (base / name).read_bytes():
            raise ValueError('dependency changes require another qualified release')
    stage.mkdir(mode=0o700)
    journal = {'status': 'staging', 'source': request['head'], 'base': request['base'],
               'source_sha256': request['source_sha256'], 'plan_sha256': request['plan_sha256'],
               'before': before, 'stage': str(stage), 'started_at': time.time()}
    file = stage / '.app-staging.json'
    save(file, journal)
    try:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            path = stage / entry.filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(entry))
            path.chmod(0o755 if (entry.external_attr >> 16) & 0o111 else 0o644)
        for name in ['.env', '.env.local']:
            (stage / name).write_bytes((base / name).read_bytes())
            (stage / name).chmod(0o600)
        (stage / 'storage').symlink_to((base / 'storage').resolve(strict=True), target_is_directory=True)
        # Same frozen package/lock: reuse the retained immutable dependency tree.
        (stage / 'node_modules').symlink_to((base / 'node_modules').resolve(strict=True), target_is_directory=True)
        (stage / '.deploy-source-revision').write_text(request['head'] + '\n')
        env = dict(os.environ, SMARTPROP_BACKGROUND_SERVICES_ENABLED='false', NEXT_TELEMETRY_DISABLED='1')
        with (stage / '.app-build.log').open('x') as log:
            (stage / '.app-build.log').chmod(0o600)
            result = subprocess.run(['node', 'node_modules/next/dist/bin/next', 'build'], cwd=stage,
                                    env=env, stdout=log, stderr=subprocess.STDOUT, timeout=900)
        if result.returncode:
            raise ValueError('staged build failed; inspect private .app-build.log')
        build = (stage / '.next/BUILD_ID').read_text().strip()
        if not build or snapshot() != before:
            raise ValueError('staging changed serving state or build identity missing')
        proof = source_proof(stage)
        port = 3101
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', port))
        with (stage / '.app-canary.log').open('x') as log:
            (stage / '.app-canary.log').chmod(0o600)
            process = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', str(port)],
                                       cwd=stage, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                canary = smoke(stage, port)
                if process.poll() is not None:
                    raise ValueError('canary process exited')
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=30)
        if snapshot() != before:
            raise ValueError('canary changed serving state')
        runtime = {str(path.relative_to(stage)): sha(path.read_bytes()) for path in (stage / '.next').rglob('*') if path.is_file() and 'cache' not in path.relative_to(stage / '.next').parts}
        journal.update(status='passed', build_id=build, runtime=runtime,
                       entries={x.filename: sha(archive.read(x)) for x in archive.infolist() if not x.is_dir()},
                       source_proof=proof, canary=canary, service_started=False, live=False, finished_at=time.time())
    except Exception as error:
        journal.update(status='failed', error=str(error)[:400])
        save(file, journal)
        raise
    save(file, journal)
    return {k: v for k, v in journal.items() if k not in ['runtime', 'entries']}


def host(request):
    if not all(re.fullmatch(r'[0-9a-f]{40}', request.get(key, '')) for key in ['head', 'base']):
        raise ValueError('exact source identity required')
    if not re.fullmatch(r'[0-9a-f]{64}', request.get('plan_sha256', '')):
        raise ValueError('exact plan identity required')
    before = snapshot()
    base = Path(before['app'])
    stage = RELEASES / ('app-' + request['head'][:12])
    if before['source'] != request['base'] or any(x['status'] != 'online' for x in before['processes'].values()):
        raise ValueError('live baseline differs')
    if request['action'] == 'stage':
        return stage_release(request, before, stage, base)
    journal = json.loads((stage / '.app-staging.json').read_text())
    if (journal['status'] != 'passed' or journal['source'] != request['head'] or
            journal['plan_sha256'] != request['plan_sha256'] or journal['before'] != before):
        raise ValueError('staging qualification or baseline changed')
    for name, digest in {**journal['entries'], **journal['runtime']}.items():
        if sha((stage / name).read_bytes()) != digest:
            raise ValueError('staged artifact drift: ' + name)
    for name, digest in before['env'].items():
        if sha((stage / name).read_bytes()) != digest:
            raise ValueError('configuration drift')
    if subprocess.run(['pgrep', '-P', str(before['processes']['scraper-worker']['pid'])], capture_output=True).returncode != 1:
        raise ValueError('scraper worker has an active child; wait for job completion')
    if request['action'] == 'preflight':
        return {'status': 'passed', 'source': request['head'], 'build_id': journal['build_id'], 'before': before}
    if request['action'] != 'release':
        raise ValueError('unknown action')
    record = {'status': 'started', 'source': request['head'], 'plan_sha256': request['plan_sha256'],
              'before': before, 'started_at': time.time()}
    receipt = stage / '.app-activation.json'
    if receipt.exists():
        raise ValueError('activation already attempted; inspect receipt')
    save(receipt, record)
    switched = False
    try:
        for service in reversed(SERVICES):
            run(['pm2', 'stop', service])
        switch(stage, base)
        switched = True
        for service in SERVICES:
            run(['pm2', 'start', service])
        proof = smoke(stage)
        after = snapshot()
        preserved = ['env', 'storage', 'nginx', 'public', 'public_index', 'daily_report', 'gateway_config', 'gateway_pid']
        if after['app'] != str(stage) or any(after[k] != before[k] for k in preserved):
            raise ValueError('preserved consumer changed')
        if any(x['status'] != 'online' for x in after['processes'].values()):
            raise ValueError('application process not online')
        run(['pm2', 'save'])
        record.update(status='passed', live=True, after=after, smoke=proof, build_id=journal['build_id'],
                      preservation_proof={k: after[k] for k in preserved}, rollback=str(base), finished_at=time.time())
    except Exception as error:
        record['error'] = str(error)[:400]
        try:
            record['rollback_smoke'] = rollback(base, stage, switched)
            record.update(status='rolled-back', live=False, restored=snapshot())
        except Exception as rollback_error:
            record.update(status='failed', rollback_error=str(rollback_error)[:400])
    save(receipt, record)
    return record


if __name__ == '__main__':
    try:
        with Path('/opt/smartprop/.app-release.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(host(json.load(sys.stdin))))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error)[:500]}), file=sys.stderr)
        sys.exit(1)
