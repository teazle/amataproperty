#!/usr/bin/env python3
"""Artifact-bound SmartProp app release; controller owns all target operations."""
import argparse
import base64
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
from daily_report_release import ROOT, canonical, sha, identity, artifact_cache, release_factory
from app_release_host import inspect_archive

MANIFEST = ROOT / 'deploy/release-factory.toml'
CACHE = Path('/Users/vincent/.codex/artifact-cache/propertydemo-app')
ARTIFACT = 'application_source'
AFFECTED = ['main_app', 'scraper_worker']
PRESERVED = ['daily_report', 'messaging_gateway', 'public_site', 'web_edge']
SMOKE = ['smartprop/scripts/app-readiness-verify.py']


def verify():
    subprocess.run(['python3', '-B', '-m', 'unittest', 'discover', '-s', 'smartprop/deploy',
                    '-p', 'test_app_release.py'], cwd=ROOT, check=True)
    return {'status': 'passed', 'live': False}


def package(base, output):
    head = identity(base)
    adapter = release_factory.load_adapter(MANIFEST)
    release_factory.admit_release(adapter, 'existing-host', base, head, require_qualified_executor=True)
    binding = release_factory.artifact_binding(adapter, base, head, ARTIFACT)
    with tempfile.TemporaryDirectory(prefix='smartprop-app-package-') as temp:
        root = Path(temp)
        inputs = root / 'inputs'; inputs.mkdir(mode=0o700)
        outputs = root / 'outputs'; outputs.mkdir(mode=0o700)
        source = outputs / 'source.zip'
        # Existing allowlisted source-archive implementation excludes historical secrets.
        command = ('import {prepareSourceArchive} from "./scripts/prepare-release-artifact"; '
                   'console.log(JSON.stringify(prepareSourceArchive(JSON.parse(process.argv[1]))));')
        subprocess.run(['bun', '-e', command, json.dumps({'repository': str(ROOT), 'sourceDirectory': 'smartprop',
                       'sourceCommit': head, 'sourceArchive': str(source)})], cwd=ROOT / 'smartprop', check=True,
                       capture_output=True, text=True, timeout=60)
        raw = source.read_bytes()
        inspect_archive(raw, sha(raw), 'source')
        bind = canonical(binding)
        (inputs / 'release-factory-binding.json').write_bytes(bind)
        (inputs / 'release-factory-binding.json').chmod(0o600)
        request = {'schema_version': 1, 'environment_sha256': sha(b'smartprop-linux-node24-unchanged-lock'),
                   'toolchain_sha256': sha(sys.version.encode()), 'recipe_sha256': sha(Path(__file__).read_bytes()),
                   'inputs': [{'mode': 0o600, 'path': 'release-factory-binding.json', 'sha256': sha(bind), 'size': len(bind)}],
                   'outputs': [{'mode': 0o600, 'name': 'source.zip', 'path': 'source.zip'}]}
        request_file = root / 'request.json'; request_file.write_bytes(canonical(request)); request_file.chmod(0o600)
        published = artifact_cache.publish(CACHE, request_file, inputs, outputs)
        plan = release_factory.plan_release(adapter, base, head, {ARTIFACT: published['artifact_manifest_sha256']},
                                            cache_root=CACHE, mode='existing-host', require_qualified_executor=True)
        if identity(base) != head:
            raise ValueError('source changed during packaging')
        raw_plan = canonical(plan)
        with output.open('xb') as handle:
            handle.write(raw_plan)
        output.chmod(0o600)
        return {'status': 'packaged', 'head': head, 'plan': str(output), 'plan_sha256': sha(raw_plan), **published}


def checked_plan(path, expected):
    raw = path.read_bytes()
    if sha(raw) != expected:
        raise ValueError('release plan hash mismatch')
    plan = json.loads(raw)
    base = plan['base_identity']['value']
    head = identity(base)
    if plan['source_identity'] != {'kind': 'git', 'value': head}:
        raise ValueError('source identity mismatch')
    adapter = release_factory.load_adapter(MANIFEST)
    fresh = release_factory.plan_release(adapter, base, head, plan['deployment']['artifacts'], cache_root=CACHE,
                                        mode='existing-host', require_qualified_executor=True)
    for value in [plan, fresh]:
        value.pop('phase_timings_ms', None)
    if plan != fresh:
        raise ValueError('plan or executor descriptor does not recompute')
    scope = plan['deployment']
    if (scope['affected_consumers'] != AFFECTED or scope['preserved_consumers'] != PRESERVED or
            set(scope['artifacts']) != {ARTIFACT} or scope['required_smoke'] != [SMOKE]):
        raise ValueError('unsupported release scope')
    return plan


def execute(action, path, expected):
    plan = checked_plan(path, expected)  # Recompute all bindings before target access.
    request = {'action': action, 'base': plan['base_identity']['value'],
               'head': plan['source_identity']['value'], 'plan_sha256': expected}
    if action == 'stage':
        with tempfile.TemporaryDirectory(prefix='smartprop-app-materialize-') as temp:
            output = Path(temp) / 'source'
            artifact_cache.materialize(CACHE, plan['deployment']['artifacts'][ARTIFACT], output)
            raw = (output / 'source.zip').read_bytes()
            inspect_archive(raw, sha(raw), 'source')
            request.update(source=base64.b64encode(raw).decode(), source_sha256=sha(raw))
    code = (ROOT / 'smartprop/deploy/app_release_host.py').read_text()
    process = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'smartprop-vps',
                              'python3 -c ' + shlex.quote(code)], input=json.dumps(request),
                             capture_output=True, text=True, timeout=1100 if action == 'stage' else 180)
    if process.returncode:
        raise ValueError(process.stderr[-700:])
    result = json.loads(process.stdout)
    if result.get('status') != 'passed' or result.get('source') != request['head']:
        raise ValueError('target did not pass: ' + json.dumps(result))
    return {**result, 'executor_capability': 'qualified-v2', 'plan_sha256': expected}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'package', 'stage', 'preflight', 'release'])
    parser.add_argument('--base')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--release-plan', type=Path)
    parser.add_argument('--release-plan-sha256')
    args = parser.parse_args()
    try:
        if args.action == 'verify': result = verify()
        elif args.action == 'package': result = package(args.base, args.output)
        else: result = execute(args.action, args.release_plan, args.release_plan_sha256)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error)[:1000]}), file=sys.stderr)
        sys.exit(1)
