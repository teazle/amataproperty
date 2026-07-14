import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

const scriptsDir = import.meta.dir;
const wrapperPath = join(scriptsDir, 'smartprop-valuation-ssh-wrapper.sh');
const launcherPath = join(scriptsDir, 'smartprop-valuation-launcher.sh');
const installerPath = join(scriptsDir, 'install-smartprop-valuation-ssh.sh');
const jobInstallerPath = join(scriptsDir, '..', '..', 'openclaw-skills', 'smartprop-crm', 'scripts', 'install-chloe-valuation-job.sh');

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const ITEM_ID = '018f3f72-7c0d-4f1b-8a11-8a1234567890';
const LEASE_TOKEN = '4a1f95de-6af8-4bbb-9e45-97b7417f12ec';

function executableWrapper() {
  const root = mkdtempSync(join(tmpdir(), 'valuation-wrapper-'));
  const capturePath = join(root, 'args.txt');
  const sudoPath = join(root, 'sudo');
  const wrapper = join(root, 'wrapper.sh');
  writeFileSync(sudoPath, '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CAPTURE_PATH"\ncat >/dev/null\n');
  chmodSync(sudoPath, 0o755);
  writeFileSync(
    wrapper,
    readFileSync(wrapperPath, 'utf8')
      .replace('/usr/bin/sudo', sudoPath)
      .replace('/usr/local/libexec/smartprop-valuation-launcher', '/fixed/launcher'),
  );
  chmodSync(wrapper, 0o755);
  return { wrapper, capturePath };
}

function runWrapper(command: string | undefined, stdin = '') {
  const fixture = executableWrapper();
  const env = { ...process.env, CAPTURE_PATH: fixture.capturePath };
  if (command === undefined) delete env.SSH_ORIGINAL_COMMAND;
  else env.SSH_ORIGINAL_COMMAND = command;
  const result = Bun.spawnSync({ cmd: [fixture.wrapper], env, stdin: Buffer.from(stdin) });
  const args = result.exitCode === 0
    ? readFileSync(fixture.capturePath, 'utf8').trim().split('\n')
    : [];
  return { ...result, args };
}

describe('SmartProp valuation forced SSH wrapper', () => {
  test.each([
    ['queue --json', ['-n', '/fixed/launcher', 'queue', '--json']],
    [`heartbeat --run-id ${RUN_ID} --lease-token ${LEASE_TOKEN} --json`,
      ['-n', '/fixed/launcher', 'heartbeat', '--run-id', RUN_ID, '--lease-token', LEASE_TOKEN, '--json']],
    [`import --run-id ${RUN_ID} --item-id ${ITEM_ID} --lease-token ${LEASE_TOKEN} --json`,
      ['-n', '/fixed/launcher', 'import', '--run-id', RUN_ID, '--item-id', ITEM_ID, '--lease-token', LEASE_TOKEN, '--json']],
    [`complete --run-id ${RUN_ID} --lease-token ${LEASE_TOKEN} --json`,
      ['-n', '/fixed/launcher', 'complete', '--run-id', RUN_ID, '--lease-token', LEASE_TOKEN, '--json']],
  ])('accepts only the anchored command: %s', (command, expected) => {
    const result = runWrapper(command);
    expect(result.exitCode).toBe(0);
    expect(result.args).toEqual(expected);
  });

  test.each([
    undefined,
    '',
    'queue',
    `heartbeat --run-id ${RUN_ID} --json`,
    `heartbeat --run-id ${RUN_ID} --lease-token wrong --json`,
    'heartbeat --run-id 00000000-0000-0000-0000-000000000000 --lease-token 00000000-0000-0000-0000-000000000000 --json',
    `import --run-id ${RUN_ID} --item-id ${ITEM_ID} --lease-token ${LEASE_TOKEN}`,
    `complete --run-id ${RUN_ID} --lease-token ${LEASE_TOKEN} --json --extra`,
    `complete --run-id ${RUN_ID}; id --lease-token ${LEASE_TOKEN} --json`,
    'queue --json $(id)',
    'queue --json > /tmp/out',
    'queue --json\nid',
    'SUPABASE_SERVICE_ROLE=stolen queue --json',
    'set-project-profile --project-slug test --input /tmp/profile.json --json',
    'bash',
  ])('rejects non-allowlisted SSH command %#', (command) => {
    const result = runWrapper(command);
    expect(result.exitCode).not.toBe(0);
    expect(result.args).toEqual([]);
  });

  test('leaves oversized import stdin for the bounded CLI to reject', () => {
    const cli = readFileSync(join(scriptsDir, 'run-chloe-valuation-refresh.ts'), 'utf8');
    expect(cli).toContain('const MAX_STDIN_BYTES = 256 * 1024');
    expect(cli).toContain("throw new ValuationCliError('import stdin exceeds 256 KiB')");
    expect(runWrapper(
      `import --run-id ${RUN_ID} --item-id ${ITEM_ID} --lease-token ${LEASE_TOKEN} --json`,
      'x'.repeat(256 * 1024 + 1),
    ).exitCode).toBe(0);
  });

  test('uses a no-shell sudo boundary and a fixed independently validated launcher', () => {
    const wrapper = readFileSync(wrapperPath, 'utf8');
    const launcher = readFileSync(launcherPath, 'utf8');
    for (const text of [wrapper, launcher]) {
      expect(text).not.toMatch(/\beval\b|\bbash\s+-c\b|\bsh\s+-c\b/);
    }
    expect(wrapper).toContain('exec /usr/bin/sudo -n /usr/local/libexec/smartprop-valuation-launcher "$command" "${validated_args[@]}"');
    expect(launcher).toContain('PATH=/usr/local/bin:/usr/bin:/bin');
    expect(launcher).toContain('HOME=/var/lib/smartprop-valuation');
    expect(launcher).toContain('cd /opt/smartprop/app/smartprop');
    expect(launcher).toContain('source /etc/smartprop/smartprop.env');
    expect(launcher).toContain("/usr/bin/stat -c '%u %g %a'");
    expect(launcher).toContain('$env_uid == 0 && $env_gid == 0');
    expect(launcher).toContain('exec /root/.bun/bin/bun scripts/run-chloe-valuation-refresh.ts');
    expect(launcher).toContain('unset "$name"');
    expect(launcher.match(/command arguments do not match/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SmartProp valuation SSH installer', () => {
  test('creates the least-privilege account and exact root-owned boundary', () => {
    const installer = readFileSync(installerPath, 'utf8');
    expect(installer).toContain('smartprop-valuation');
    expect(installer).toContain('--shell /bin/bash');
    expect(installer).toContain('passwd --lock');
    expect(installer).toContain('/var/lib/smartprop-valuation');
    expect(installer).toContain('install -o root -g root -m 0755');
    expect(installer).toContain('/etc/sudoers.d/smartprop-valuation');
    expect(installer).toContain('smartprop-valuation ALL=(root) NOPASSWD: /usr/local/libexec/smartprop-valuation-launcher *');
    expect(installer).toContain('install -o root -g root -m 0440');
    expect(installer).toContain('visudo -cf');
    expect(installer).toContain("readonly source_ip='194.233.94.3'");
    expect(installer).toContain('restrict,no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-user-rc');
    expect(installer).not.toMatch(/set\s+-x|echo\s+.*(?:key|KEY)/);
  });
});

describe('Chloe valuation job installer', () => {
  test('requires alerts and stages exactly one disabled isolated job', () => {
    const installer = readFileSync(jobInstallerPath, 'utf8');
    const missingAlert = Bun.spawnSync({
      cmd: ['bash', jobInstallerPath],
      env: { ...process.env, CHLOE_VALUATION_ALERT_TO: '' },
    });
    expect(missingAlert.exitCode).not.toBe(0);
    expect(installer).toContain('--name smartprop-chloe-valuation-refresh');
    expect(installer).toContain("--cron '30 8 * * *'");
    expect(installer).toContain('--tz Asia/Singapore --exact');
    expect(installer).toContain('--agent main --session isolated --no-deliver');
    expect(installer).toContain('--timeout-seconds 2700');
    expect(installer).toContain("--tools 'exec web_search web_fetch browser read'");
    expect(installer).toContain('--failure-alert --failure-alert-after 1');
    expect(installer).toContain('--failure-alert-channel whatsapp --failure-alert-to "$CHLOE_VALUATION_ALERT_TO"');
    expect(installer).toContain('--disabled --json');
    expect(installer).toContain('openclaw cron add "${base_args[@]}" --disabled --json');
    expect(installer).toContain('openclaw cron edit "$job_id" "${base_args[@]}"');
    expect(installer).toContain('--disable');
    expect(installer).toContain('openclaw cron list --json');
  });

  test('creates once, resolves the exact ID, then edits alerts while disabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'valuation-job-'));
    const openclaw = join(root, 'openclaw');
    const state = join(root, 'state');
    const log = join(root, 'calls.log');
    writeFileSync(openclaw, `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >>"$OPENCLAW_TEST_LOG"
if [[ "$1 $2" == 'cron list' ]]; then
  if [[ -f "$OPENCLAW_TEST_STATE" ]]; then
    printf '%s\\n' '{"jobs":[{"id":"job-123","name":"smartprop-chloe-valuation-refresh"}]}'
  else
    printf '%s\\n' '{"jobs":[]}'
  fi
elif [[ "$1 $2" == 'cron add' ]]; then
  : >"$OPENCLAW_TEST_STATE"
  printf '%s\\n' '{"id":"job-123"}'
elif [[ "$1 $2" == 'cron edit' ]]; then
  :
else
  exit 64
fi
`);
    chmodSync(openclaw, 0o755);
    const result = Bun.spawnSync({
      cmd: ['/bin/bash', jobInstallerPath],
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        CHLOE_VALUATION_ALERT_TO: '+6591051399',
        OPENCLAW_TEST_LOG: log,
        OPENCLAW_TEST_STATE: state,
      },
    });
    expect(result.exitCode).toBe(0);
    const calls = readFileSync(log, 'utf8');
    expect(calls.match(/^cron add /gm)).toHaveLength(1);
    expect(calls).toContain('cron add --name smartprop-chloe-valuation-refresh');
    expect(calls).toContain('--disabled --json');
    expect(calls).toContain('cron edit job-123 --name smartprop-chloe-valuation-refresh');
    expect(calls).toContain('--failure-alert --failure-alert-after 1');
    expect(calls).toContain('--failure-alert-channel whatsapp --failure-alert-to +6591051399 --disable');
  });
});
