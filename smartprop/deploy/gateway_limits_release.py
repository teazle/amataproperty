#!/usr/bin/env python3
"""Immutable source-only gateway memory-limit release, preserving process/session."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / 'smartprop/deploy'
MANIFEST = DEPLOY / 'gateway-limits-release-factory.toml'
CACHE = Path('/Users/vincent/.codex/artifact-cache/propertydemo-gateway-limits')
ARTIFACT = 'gateway_limits'
SMOKE = ['smartprop/scripts/gateway-limits-verify.py']
sys.path.insert(0, '/Users/vincent/.codex/ops')
import artifact_cache
import release_factory


def run(argv, **kwargs):
    return subprocess.run([str(x) for x in argv], cwd=ROOT, check=True,
                          capture_output=True, text=True, timeout=120, **kwargs).stdout.strip()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def identity(base):
    head = run(['git', 'rev-parse', 'HEAD'])
    if run(['git', 'status', '--porcelain=v1', '--untracked-files=all']):
        raise ValueError('candidate must be clean')
    run(['git', 'merge-base', '--is-ancestor', base, head])
    return head


def remote(code, request):
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                             'smartprop-vps', 'python3 -c ' + shlex.quote(code)],
                            input=json.dumps(request), text=True, capture_output=True, timeout=120)
    try:
        response = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise RuntimeError('remote result unavailable; inspect target before retry') from None
    if result.returncode and response.get('status') != 'failed':
        raise RuntimeError('remote transport/result disagreement; inspect before retry')
    return response


def package(base, output):
    head = identity(base)
    adapter = release_factory.load_adapter(MANIFEST)
    release_factory.admit_release(adapter, 'existing-host', base, head, require_qualified_executor=True)
    binding = release_factory.artifact_binding(adapter, base, head, ARTIFACT)
    code = (DEPLOY / 'gateway_limits_host.py').read_bytes()
    expected = remote(code.decode(), {'action': 'inspect'})['snapshot']
    with tempfile.TemporaryDirectory(prefix='smartprop-gateway-limits-') as temp:
        folder = Path(temp)
        inputs = folder / 'inputs'; inputs.mkdir(mode=0o700)
        outputs = folder / 'outputs'; outputs.mkdir(mode=0o700)
        binding_raw = canonical(binding)
        (inputs / 'release-factory-binding.json').write_bytes(binding_raw)
        (outputs / 'gateway_limits_host.py').write_bytes(code)
        (outputs / 'expected.json').write_bytes(canonical(expected))
        for path in [*inputs.iterdir(), *outputs.iterdir()]:
            path.chmod(0o600)
        request = {'schema_version': 1,
                   'environment_sha256': sha(b'smartprop-vps-python3-systemd-user'),
                   'toolchain_sha256': sha(sys.version.encode()),
                   'recipe_sha256': sha(Path(__file__).read_bytes()),
                   'inputs': [{'mode': 0o600, 'path': 'release-factory-binding.json',
                               'sha256': sha(binding_raw), 'size': len(binding_raw)}],
                   'outputs': [{'mode': 0o600, 'name': name, 'path': name}
                               for name in ('gateway_limits_host.py', 'expected.json')]}
        request_file = folder / 'request.json'; request_file.write_bytes(canonical(request))
        published = artifact_cache.publish(CACHE, request_file, inputs, outputs)
        plan = release_factory.plan_release(adapter, base, head,
                    {ARTIFACT: published['artifact_manifest_sha256']}, cache_root=CACHE,
                    mode='existing-host', require_qualified_executor=True)
        if identity(base) != head:
            raise ValueError('candidate changed during packaging')
        raw = canonical(plan)
        with output.open('xb') as handle:
            handle.write(raw)
        output.chmod(0o600)
        return {'status': 'packaged', 'source': head, 'plan': str(output), 'plan_sha256': sha(raw)}


def release(path, digest):
    raw = path.read_bytes()
    if sha(raw) != digest:
        raise ValueError('plan hash mismatch')
    plan = json.loads(raw)
    base = plan['base_identity']['value']; head = identity(base)
    if plan['source_identity'] != {'kind': 'git', 'value': head}:
        raise ValueError('plan source mismatch')
    adapter = release_factory.load_adapter(MANIFEST)
    fresh = release_factory.plan_release(adapter, base, head, plan['deployment']['artifacts'],
                 cache_root=CACHE, mode='existing-host', require_qualified_executor=True)
    for value in (plan, fresh):
        value.pop('phase_timings_ms', None)
    if plan != fresh:
        raise ValueError('plan does not recompute')
    scope = plan['deployment']
    if (scope['affected_consumers'] != ['messaging_gateway'] or
        scope['preserved_consumers'] != ['main_app', 'scraper_worker'] or
        scope['required_smoke'] != [SMOKE] or set(scope['artifacts']) != {ARTIFACT}):
        raise ValueError('unsupported release scope')
    with tempfile.TemporaryDirectory(prefix='smartprop-gateway-activate-') as temp:
        output = Path(temp) / 'artifact'
        artifact_cache.materialize(CACHE, scope['artifacts'][ARTIFACT], output)
        code = (output / 'gateway_limits_host.py').read_bytes()
        if code != (DEPLOY / 'gateway_limits_host.py').read_bytes():
            raise ValueError('host executor does not match source')
        expected = json.loads((output / 'expected.json').read_text())
        result = remote(code.decode(), {'action': 'apply', 'expected': expected})
    if result.get('status') == 'failed':
        return {**result, 'source': head, 'plan': digest}
    if result.get('status') != 'passed' or result.get('restarted') is not False:
        raise ValueError('gateway activation failed')
    return {**result, 'source': head, 'plan': digest, 'live': True,
            'executor_capability': 'qualified-v2'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'preflight', 'package', 'release'])
    parser.add_argument('--base')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--release-plan', type=Path)
    parser.add_argument('--release-plan-sha256')
    args = parser.parse_args()
    try:
        if args.action == 'verify':
            run([sys.executable, '-m', 'unittest', 'discover', '-s', 'smartprop/deploy',
                 '-p', 'test_gateway_limits_*.py'])
            result = {'status': 'passed', 'live': False}
        elif args.action == 'preflight':
            result = remote((DEPLOY / 'gateway_limits_host.py').read_text(), {'action': 'inspect'})
        elif args.action == 'package':
            result = package(args.base, args.output)
        else:
            result = release(args.release_plan, args.release_plan_sha256)
        print(json.dumps(result, sort_keys=True))
        sys.exit(0 if result.get('status') in ('passed', 'packaged') else 1)
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': type(error).__name__,
                          'detail': str(error)[:300]}), file=sys.stderr)
        sys.exit(1)
