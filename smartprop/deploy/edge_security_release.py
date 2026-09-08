#!/usr/bin/env python3
"""Controller-owned, artifact-bound release for the verified SmartProp web edge."""
import argparse
import base64
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

from daily_report_release import ROOT, run, identity, canonical, sha, artifact_cache, release_factory
from edge_security_host import harden

DEPLOY = ROOT / 'smartprop/deploy'
MANIFEST = DEPLOY / 'edge-security-release-factory.toml'
CACHE = Path('/Users/vincent/.codex/artifact-cache/propertydemo-edge-security')
ARTIFACT = 'web_edge_configuration'
PRESERVED = ['daily_report', 'main_app', 'public_site', 'scraper_worker']


def remote(request):
    code = (DEPLOY / 'edge_security_host.py').read_text()
    return json.loads(run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                          'smartprop-vps', 'python3 -c ' + shlex.quote(code)], input=json.dumps(request)))


def verify():
    subprocess.run(['python3', '-B', str(ROOT / 'smartprop/scripts/edge-security-verify.py')], check=True)
    return {'status': 'passed', 'live': False}


def package(base, baseline, output):
    head = identity(base)
    adapter = release_factory.load_adapter(MANIFEST)
    release_factory.admit_release(adapter, 'existing-host', base, head, require_qualified_executor=True)
    config = harden(baseline.read_bytes())
    binding = release_factory.artifact_binding(adapter, base, head, ARTIFACT)
    with tempfile.TemporaryDirectory(prefix='smartprop-edge-package-') as temp:
        directory = Path(temp); directory.chmod(0o700)
        inputs = directory / 'inputs'; inputs.mkdir(mode=0o700)
        outputs = directory / 'outputs'; outputs.mkdir(mode=0o700)
        raw_binding = canonical(binding)
        (inputs / 'binding.json').write_bytes(raw_binding)
        (inputs / 'binding.json').chmod(0o600)
        (outputs / 'smartprop.conf').write_bytes(config)
        (outputs / 'smartprop.conf').chmod(0o600)
        request = {
            'schema_version': 1, 'environment_sha256': sha(b'nginx-smartprop-vmi3201429-http-edge'),
            'toolchain_sha256': sha(sys.version.encode()),
            'recipe_sha256': sha((DEPLOY / 'edge_security_host.py').read_bytes()),
            'inputs': [{'mode': 0o600, 'path': 'binding.json', 'sha256': sha(raw_binding), 'size': len(raw_binding)}],
            'outputs': [{'mode': 0o600, 'name': 'smartprop.conf', 'path': 'smartprop.conf'}],
        }
        request_file = directory / 'request.json'
        request_file.write_bytes(canonical(request)); request_file.chmod(0o600)
        published = artifact_cache.publish(CACHE, request_file, inputs, outputs)
        plan = release_factory.plan_release(adapter, base, head, {ARTIFACT: published['artifact_manifest_sha256']},
                                            cache_root=CACHE, mode='existing-host', require_qualified_executor=True)
        if identity(base) != head:
            raise ValueError('source changed during packaging')
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
        raise ValueError('release source mismatch')
    adapter = release_factory.load_adapter(MANIFEST)
    fresh = release_factory.plan_release(adapter, base, head, plan['deployment']['artifacts'], cache_root=CACHE,
                                        mode='existing-host', require_qualified_executor=True)
    for value in (plan, fresh):
        value.pop('phase_timings_ms', None)
    if plan != fresh:
        raise ValueError('release plan does not recompute')
    if (plan['deployment']['affected_consumers'] != ['web_edge'] or
            plan['deployment']['preserved_consumers'] != PRESERVED):
        raise ValueError('not an edge-only release')
    with tempfile.TemporaryDirectory(prefix='smartprop-edge-release-') as temp:
        destination = Path(temp) / 'artifact'
        artifact_cache.materialize(CACHE, plan['deployment']['artifacts'][ARTIFACT], destination)
        config = (destination / 'smartprop.conf').read_bytes()
        result = remote({'head': head, 'config': base64.b64encode(config).decode(), 'sha256': sha(config)})
    if result.get('status') != 'passed' or result.get('head') != head or result.get('service_started') is not False:
        raise ValueError('edge terminal acceptance failed')
    return {**result, 'executor_capability': 'qualified-v2', 'preservation_proof': 'edge-only',
            'source': head, 'plan': expected_sha}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'preflight', 'package', 'release'])
    parser.add_argument('--base')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--release-plan', type=Path)
    parser.add_argument('--release-plan-sha256')
    args = parser.parse_args()
    try:
        if args.action == 'verify': result = verify()
        elif args.action == 'preflight': result = remote({'action': 'preflight'})
        elif args.action == 'package': result = package(args.base, args.baseline, args.output)
        else: result = release(args.release_plan, args.release_plan_sha256)
        print(json.dumps(result, sort_keys=True))
    except Exception as exc:
        print(json.dumps({'status': 'failed', 'error': str(exc)[:700]}), file=sys.stderr)
        sys.exit(1)
