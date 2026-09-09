#!/usr/bin/env python3
"""Exact-target Nginx containment; no app, scraper, messaging or data changes."""
import base64
import fcntl
import hashlib
from http.client import HTTPSConnection
import json
import os
from pathlib import Path
import re
import subprocess
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

HOST = 'vmi3201429'
MACHINE = 'bfb5b1b8859546f9aac39a4c5bafa616'
CONFIG = Path('/etc/nginx/conf.d/smartprop.conf')
RELEASES = Path('/etc/nginx/smartprop-security-releases')
BASE_SHA = '9ac5e29ff8626476926597a811af057f134a85f6c43cca31f60248e68039c6d4'
TLS_BASE_SHA = '6051f211c1feaeb9d3370953727b0880984361e98b84097cbdff8a5026ebfd11'
TLS_DIRECTORY = Path('/root/smartprop-origin-tls-20260909')
TLS_DIRECTIVES = '''    listen 443 ssl;
    ssl_certificate /root/smartprop-origin-tls-20260909/origin.pem;
    ssl_certificate_key /root/smartprop-origin-tls-20260909/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
'''
ZONE = 'limit_req_zone $binary_remote_addr zone=smartprop_login:10m rate=5r/m;\n'
LOCATIONS = '''
    # Contain diagnostic disclosure and disabled signing independently of app rollout.
    location = /api/test-listings { return 404; }
    location = /api/sign/submit { return 503; }
    location = /api/admin/auth/login {
        limit_req zone=smartprop_login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://smartprop_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def harden(before):
    if digest(before) == TLS_BASE_SHA:
        marker = '    listen 80;\n'
        text = before.decode()
        if text.count(marker) != 1:
            raise ValueError('ambiguous HTTP listener')
        return text.replace(marker, marker + TLS_DIRECTIVES, 1).encode()
    if digest(before) != BASE_SHA:
        raise ValueError('Nginx baseline changed; reconcile before release')
    text = before.decode()
    marker = '\n    server_name _;\n'
    if text.count(marker) != 1:
        raise ValueError('ambiguous HTTP server')
    return (ZONE + text.replace(marker, marker + LOCATIONS, 1)).encode()


def run(argv):
    return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=30).stdout.strip()


def atomic(path, raw):
    temp = path.with_name(path.name + '.new-' + str(os.getpid()))
    with temp.open('xb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    temp.chmod(0o644)
    os.replace(temp, path)


def target():
    if run(['hostname', '-s']) != HOST or Path('/etc/machine-id').read_text().strip() != MACHINE:
        raise ValueError('target identity mismatch')
    if CONFIG.is_symlink() or not CONFIG.is_file():
        raise ValueError('unexpected Nginx configuration shape')
    run(['systemctl', 'is-active', 'nginx'])
    return {'host': HOST, 'machine_id': MACHINE, 'nginx_sha256': digest(CONFIG.read_bytes())}


def preserved():
    processes = json.loads(run(['pm2', 'jlist']))
    processes = {row['name']: {'pid': row['pid'], 'status': row['pm2_env']['status']}
                 for row in processes if row['name'] in ('smartprop', 'scraper-worker')}
    if set(processes) != {'smartprop', 'scraper-worker'} or any(p['status'] != 'online' for p in processes.values()):
        raise ValueError('application processes are not both online')
    return {'processes': processes,
            'app': str(Path('/opt/smartprop/app/smartprop').resolve(strict=True)),
            'daily_report': str(Path('/opt/smartprop/components/daily-report/current').resolve(strict=True)),
            'public_site': str(Path('/opt/luxe-realty-design/current').resolve(strict=True)),
            'public_index_sha256': digest(Path('/opt/luxe-realty-design/current/index.html').read_bytes())}


def http(path, data=None):
    req = urllib.request.Request('http://127.0.0.1' + path, data=data,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def smoke(public_sha):
    # A graceful reload can briefly overlap old workers; probe with new connections.
    for _ in range(10):
        diagnostic, _ = http('/api/test-listings')
        signing, _ = http('/api/sign/submit', b'{}')
        if diagnostic == 404 and signing == 503:
            break
        time.sleep(0.2)
    public_status, public_body = http('/')
    login_statuses = [http('/api/admin/auth/login', b'{"password":"CODEX-INVALID-SECURITY-PROBE"}')[0]
                      for _ in range(8)]
    result = {'diagnostic_status': diagnostic, 'signing_status': signing,
              'public_status': public_status, 'public_sha256': digest(public_body),
              'login_statuses': login_statuses, 'observed_at_epoch': time.time()}
    if (diagnostic != 404 or signing != 503 or public_status != 200 or
            digest(public_body) != public_sha or 429 not in login_statuses or
            any(x < 400 for x in login_statuses)):
        raise ValueError('edge user-function smoke failed: ' + json.dumps(result))
    return result


def tls_smoke(public_sha, port=443):
    context = ssl.create_default_context(cafile=str(TLS_DIRECTORY / 'origin-ca.pem'))
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    expected = digest(ssl.PEM_cert_to_DER_cert((TLS_DIRECTORY / 'origin.pem').read_text()))
    rows = []
    for hostname in ['viewproperty.ai', 'www.viewproperty.ai']:
        for path, expected_status in [('/', 200), ('/login', 200), ('/api/admin/listings', 401)]:
            connection = HTTPSConnection(hostname, timeout=15, context=context)
            try:
                connection.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', port), timeout=15), server_hostname=hostname)
                protocol = connection.sock.version()
                fingerprint = digest(connection.sock.getpeercert(binary_form=True))
                connection.request('GET', path, headers={'Host': hostname})
                response = connection.getresponse()
                body = response.read()
                if response.status != expected_status or fingerprint != expected or (path == '/' and digest(body) != public_sha):
                    raise ValueError('origin TLS content or certificate verification failed')
                rows.append({'hostname': hostname, 'path': path, 'status': response.status, 'protocol': protocol, 'certificate_sha256': fingerprint})
            finally:
                connection.close()
    return {'status': 'passed', 'certificate_and_hostname_verified': True, 'requests': rows}


def activate(request):
    if set(request) != {'head', 'config', 'sha256'} or not re.fullmatch('[0-9a-f]{40}', request['head']):
        raise ValueError('invalid release request')
    raw = base64.b64decode(request['config'], validate=True)
    if digest(raw) != request['sha256']:
        raise ValueError('artifact hash mismatch')
    identity = target()
    before = CONFIG.read_bytes()
    baseline_sha = digest(before)
    if raw != harden(before):
        raise ValueError('artifact differs from exact allowed containment change')
    keep = preserved()
    status, body = http('/')
    if status != 200:
        raise ValueError('public site preflight failed')
    public_sha = digest(body)
    RELEASES.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = RELEASES / (baseline_sha + '.conf')
    artifact = RELEASES / (request['sha256'] + '.conf')
    for path, content in ((backup, before), (artifact, raw)):
        if path.exists():
            if path.read_bytes() != content:
                raise ValueError('immutable configuration artifact conflict')
        else:
            with path.open('xb') as handle:
                handle.write(content)
            path.chmod(0o600)
    changed = False
    try:
        # Old workers retain the old configuration until a successful syntax check.
        atomic(CONFIG, raw)
        changed = True
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        proof = smoke(public_sha)
        if baseline_sha == TLS_BASE_SHA:
            proof['origin_tls'] = tls_smoke(public_sha)
        if preserved() != keep:
            raise ValueError('preserved application identity changed')
        if target()['nginx_sha256'] != request['sha256']:
            raise ValueError('active configuration changed during smoke')
        return {'status': 'passed', 'head': request['head'], 'target': identity,
                'artifact_sha256': request['sha256'], 'preserved': keep, 'smoke': proof,
                'rollback': {'backup': str(backup), 'sha256': baseline_sha}, 'service_started': False}
    except Exception:
        if changed:
            atomic(CONFIG, before)
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
            if digest(CONFIG.read_bytes()) != baseline_sha:
                raise ValueError('rollback configuration verification failed')
        raise


if __name__ == '__main__':
    request = json.load(sys.stdin)
    if request == {'action': 'preflight'}:
        print(json.dumps({'identity': target(), 'preserved': preserved()}))
    else:
        with open('/run/lock/smartprop-edge-security.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps(activate(request)))
