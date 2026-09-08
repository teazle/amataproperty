#!/usr/bin/env python3
"""Controller-owned immutable daily-report component release entrypoint."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / 'smartprop/deploy'
MANIFEST = DEPLOY / 'daily-report-release-factory.toml'
OPS = Path('/Users/vincent/.codex/ops')
sys.path.insert(0, str(OPS))
import artifact_cache
import release_factory

CACHE = Path('/Users/vincent/.codex/artifact-cache/propertydemo-daily-report')
ARTIFACT = 'daily_report_component'
TESTS = ['scripts/daily-report-send.test.ts', 'scripts/daily-report-listing-touches.test.ts',
         'scripts/messaging-provider-health.test.ts', 'scripts/build-daily-report.test.ts']


def run(argv, cwd=ROOT, **kwargs):
    return subprocess.run([str(x) for x in argv], cwd=cwd, check=True, capture_output=True,
                          text=True, timeout=240, **kwargs).stdout.strip()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def remote(request):
    code = (DEPLOY / 'daily_report_host.py').read_text()
    return json.loads(run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                          'smartprop-vps', 'python3 -c ' + shlex.quote(code)], input=json.dumps(request)))


def verify():
    subprocess.run([str(ROOT / 'smartprop/scripts/daily-report-verify.py')], cwd=ROOT, check=True)
    return {'status': 'passed', 'live': False}


def identity(base):
    head = run(['git', 'rev-parse', 'HEAD'])
    if run(['git', 'status', '--porcelain=v1', '--untracked-files=all']):
        raise ValueError('candidate must be clean')
    run(['git', 'merge-base', '--is-ancestor', base, head])
    return head


def package(base, output):
    head = identity(base)
    adapter = release_factory.load_adapter(MANIFEST)
    release_factory.admit_release(adapter, 'existing-host', base, head, require_qualified_executor=True)
    binding = release_factory.artifact_binding(adapter, base, head, ARTIFACT)
    with tempfile.TemporaryDirectory(prefix='smartprop-report-package-') as temp:
        directory = Path(temp)
        directory.chmod(0o700)
        inputs = directory / 'input'; inputs.mkdir(mode=0o700)
        binding_bytes = canonical(binding)
        binding_file = inputs / 'release-factory-binding.json'
        binding_file.write_bytes(binding_bytes); binding_file.chmod(0o600)
        outputs = directory / 'output'; outputs.mkdir(mode=0o700)
        run(['bun', 'deploy/build-daily-report.ts', '--output', outputs], cwd=ROOT / 'smartprop')
        for path in outputs.iterdir():
            path.chmod(0o600)
        request = {
            'schema_version': 1,
            'environment_sha256': sha(b'portable-bun-js-target-linux-bun-1.3.13'),
            'toolchain_sha256': sha(run(['bun', '--version']).encode()),
            'recipe_sha256': sha((DEPLOY / 'build-daily-report.ts').read_bytes()),
            'inputs': [{'mode': 0o600, 'path': binding_file.name, 'sha256': sha(binding_bytes), 'size': len(binding_bytes)}],
            'outputs': [{'mode': 0o600, 'name': name, 'path': name} for name in ['report.js', 'manifest.json']],
        }
        request_file = directory / 'request.json'
        request_file.write_bytes(canonical(request)); request_file.chmod(0o600)
        published = artifact_cache.publish(CACHE, request_file, inputs, outputs)
        plan = release_factory.plan_release(adapter, base, head, {ARTIFACT: published['artifact_manifest_sha256']},
                                           cache_root=CACHE, mode='existing-host', require_qualified_executor=True)
        if identity(base) != head:
            raise ValueError('candidate changed while packaging')
        raw = canonical(plan)
        with output.open('xb') as handle:
            handle.write(raw)
        output.chmod(0o600)
        return {'status': 'packaged', 'head': head, 'plan': str(output), 'plan_sha256': sha(raw), **published}


def release(plan_path, expected_sha):
    raw = plan_path.read_bytes()
    if sha(raw) != expected_sha:
        raise ValueError('release plan hash mismatch')
    plan = json.loads(raw)
    base = plan['base_identity']['value']
    head = identity(base)
    if plan['source_identity'] != {'kind': 'git', 'value': head}:
        raise ValueError('plan source mismatch')
    adapter = release_factory.load_adapter(MANIFEST)
    fresh = release_factory.plan_release(adapter, base, head, plan['deployment']['artifacts'], cache_root=CACHE,
                                         mode='existing-host', require_qualified_executor=True)
    for value in (plan, fresh):
        value.pop('phase_timings_ms', None)
    if plan != fresh:
        raise ValueError('plan does not recompute')
    if plan['deployment']['affected_consumers'] != ['daily_report'] or plan['deployment']['preserved_consumers'] != ['main_app', 'scraper_worker']:
        raise ValueError('not a daily-report-only release')
    with tempfile.TemporaryDirectory(prefix='smartprop-report-release-') as temp:
        destination = Path(temp) / 'artifact'
        artifact_cache.materialize(CACHE, plan['deployment']['artifacts'][ARTIFACT], destination)
        bundle = (destination / 'report.js').read_bytes()
        manifest = json.loads((destination / 'manifest.json').read_text())
        if manifest['source']['sha256'] != sha((ROOT / 'smartprop/scripts/smartprop-daily-report.ts').read_bytes()) or manifest['lock']['sha256'] != sha((ROOT / 'smartprop/bun.lock').read_bytes()):
            raise ValueError('bundle source or dependency identity mismatch')
        if manifest['outputs'] != [{'path': 'report.js', 'sha256': sha(bundle)}]:
            raise ValueError('bundle output mismatch')
        result = remote({'head': head, 'bundle': base64.b64encode(bundle).decode(), 'sha256': sha(bundle)})
    if result.get('status') != 'passed' or result.get('head') != head or result.get('service_started') is not False:
        raise ValueError('component terminal acceptance failed')
    return {**result, 'executor_capability': 'qualified-v2', 'preservation_proof': 'daily-report-only',
            'source': head, 'plan': expected_sha}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'preflight', 'package', 'release', 'rollback'])
    parser.add_argument('--base')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--release-plan', type=Path)
    parser.add_argument('--release-plan-sha256')
    parser.add_argument('--artifact-sha256')
    args = parser.parse_args()
    try:
        if args.action == 'verify': result = verify()
        elif args.action == 'preflight': result = remote({'action': 'preflight'})
        elif args.action == 'package': result = package(args.base, args.output)
        elif args.action == 'rollback': result = remote({'action': 'rollback', 'sha256': args.artifact_sha256})
        else: result = release(args.release_plan, args.release_plan_sha256)
        print(json.dumps(result, sort_keys=True))
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'error': str(exc)[:500]}), file=sys.stderr)
        sys.exit(1)
