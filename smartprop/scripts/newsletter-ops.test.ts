import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import {
  deriveNewsletterHealth,
  deriveValuationPreparationHealth,
  type NewsletterHealthInput,
  type ValuationPreparationHealthInput,
} from '../src/lib/newsletter/newsletter-health';

const root = join(import.meta.dir, '..');
const wrapperPath = join(root, 'scripts/run-whatsapp-newsletter-campaign.sh');
const verifierPath = join(root, 'scripts/verify-newsletter-campaign.sh');
const servicePath = join(root, 'systemd/smartprop-whatsapp-newsletter.service');
const timerPath = join(root, 'systemd/smartprop-whatsapp-newsletter.timer');
const runbookPath = join(root, 'docs/WHATSAPP_NEWSLETTER_OPERATIONS.md');
const valuationRunbookPath = join(root, 'docs/CHLOE_VALUATION_REFRESH.md');
const monitorPath = join(root, 'scripts/monitor-newsletter-campaign.sh');
const absenceAlertTestPath = join(root, 'scripts/test-newsletter-absence-alert.sh');
const monitorServicePath = join(root, 'systemd/smartprop-newsletter-monitor.service');
const monitorTimerPath = join(root, 'systemd/smartprop-newsletter-monitor.timer');
const chloeVerifierPath = join(root, '..', 'openclaw-skills', 'smartprop-crm', 'scripts', 'verify-chloe-valuation-job.sh');
const temporaryDirectories: string[] = [];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function temporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(command: string, args: string[], env: Record<string, string>) {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

function healthInput(overrides: Partial<NewsletterHealthInput> = {}): NewsletterHealthInput {
  return {
    enabled: true,
    sourceRevision: 'abc1234',
    wahaReady: true,
    latestRun: {
      runDate: '2026-07-13',
      status: 'completed',
      attempted: 5,
      accepted: 5,
      unknown: 0,
      heartbeatAt: '2026-07-13T01:35:00.000Z',
      completedAt: '2026-07-13T01:35:00.000Z',
      blocker: null,
    },
    latestFinalizedSendAt: '2026-07-13T01:34:00.000Z',
    latestFinalizedReportAt: '2026-07-13T01:35:00.000Z',
    freshnessMinutes: 30,
    ...overrides,
  };
}

describe('WhatsApp newsletter operations contract', () => {
  test('ships the scheduler, verifier, units, and operations runbook', () => {
    for (const path of [wrapperPath, verifierPath, servicePath, timerPath, runbookPath]) {
      expect(existsSync(path)).toBe(true);
    }
  });

  test('ships valuation verification, independent monitoring, and the Chloe runbook', () => {
    for (const path of [
      valuationRunbookPath, monitorPath, absenceAlertTestPath,
      monitorServicePath, monitorTimerPath, chloeVerifierPath,
    ]) expect(existsSync(path)).toBe(true);

    const timer = read(monitorTimerPath);
    for (const time of ['01:22', '01:37', '01:52', '02:07', '02:22']) {
      expect(timer).toContain(`OnCalendar=*-*-* ${time}:00 UTC`);
    }
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('RandomizedDelaySec=0');
    const service = read(monitorServicePath);
    for (const setting of [
      'Type=oneshot', 'User=root', 'NoNewPrivileges=true', 'PrivateTmp=true',
      'ProtectSystem=strict', 'ProtectHome=true', 'MemoryMax=128M',
      'TimeoutStartSec=180', 'BindReadOnlyPaths=/root/.bun/bin/bun:',
    ]) expect(service).toContain(setting);

    const monitor = read(monitorPath);
    expect(monitor).toContain('/opt/smartprop/app/smartprop/scripts/verify-newsletter-campaign.sh');
    expect(monitor).toContain('timeout_bin=/usr/bin/timeout');
    expect(monitor).toContain('"$timeout_bin" 120');
    expect(monitor).toContain('smartprop-whatsapp-newsletter-heartbeat');
    expect(monitor).toContain('SMARTPROP_NEWSLETTER_MONITOR_URL');
    expect(monitor).toContain('SMARTPROP_NEWSLETTER_ALERT_TOKEN');
    const chloeVerifier = read(chloeVerifierPath);
    expect(chloeVerifier).toContain('openclaw cron list --json');
    expect(chloeVerifier).toContain('openclaw cron runs --id "$job_id" --limit 1');
    expect(chloeVerifier).toContain(".schedule.expr == \"30 8 * * *\"");
    expect(chloeVerifier).toContain('.payload.timeoutSeconds == 2700');
    expect(chloeVerifier).toContain('.failureAlert.after == 1');
    expect(chloeVerifier).not.toMatch(/openclaw cron (add|edit|run(?:\s|$)|enable|disable)/m);
  });

  test('schedules the first run at 01:30 UTC with persistent catch-up and remains installable', () => {
    const timer = read(timerPath);
    expect(timer).toContain('OnCalendar=*-*-* 01:30:00 UTC');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('[Install]');
    expect(timer).toContain('WantedBy=timers.target');
    expect(timer).not.toContain('02:30:00 UTC');
  });

  test('hardens the wrapper and maps only pre-cutoff exit 10 to retryable failure', () => {
    const wrapper = read(wrapperPath);
    expect(wrapper).toContain('umask 0077');
    expect(wrapper).toContain('/opt/smartprop/logs/newsletter');
    expect(wrapper).toContain('chmod 0700');
    expect(wrapper).toContain('chmod 0600');
    expect(wrapper).toContain('FLOCK_BIN=/usr/bin/flock');
    expect(wrapper).toContain('"$FLOCK_BIN" -n -E 75');
    expect(wrapper).toContain('/opt/smartprop/app/smartprop');
    expect(wrapper).toContain('BUN_BIN=/root/.bun/bin/bun');
    expect(wrapper).toContain('scripts/run-whatsapp-newsletter-campaign.ts run --json');
    expect(wrapper).toContain('10:30');
    expect(wrapper).toContain('"$exit_code" -eq 75');
    expect(wrapper).toContain('exit 10');
    expect(wrapper).toContain('exit 0');
    expect(wrapper).toContain('find "$LOG_DIR" -type f -name');
    expect(wrapper).toContain('2592000');
    expect(wrapper).toContain('! -name run.lock');
  });

  test('bounds the oneshot service without enabling it or protecting Bun home', () => {
    const service = read(servicePath);
    for (const setting of [
      'Type=oneshot',
      'Restart=on-failure',
      'RestartPreventExitStatus=20 30',
      'RestartSec=15m',
      'TimeoutStartSec=15min',
      'UMask=0077',
      'MemoryHigh=',
      'MemoryMax=',
      'CPUQuota=',
      'TasksMax=',
      'NoNewPrivileges=yes',
      'PrivateTmp=yes',
      'KillSignal=SIGINT',
      'ExecStart=/opt/smartprop/app/smartprop/scripts/run-whatsapp-newsletter-campaign.sh',
    ]) expect(service).toContain(setting);
    expect(service).not.toContain('ProtectHome=yes');
    expect(service).not.toContain('[Install]');
  });

  test('keeps verifier reads pinned to the approved host and staged by default', () => {
    const verifier = read(verifierPath);
    expect(verifier).toContain('root@109.123.239.107');
    expect(verifier).toContain('2222');
    expect(verifier).toContain('vmi3201429');
    expect(verifier).toContain('--expect=staged');
    expect(verifier).toContain('--expect=live');
    expect(verifier).toContain('systemctl_bin=/usr/bin/systemctl');
    expect(verifier).toContain('"$systemctl_bin" is-enabled');
    expect(verifier).toContain('"$systemctl_bin" is-active');
    expect(verifier).toContain('SELECT');
    expect(verifier).toContain('check.lastHeartbeatAt');
    expect(verifier).toContain('check.lastMeaningfulWorkAt');
    expect(verifier).toContain('SMARTPROP_NEWSLETTER_FRESHNESS_MINUTES');
    expect(verifier).toContain('2_592_000_000');
    for (const table of [
      'newsletter_runs', 'newsletter_sends', 'newsletter_operator_reports',
      'newsletter_suppressions', 'newsletter_suppression_events',
      'newsletter_valuation_runs', 'newsletter_valuation_items', 'propnex_valuations',
    ]) expect(verifier).toContain(table);
    for (const rpc of [
      'claim_newsletter_run', 'queue_newsletter_attempt', 'start_newsletter_attempt',
      'finalize_newsletter_attempt', 'record_accepted_newsletter_recovery',
      'finalize_newsletter_operator_report', 'recover_stale_newsletter_operator_reports',
      'record_newsletter_opt_out', 'resolve_newsletter_unknown',
      'create_newsletter_test_send', 'finalize_newsletter_test_send',
      'claim_newsletter_valuation_run', 'heartbeat_newsletter_valuation_run',
      'record_newsletter_valuation_item', 'complete_newsletter_valuation_run',
      'get_newsletter_valuation_gate',
    ]) expect(verifier).toContain(rpc);
    for (const field of [
      'newsletterValuation', 'rollingAcceptedImportRate', 'newestAcceptedCacheAt',
      'lastMeaningfulWorkAt', 'currentRunStatus',
    ]) expect(verifier).toContain(field);
    expect(verifier).toContain('valuationCacheLinked');
    expect(verifier).toContain('rollingValuationAccepted');
    expect(verifier).toContain('rollingValuationCompleted');
    expect(verifier).not.toContain('. "$readonly_db_env"');
    expect(verifier).not.toMatch(/\bsystemctl\s+(enable|disable|start|restart|daemon-reload|preset)\b/);
    expect(verifier).not.toContain('ec2-user');
    expect(verifier).not.toMatch(/\b22\b(?!22)/);
    expect(verifier).not.toMatch(/\b(enable|start|restart|daemon-reload|preset)\b/);
  });

  test('authenticates the WAHA session probe', () => {
    const verifier = read(verifierPath);
    expect(verifier).toContain('SMARTPROP_NEWSLETTER_TEST_WAHA_API_KEY');
    expect(verifier).toContain('--header "X-Api-Key: $waha_api_key"');
  });

  test('documents installation without enabling and all required readiness controls', () => {
    const runbook = read(runbookPath);
    for (const phrase of [
      '01:30 UTC (09:30 SGT)',
      '10:30 SGT',
      'systemd-analyze verify',
      'daemon-reload',
      'must not enable or start',
      'enable --now',
      'DB backup and tested restore',
      'dry-run',
      'controlled ledgered test',
      'STOP',
      'resolve-unknown',
      'Kill switch',
      'rollback',
      'absence-alert delivery',
      'timer is intentionally disabled',
      'install -d -m 0700 /opt/smartprop/logs/newsletter',
      'SMARTPROP_NEWSLETTER_FRESHNESS_MINUTES=30',
      'systemctl disable --now smartprop-whatsapp-newsletter.timer',
      'SMARTPROP_NEWSLETTER_DATABASE_URL=',
      'resolve-unknown --send-id "$SEND_ID" --resolver "$OPERATOR_ID" --resolution "$RESOLUTION" --reason "$REASON" --json',
      'umask 0077',
      'mktemp -d',
      "trap 'rm -rf",
      'SMARTPROP_NEWSLETTER_STOP_FIXTURE_PHONE',
      'SMARTPROP_NEWSLETTER_FIXTURE_OWNER_DATABASE_URL',
      'has_table_privilege',
      'has_function_privilege',
      'current_user',
      'record_newsletter_opt_out',
      'ROLLBACK',
      'timeout 20m',
      'before the 09:30 SGT window',
    ]) expect(runbook).toContain(phrase);
    expect(runbook).not.toContain('FIXTURE_PHONE=6590000001');
    const stopProof = runbook.match(/## STOP disposable-fixture proof[\s\S]*?(?=\n## )/)?.[0] ?? '';
    expect(stopProof).toContain('psql "$FIXTURE_DB_URL"');
    expect(stopProof).not.toContain('psql "$DB_URL"');
  });
});

describe('newsletter absence alert proof', () => {
  function fixture(confirmed: boolean) {
    const directory = temporaryDirectory('newsletter-alert-');
    const curl = join(directory, 'curl');
    executable(curl, `
if [[ "$*" == *"--request POST"* ]]; then
  printf '%s\\n' '{"accepted":true}'
  exit 0
fi
url="\${@: -1}"
check_id="\${url##*checkId=}"
if [[ "${confirmed ? '1' : '0'}" == 1 ]]; then
  printf '{"checkId":"%s","received":true,"alertId":"alert-123","receivedAt":"2026-07-14T00:00:00.000Z"}\\n' "$check_id"
else
  printf '{"checkId":"%s","received":false}\\n' "$check_id"
fi
`);
    return {
      env: {
        SMARTPROP_NEWSLETTER_ALERT_TEST_MODE: '1',
        SMARTPROP_NEWSLETTER_ALERT_TEST_URL: 'https://alerts.example/test',
        SMARTPROP_NEWSLETTER_ALERT_STATUS_URL: 'https://alerts.example/status',
        SMARTPROP_NEWSLETTER_ALERT_TOKEN: 'test-token',
        SMARTPROP_NEWSLETTER_ALERT_CURL_BIN: curl,
        SMARTPROP_NEWSLETTER_ALERT_BUN_BIN: process.execPath,
        SMARTPROP_NEWSLETTER_ALERT_SLEEP_BIN: '/usr/bin/true',
        SMARTPROP_NEWSLETTER_ALERT_MAX_POLLS: '1',
      },
    };
  }

  test('requires independent receiver confirmation for the exact check ID', () => {
    const confirmed = run(absenceAlertTestPath, [], fixture(true).env);
    expect(confirmed.exitCode).toBe(0);
    expect(confirmed.stdout).toContain('checkId=');
    expect(confirmed.stdout).toContain('alertId=alert-123');
    expect(confirmed.stdout).toContain('receivedAt=2026-07-14T00:00:00.000Z');

    const acceptedOnly = run(absenceAlertTestPath, [], fixture(false).env);
    expect(acceptedOnly.exitCode).not.toBe(0);
  });
});

describe('newsletter external monitor check-ins', () => {
  function fixture(verifierExit: number, curlExit = 0) {
    const directory = temporaryDirectory('newsletter-monitor-');
    const verifier = join(directory, 'verifier');
    const timeout = join(directory, 'timeout');
    const curl = join(directory, 'curl');
    const capture = join(directory, 'curl.log');
    executable(verifier, `printf '%s\\n' 'redacted verifier result'; exit ${verifierExit}`);
    executable(timeout, 'shift; exec "$@"');
    executable(curl, `printf '%s\\n' "$*" >>"$MONITOR_CURL_CAPTURE"; exit ${curlExit}`);
    return {
      capture,
      env: {
        SMARTPROP_NEWSLETTER_MONITOR_TEST_MODE: '1',
        SMARTPROP_NEWSLETTER_MONITOR_VERIFIER: verifier,
        SMARTPROP_NEWSLETTER_MONITOR_TIMEOUT_BIN: timeout,
        SMARTPROP_NEWSLETTER_MONITOR_CURL_BIN: curl,
        SMARTPROP_NEWSLETTER_MONITOR_BUN_BIN: process.execPath,
        SMARTPROP_NEWSLETTER_MONITOR_URL: 'https://alerts.example/check-in',
        SMARTPROP_NEWSLETTER_ALERT_TOKEN: 'test-token',
        EXPECTED_REVISION: 'abcdef1',
        MONITOR_CURL_CAPTURE: capture,
      },
    };
  }

  test('posts signed success and failure states and fails on verifier or receiver error', () => {
    const success = fixture(0);
    expect(run(monitorPath, [], success.env).exitCode).toBe(0);
    expect(read(success.capture)).toContain('"status":"success"');

    const failure = fixture(1);
    expect(run(monitorPath, [], failure.env).exitCode).not.toBe(0);
    expect(read(failure.capture)).toContain('"status":"failure"');

    const receiverFailure = fixture(0, 22);
    expect(run(monitorPath, [], receiverFailure.env).exitCode).not.toBe(0);
  });
});

describe('Chloe valuation job verifier', () => {
  test('accepts one exact disabled job with matching prompt, alerts, and successful history', () => {
    const directory = temporaryDirectory('chloe-verifier-');
    const openclaw = join(directory, 'openclaw');
    const prompt = join(root, '..', 'openclaw-skills', 'smartprop-crm', 'jobs', 'chloe-valuation-refresh.md');
    executable(openclaw, `
if [[ "$1 $2" == 'cron list' ]]; then
  /usr/bin/jq -n --rawfile message "$CHLOE_TEST_PROMPT" '{jobs:[{
    id:"job-123", name:"smartprop-chloe-valuation-refresh", enabled:false,
    agentId:"main", sessionTarget:"isolated",
    schedule:{kind:"cron",expr:"30 8 * * *",tz:"Asia/Singapore",staggerMs:0},
    payload:{message:($message|rtrimstr("\\n")),timeoutSeconds:2700,toolsAllow:["exec","web_search","web_fetch","browser","read"]},
    delivery:{mode:"none"}, failureAlert:{after:1,channel:"whatsapp",to:"+6591051399"}
  }]}'
elif [[ "$1 $2" == 'cron runs' ]]; then
  printf '%s\\n' '{"entries":[{"status":"ok"}]}'
else
  exit 64
fi
`);
    const expectedHash = createHash('sha256').update(readFileSync(prompt)).digest('hex');
    const result = run(chloeVerifierPath, [
      '--expect=staged', `--expected-prompt-sha256=${expectedHash}`,
    ], {
      PATH: `${directory}:${process.env.PATH}`,
      CHLOE_VALUATION_ALERT_TO: '+6591051399',
      CHLOE_VALUATION_VERIFIER_TEST_MODE: '1',
      CHLOE_VALUATION_VERIFIER_PROMPT_PATH: prompt,
      CHLOE_VALUATION_VERIFIER_SHA256_BIN: '/sbin/sha256sum',
      CHLOE_TEST_PROMPT: prompt,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('jobId=job-123 enabled=false');
    expect(result.stdout).toContain(`promptSha256=${expectedHash}`);
    expect(result.stdout).toContain('lastRunStatus=ok');
  });
});

function wrapperFixture() {
  expect(read(wrapperPath)).toContain('SMARTPROP_NEWSLETTER_TEST_MODE');
  const directory = temporaryDirectory('newsletter-wrapper-');
  const appDir = join(directory, 'app');
  const logDir = join(directory, 'logs');
  mkdirSync(appDir, { recursive: true });
  const bun = join(directory, 'bun');
  const flock = join(directory, 'flock');
  executable(bun, `
if [[ -n "\${STUB_BUN_SIGNAL:-}" ]]; then kill -s "$STUB_BUN_SIGNAL" "$$"; fi
exit "\${STUB_BUN_EXIT:-0}"
`);
  executable(flock, `
if [[ "\${STUB_FLOCK_EXIT:-0}" != 0 ]]; then exit "\$STUB_FLOCK_EXIT"; fi
shift 4
exec "\$@"
`);
  const env = {
    SMARTPROP_NEWSLETTER_TEST_MODE: '1',
    SMARTPROP_NEWSLETTER_APP_DIR: appDir,
    SMARTPROP_NEWSLETTER_LOG_DIR: logDir,
    SMARTPROP_NEWSLETTER_BUN_BIN: bun,
    SMARTPROP_NEWSLETTER_FLOCK_BIN: flock,
    SMARTPROP_NEWSLETTER_TEST_SGT_TIME: '09:45',
    STUB_BUN_EXIT: '0',
    STUB_FLOCK_EXIT: '0',
  };
  return { directory, appDir, logDir, env };
}

function statusArtifacts(logDir: string): Array<Record<string, unknown>> {
  return readdirSync(logDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(logDir, name), 'utf8')));
}

describe('newsletter wrapper behavior', () => {
  test('exit 10 retries before cutoff and maps to success at or after cutoff', () => {
    const before = wrapperFixture();
    const beforeResult = run(wrapperPath, [], { ...before.env, STUB_BUN_EXIT: '10', SMARTPROP_NEWSLETTER_TEST_SGT_TIME: '10:29' });
    expect(beforeResult.exitCode).toBe(10);
    expect(statusArtifacts(before.logDir).some((item) => item.status === 'blocked-retryable')).toBe(true);

    const cutoff = wrapperFixture();
    const cutoffResult = run(wrapperPath, [], { ...cutoff.env, STUB_BUN_EXIT: '10', SMARTPROP_NEWSLETTER_TEST_SGT_TIME: '10:30' });
    expect(cutoffResult.exitCode).toBe(0);
    expect(statusArtifacts(cutoff.logDir).some((item) => item.status === 'blocked-cutoff')).toBe(true);
  });

  test('exit 20 and 30 remain manual-attention failures', () => {
    for (const exitCode of [20, 30]) {
      const fixture = wrapperFixture();
      const result = run(wrapperPath, [], { ...fixture.env, STUB_BUN_EXIT: String(exitCode) });
      expect(result.exitCode).toBe(exitCode);
      expect(statusArtifacts(fixture.logDir).some((item) => item.status === 'manual-attention')).toBe(true);
    }
  });

  test('maps unexpected runner failures to non-retryable manual-attention exit 30', () => {
    const fixture = wrapperFixture();
    const result = run(wrapperPath, [], { ...fixture.env, STUB_BUN_EXIT: '1' });
    expect(result.exitCode).toBe(30);
    expect(statusArtifacts(fixture.logDir).some((item) => item.status === 'manual-attention')).toBe(true);
  });

  test('maps a non-contention flock failure to non-retryable manual-attention exit 30', () => {
    const fixture = wrapperFixture();
    const result = run(wrapperPath, [], { ...fixture.env, STUB_FLOCK_EXIT: '9' });
    expect(result.exitCode).toBe(30);
    expect(statusArtifacts(fixture.logDir).some((item) => item.status === 'manual-attention')).toBe(true);
  });

  test('maps setup failures and runner signals to non-retryable manual-attention exit 30', () => {
    const setupFixture = wrapperFixture();
    const obstruction = join(setupFixture.directory, 'not-a-directory');
    writeFileSync(obstruction, 'occupied');
    const setupResult = run(wrapperPath, [], {
      ...setupFixture.env,
      SMARTPROP_NEWSLETTER_LOG_DIR: join(obstruction, 'logs'),
    });
    expect(setupResult.exitCode).toBe(30);

    const signalFixture = wrapperFixture();
    const signalResult = run(wrapperPath, [], { ...signalFixture.env, STUB_BUN_SIGNAL: 'TERM' });
    expect(signalResult.exitCode).toBe(30);
    expect(statusArtifacts(signalFixture.logDir).some((item) => item.status === 'manual-attention')).toBe(true);
  });

  test('lock contention maps to success without running Bun', () => {
    const fixture = wrapperFixture();
    const result = run(wrapperPath, [], { ...fixture.env, STUB_FLOCK_EXIT: '75', STUB_BUN_EXIT: '30' });
    expect(result.exitCode).toBe(0);
    expect(statusArtifacts(fixture.logDir).some((item) => item.status === 'lock-contended')).toBe(true);
    expect(statusArtifacts(fixture.logDir).some((item) => item.status === 'manual-attention')).toBe(false);
  });

  test('creates private artifacts and prunes files at the exact 43200-minute boundary', () => {
    const fixture = wrapperFixture();
    mkdirSync(fixture.logDir, { recursive: true });
    const boundary = join(fixture.logDir, 'boundary.json');
    const justUnder = join(fixture.logDir, 'just-under.json');
    writeFileSync(boundary, '{}');
    writeFileSync(justUnder, '{}');
    const now = Date.now() / 1000;
    utimesSync(boundary, now - (43_200 * 60), now - (43_200 * 60));
    utimesSync(justUnder, now - (43_199 * 60), now - (43_199 * 60));

    expect(run(wrapperPath, [], fixture.env).exitCode).toBe(0);
    expect(existsSync(boundary)).toBe(false);
    expect(existsSync(justUnder)).toBe(true);
    expect(statSync(fixture.logDir).mode & 0o777).toBe(0o700);
    for (const name of readdirSync(fixture.logDir).filter((value) => value.endsWith('.json'))) {
      expect(statSync(join(fixture.logDir, name)).mode & 0o777).toBe(0o600);
    }
  });
});

interface VerifierFixtureOptions {
  expect?: 'staged' | 'live';
  marker?: string;
  healthRevision?: string | null;
  hostname?: string;
  schemaOk?: boolean;
  currentRunExists?: boolean;
  reportAccepted?: number;
  reportTotal?: number;
  envContents?: string;
  envOwner?: string;
  envMode?: string;
  realSendRows?: number;
  testSendRows?: number;
  providerAttemptRows?: number;
}

function verifierFixture(options: VerifierFixtureOptions = {}) {
  expect(read(verifierPath)).toContain('SMARTPROP_NEWSLETTER_VERIFIER_TEST_MODE');
  const directory = temporaryDirectory('newsletter-verifier-');
  const appDir = join(directory, 'app');
  const logDir = join(directory, 'logs');
  const binDir = join(directory, 'bin');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  mkdirSync(binDir);
  chmodSync(logDir, 0o700);
  const marker = options.marker ?? 'abcdef1';
  writeFileSync(join(appDir, '.deploy-source-revision'), `${marker}\n`, { mode: 0o600 });
  const dbEnv = join(directory, 'newsletter-db.env');
  writeFileSync(dbEnv, options.envContents ?? 'SMARTPROP_NEWSLETTER_DATABASE_URL=postgresql://readonly:test@db.example/smartprop\n', { mode: 0o600 });
  chmodSync(dbEnv, 0o600);
  const healthFile = join(directory, 'health.json');
  const now = '2026-07-13T01:45:00.000Z';
  const staged = (options.expect ?? 'staged') === 'staged';
  writeFileSync(healthFile, JSON.stringify({ checks: { newsletter: {
    status: staged ? 'quiet' : 'healthy', enabled: !staged,
    sourceRevision: options.healthRevision === undefined ? marker : options.healthRevision,
    latestRunDate: staged ? null : '2026-07-13', latestRunStatus: staged ? null : 'completed',
    lastHeartbeatAt: staged ? null : '2026-07-13T01:44:00.000Z',
    lastMeaningfulWorkAt: staged ? null : '2026-07-13T01:44:00.000Z',
    freshnessMinutes: 30, attempted: staged ? 0 : 5, accepted: staged ? 0 : 5, unknown: 0, wahaReady: true,
  }, newsletterValuation: {
    state: staged ? 'disabled' : 'healthy', enabled: !staged,
    sourceRevision: 'openclaw:2026.7.14', currentRunDate: staged ? null : '2026-07-13',
    currentRunStatus: staged ? null : 'completed',
    lastHeartbeatAt: staged ? null : '2026-07-13T01:19:00.000Z',
    lastMeaningfulWorkAt: staged ? null : '2026-07-13T01:19:00.000Z',
    candidateCount: staged ? 0 : 5, projectCount: staged ? 0 : 1,
    acceptedCount: staged ? 0 : 1, rejectedCount: 0, blockedCount: 0, failedCount: 0,
    newestAcceptedCacheAt: staged ? null : '2026-07-13T01:18:00.000Z',
    latestLocalFailure: null, rollingAcceptedImports: staged ? 0 : 4,
    rollingCompletedItems: staged ? 0 : 5, rollingAcceptedImportRate: staged ? 0 : 0.8,
    freshnessMinutes: 15, blocker: null,
  } } }));
  const wahaFile = join(directory, 'waha.json');
  writeFileSync(wahaFile, JSON.stringify({ status: 'WORKING' }));
  const dbFile = join(directory, 'db.json');
  writeFileSync(dbFile, JSON.stringify({
    schemaOk: options.schemaOk ?? true,
    currentRunExists: options.currentRunExists ?? !staged,
    runDate: staged ? null : '2026-07-13', runStatus: staged ? null : 'completed',
    selected: staged ? 0 : 5, attempted: staged ? 0 : 5, accepted: staged ? 0 : 5,
    failed: 0, unknown: 0, skipped: 0,
    reportOperators: staged ? 0 : 1,
    reportTotal: options.reportTotal ?? (staged ? 0 : 6),
    reportTerminal: options.reportTotal ?? (staged ? 0 : 6),
    reportAccepted: options.reportAccepted ?? options.reportTotal ?? (staged ? 0 : 6),
    allTimeAttempted: staged ? 0 : 10, allTimeAccepted: staged ? 0 : 8,
    valuationRunExists: !staged,
    valuationRunDate: staged ? null : '2026-07-13',
    valuationRunStatus: staged ? null : 'completed',
    valuationCandidates: staged ? 0 : 5,
    valuationAccepted: staged ? 0 : 1,
    valuationRejected: 0,
    valuationBlocked: 0,
    valuationFailed: 0,
    valuationCacheLinked: !staged,
    rollingValuationAccepted: staged ? 0 : 4,
    rollingValuationCompleted: staged ? 0 : 5,
    realSendRows: options.realSendRows ?? (staged ? 0 : 10),
    testSendRows: options.testSendRows ?? 0,
    providerAttemptRows: options.providerAttemptRows ?? (staged ? 0 : 10),
  }));
  const sqlCapture = join(directory, 'sql.txt');
  const curl = join(binDir, 'curl');
  const psql = join(binDir, 'psql');
  const systemctl = join(binDir, 'systemctl');
  const stat = join(binDir, 'stat');
  executable(curl, 'case "$*" in *3000*) cat "$STUB_HEALTH_FILE" ;; *3030*) cat "$STUB_WAHA_FILE" ;; *) exit 22 ;; esac');
  executable(psql, 'printf "%s" "$*" > "$STUB_SQL_CAPTURE"; cat "$STUB_DB_FILE"');
  executable(systemctl, `
case "\$1" in
  is-enabled) printf '%s\\n' "\${STUB_TIMER_ENABLED:-disabled}" ;;
  is-active) if [[ "\$2" == *.timer ]]; then printf '%s\\n' "\${STUB_TIMER_ACTIVE:-inactive}"; else printf 'inactive\\n'; fi ;;
  *) exit 64 ;;
esac
`);
  executable(stat, 'if [[ "$2" == "%U" ]]; then printf "%s\\n" "$STUB_ENV_OWNER"; elif [[ "$3" == "$STUB_LOG_DIR" ]]; then printf "700\\n"; else printf "%s\\n" "$STUB_ENV_MODE"; fi');
  const env = {
    SMARTPROP_NEWSLETTER_VERIFIER_TEST_MODE: '1',
    SMARTPROP_NEWSLETTER_TEST_APP_DIR: appDir,
    SMARTPROP_NEWSLETTER_TEST_LOG_DIR: logDir,
    SMARTPROP_NEWSLETTER_TEST_DB_ENV: dbEnv,
    SMARTPROP_NEWSLETTER_TEST_HOSTNAME: options.hostname ?? 'vmi3201429',
    SMARTPROP_NEWSLETTER_TEST_NOW: now,
    SMARTPROP_NEWSLETTER_CURL_BIN: curl,
    SMARTPROP_NEWSLETTER_PSQL_BIN: psql,
    SMARTPROP_NEWSLETTER_SYSTEMCTL_BIN: systemctl,
    SMARTPROP_NEWSLETTER_STAT_BIN: stat,
    SMARTPROP_NEWSLETTER_BUN_BIN: process.execPath,
    SMARTPROP_NEWSLETTER_TEST_WAHA_API_KEY: 'test-waha-api-key',
    STUB_HEALTH_FILE: healthFile,
    STUB_WAHA_FILE: wahaFile,
    STUB_DB_FILE: dbFile,
    STUB_SQL_CAPTURE: sqlCapture,
    STUB_ENV_OWNER: options.envOwner ?? 'root',
    STUB_ENV_MODE: options.envMode ?? '600',
    STUB_LOG_DIR: logDir,
    STUB_TIMER_ENABLED: staged ? 'disabled' : 'enabled',
    STUB_TIMER_ACTIVE: staged ? 'inactive' : 'active',
    SMARTPROP_NEWSLETTER_STAGED_BASELINE_REAL_SENDS: '0',
    SMARTPROP_NEWSLETTER_STAGED_BASELINE_TEST_SENDS: '0',
    SMARTPROP_NEWSLETTER_STAGED_BASELINE_PROVIDER_ATTEMPTS: '0',
  };
  const args = ['--local-test', `--expect=${options.expect ?? 'staged'}`, '--expected-revision=abcdef1'];
  return { directory, appDir, logDir, dbEnv, sqlCapture, env, args };
}

describe('newsletter verifier behavior', () => {
  test('accepts a clean staged install with an empty private log directory and read-only SQL', () => {
    const fixture = verifierFixture();
    const result = run(verifierPath, fixture.args, fixture.env);
    expect(result.exitCode).toBe(0);
    const sql = read(fixture.sqlCapture);
    expect(sql).toContain('BEGIN READ ONLY');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i);
  });

  test('staged verification fails if dry-run send or provider-attempt counters moved', () => {
    for (const options of [
      { realSendRows: 1 }, { testSendRows: 1 }, { providerAttemptRows: 1 },
    ]) {
      const fixture = verifierFixture(options);
      expect(run(verifierPath, fixture.args, fixture.env).exitCode).not.toBe(0);
    }
  });

  test('rejects artifacts at the exact retention boundary but accepts one minute under it', () => {
    const expired = verifierFixture();
    const expiredArtifact = join(expired.logDir, 'boundary.json');
    writeFileSync(expiredArtifact, '{}', { mode: 0o600 });
    const now = Date.now() / 1000;
    utimesSync(expiredArtifact, now - (43_200 * 60), now - (43_200 * 60));
    expect(run(verifierPath, expired.args, expired.env).exitCode).not.toBe(0);

    const retained = verifierFixture();
    const retainedArtifact = join(retained.logDir, 'just-under.json');
    writeFileSync(retainedArtifact, '{}', { mode: 0o600 });
    utimesSync(retainedArtifact, now - (43_199 * 60), now - (43_199 * 60));
    expect(run(verifierPath, retained.args, retained.env).exitCode).toBe(0);
  }, 15_000);

  test('recursively rejects a nested recovery artifact at the exact retention boundary', () => {
    const expired = verifierFixture();
    const recoveryDir = join(expired.logDir, 'recovery', '2026-07-13');
    mkdirSync(recoveryDir, { recursive: true });
    const expiredArtifact = join(recoveryDir, 'boundary.json');
    writeFileSync(expiredArtifact, '{}', { mode: 0o600 });
    const now = Date.now() / 1000;
    utimesSync(expiredArtifact, now - (43_200 * 60), now - (43_200 * 60));
    expect(run(verifierPath, expired.args, expired.env).exitCode).not.toBe(0);

    const retained = verifierFixture();
    const retainedRecoveryDir = join(retained.logDir, 'recovery', '2026-07-13');
    mkdirSync(retainedRecoveryDir, { recursive: true });
    const retainedArtifact = join(retainedRecoveryDir, 'just-under.json');
    writeFileSync(retainedArtifact, '{}', { mode: 0o600 });
    utimesSync(retainedArtifact, now - (43_199 * 60), now - (43_199 * 60));
    expect(run(verifierPath, retained.args, retained.env).exitCode).toBe(0);
  }, 15_000);

  test('fails closed on hostname, revision format, expected revision, and health revision mismatches', () => {
    for (const options of [
      { hostname: 'wrong-host' },
      { marker: 'not-a-revision' },
      { marker: '1234567' },
      { healthRevision: '1234567' },
    ]) {
      const fixture = verifierFixture(options);
      const result = run(verifierPath, fixture.args, fixture.env);
      expect(result.exitCode).not.toBe(0);
    }
  });

  test('rejects missing schema objects, missing current live run, and incomplete operator reports', () => {
    for (const options of [
      { expect: 'live' as const, schemaOk: false },
      { expect: 'live' as const, currentRunExists: false },
      { expect: 'live' as const, reportAccepted: 5 },
      { expect: 'live' as const, reportTotal: 5 },
    ]) {
      const fixture = verifierFixture(options);
      const result = run(verifierPath, fixture.args, fixture.env);
      expect(result.exitCode).not.toBe(0);
    }
  }, 15_000);

  test('reports coherent live counts and a nonzero all-time accepted success rate', () => {
    const fixture = verifierFixture({ expect: 'live' });
    const result = run(verifierPath, fixture.args, fixture.env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('allTimeSuccessRate=80.00%');
  });

  test('parses one allowlisted database assignment as data and enforces owner and mode', () => {
    for (const options of [
      { envContents: 'SMARTPROP_NEWSLETTER_DATABASE_URL=postgresql://readonly@db/smartprop\nEXTRA=value\n' },
      { envContents: 'export SMARTPROP_NEWSLETTER_DATABASE_URL=postgresql://readonly@db/smartprop\n' },
      { envOwner: 'vincent' },
      { envMode: '640' },
    ]) {
      const fixture = verifierFixture(options);
      expect(run(verifierPath, fixture.args, fixture.env).exitCode).not.toBe(0);
    }
  });

  test('rejects target override arguments without invoking a remote target', () => {
    expect(read(verifierPath)).toContain('TARGET=root@109.123.239.107');
    const result = run(verifierPath, ['--target=root@example.invalid'], {});
    expect(result.exitCode).toBe(64);
  });
});

describe('deriveNewsletterHealth', () => {
  test('is quiet while disabled or before the 09:30 SGT send window', () => {
    expect(deriveNewsletterHealth(healthInput({ enabled: false, latestRun: null }), new Date('2026-07-13T04:00:00.000Z')).status).toBe('quiet');
    expect(deriveNewsletterHealth(healthInput({ latestRun: null }), new Date('2026-07-13T01:29:59.000Z')).status).toBe('quiet');
  });

  test('is stale after the window when no current heartbeat exists', () => {
    const result = deriveNewsletterHealth(healthInput({ latestRun: null }), new Date('2026-07-13T01:30:00.000Z'));
    expect(result.status).toBe('stale');
    expect(result.lastHeartbeatAt).toBeNull();
  });

  test('uses a bounded minute threshold instead of accepting any same-day heartbeat', () => {
    expect(deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, status: 'running', heartbeatAt: '2026-07-13T01:35:00.000Z' },
    }), new Date('2026-07-13T02:05:01.000Z')).status).toBe('stale');
    expect(deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, status: 'running', heartbeatAt: '2026-07-13T01:35:00.000Z' },
    }), new Date('2026-07-13T02:05:00.000Z')).status).toBe('healthy');
  });

  test('models a completed current day as quiet after freshness expires', () => {
    const result = deriveNewsletterHealth(healthInput(), new Date('2026-07-13T04:00:00.000Z'));
    expect(result.status).toBe('quiet');
    expect(result.lastHeartbeatAt).toBe('2026-07-13T01:35:00.000Z');
  });

  test('missing or malformed source revision prevents healthy status', () => {
    expect(deriveNewsletterHealth(healthInput({ sourceRevision: null }), new Date('2026-07-13T01:40:00.000Z')).status).toBe('unknown');
    expect(deriveNewsletterHealth(healthInput({ sourceRevision: 'not-a-revision' }), new Date('2026-07-13T01:40:00.000Z')).status).toBe('unknown');
  });

  test('reports a known current blocker as blocked', () => {
    const result = deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, status: 'blocked', blocker: 'WAHA needs relink' },
      wahaReady: false,
    }), new Date('2026-07-13T01:40:00.000Z'));
    expect(result.status).toBe('blocked');
  });

  test('does not let an old blocker hide a missing current-day heartbeat', () => {
    const result = deriveNewsletterHealth(healthInput({
      latestRun: {
        ...healthInput().latestRun!,
        runDate: '2026-07-12',
        status: 'blocked',
        heartbeatAt: '2026-07-12T01:35:00.000Z',
        blocker: 'WAHA needs relink',
      },
    }), new Date('2026-07-13T01:40:00.000Z'));
    expect(result.status).toBe('stale');
  });

  test('reports recovery-required and unresolved send state as unknown', () => {
    const result = deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, status: 'failed', unknown: 1 },
    }), new Date('2026-07-13T01:40:00.000Z'));
    expect(result.status).toBe('unknown');
    expect(result.unknown).toBe(1);
  });

  test('evaluates fatal and blocker states before pre-window quiet state', () => {
    const beforeWindow = new Date('2026-07-13T01:00:00.000Z');
    for (const overrides of [
      { sourceRevision: null },
      { sourceRevision: 'malformed' },
      { dataError: true },
      { latestRun: { ...healthInput().latestRun!, status: 'failed' } },
      { latestRun: { ...healthInput().latestRun!, unknown: 1 } },
    ]) {
      expect(deriveNewsletterHealth(healthInput(overrides), beforeWindow).status).toBe('unknown');
    }
    expect(deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, status: 'blocked', blocker: 'recovery required' },
    }), beforeWindow).status).toBe('blocked');
  });

  test('requires a current SGT-date heartbeat and WORKING readiness to be healthy', () => {
    expect(deriveNewsletterHealth(healthInput(), new Date('2026-07-13T02:00:00.000Z')).status).toBe('healthy');
    expect(deriveNewsletterHealth(healthInput({ wahaReady: false }), new Date('2026-07-13T02:00:00.000Z')).status).toBe('blocked');
    expect(deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, status: 'running', heartbeatAt: '2026-07-12T01:35:00.000Z' },
    }), new Date('2026-07-13T02:00:00.000Z')).status).toBe('stale');
  });

  test('derives meaningful work from finalized sends, reports, and runs instead of heartbeat alone', () => {
    const result = deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, completedAt: '2026-07-13T01:33:00.000Z', heartbeatAt: '2026-07-13T01:40:00.000Z' },
      latestFinalizedSendAt: '2026-07-13T01:34:00.000Z',
      latestFinalizedReportAt: '2026-07-13T01:35:00.000Z',
    }), new Date('2026-07-13T01:45:00.000Z'));
    expect(result.lastMeaningfulWorkAt).toBe('2026-07-13T01:35:00.000Z');
  });
});

function valuationHealthInput(
  overrides: Partial<ValuationPreparationHealthInput> = {},
): ValuationPreparationHealthInput {
  return {
    enabled: true,
    sourceRevision: 'openclaw:2026.7.14',
    currentRun: {
      runDate: '2026-07-14',
      status: 'running',
      candidateCount: 5,
      projectCount: 1,
      acceptedCount: 0,
      rejectedCount: 0,
      blockedCount: 0,
      failedCount: 0,
      lastHeartbeatAt: '2026-07-14T00:39:00.000Z',
      lastMeaningfulWorkAt: '2026-07-14T00:35:00.000Z',
      completedAt: null,
      blocker: null,
    },
    newestAcceptedCacheAt: null,
    latestLocalFailure: null,
    rollingAcceptedImports: 4,
    rollingCompletedItems: 5,
    freshnessMinutes: 15,
    ...overrides,
  };
}

describe('deriveValuationPreparationHealth', () => {
  test('distinguishes disabled and pre-schedule quiet from an absent current run', () => {
    expect(deriveValuationPreparationHealth(
      valuationHealthInput({ enabled: false, currentRun: null }),
      new Date('2026-07-14T01:00:00.000Z'),
    ).state).toBe('disabled');
    expect(deriveValuationPreparationHealth(
      valuationHealthInput({ currentRun: null }),
      new Date('2026-07-14T00:29:59.000Z'),
    ).state).toBe('quiet');
    expect(deriveValuationPreparationHealth(
      valuationHealthInput({ currentRun: null }),
      new Date('2026-07-14T00:30:00.000Z'),
    ).state).toBe('dead');
  });

  test('requires both a fresh heartbeat and fresh meaningful work while running', () => {
    expect(deriveValuationPreparationHealth(
      valuationHealthInput(), new Date('2026-07-14T00:40:00.000Z'),
    ).state).toBe('healthy');
    expect(deriveValuationPreparationHealth(valuationHealthInput({
      currentRun: {
        ...valuationHealthInput().currentRun!,
        lastHeartbeatAt: '2026-07-14T00:49:00.000Z',
        lastMeaningfulWorkAt: '2026-07-14T00:30:00.000Z',
      },
    }), new Date('2026-07-14T00:50:00.000Z')).state).toBe('dead');
    for (const lastHeartbeatAt of [null, '2026-07-14T00:34:59.000Z']) {
      expect(deriveValuationPreparationHealth(valuationHealthInput({
        currentRun: { ...valuationHealthInput().currentRun!, lastHeartbeatAt },
      }), new Date('2026-07-14T00:50:00.000Z')).state).toBe('dead');
    }
  });

  test('never treats an incomplete run after the 09:20 SGT deadline as healthy', () => {
    const result = deriveValuationPreparationHealth(valuationHealthInput({
      currentRun: {
        ...valuationHealthInput().currentRun!,
        lastHeartbeatAt: '2026-07-14T01:19:30.000Z',
        lastMeaningfulWorkAt: '2026-07-14T01:19:00.000Z',
      },
    }), new Date('2026-07-14T01:20:00.000Z'));
    expect(result.state).toBe('dead');
  });

  test('requires a terminal zero-candidate run for quiet', () => {
    const result = deriveValuationPreparationHealth(valuationHealthInput({
      currentRun: {
        ...valuationHealthInput().currentRun!, status: 'quiet', candidateCount: 0,
        projectCount: 0, completedAt: '2026-07-14T00:31:00.000Z',
      },
    }), new Date('2026-07-14T00:45:00.000Z'));
    expect(result.state).toBe('quiet');
    expect(result.candidateCount).toBe(0);
  });

  test('reports terminal zero-accepted and cache-linkage failures as blocked', () => {
    expect(deriveValuationPreparationHealth(valuationHealthInput({
      currentRun: {
        ...valuationHealthInput().currentRun!, status: 'blocked', blockedCount: 1,
        completedAt: '2026-07-14T00:45:00.000Z', blocker: 'no accepted valuation evidence',
      },
    }), new Date('2026-07-14T00:50:00.000Z')).state).toBe('blocked');
    expect(deriveValuationPreparationHealth(valuationHealthInput({
      currentRun: {
        ...valuationHealthInput().currentRun!, status: 'completed', acceptedCount: 1,
        rejectedCount: 1, completedAt: '2026-07-14T00:45:00.000Z',
        lastMeaningfulWorkAt: '2026-07-14T00:45:00.000Z',
      },
      newestAcceptedCacheAt: null,
    }), new Date('2026-07-14T00:50:00.000Z')).state).toBe('blocked');
  });

  test('reports completed partial success and rolling accepted-import rate', () => {
    const result = deriveValuationPreparationHealth(valuationHealthInput({
      currentRun: {
        ...valuationHealthInput().currentRun!, status: 'completed', acceptedCount: 1,
        rejectedCount: 1, completedAt: '2026-07-14T00:45:00.000Z',
        lastMeaningfulWorkAt: '2026-07-14T00:45:00.000Z',
      },
      newestAcceptedCacheAt: '2026-07-14T00:44:00.000Z',
    }), new Date('2026-07-14T00:50:00.000Z'));
    expect(result.state).toBe('healthy');
    expect(result.rollingAcceptedImportRate).toBe(0.8);
    expect(result.rejectedCount).toBe(1);
  });

  test('a newer redacted local RPC failure overrides database heartbeat', () => {
    expect(deriveValuationPreparationHealth(valuationHealthInput({
      latestLocalFailure: {
        status: 'failed', command: 'heartbeat', recordedAt: '2026-07-14T00:39:30.000Z',
        errorCode: 'database_error', message: 'database operation failed',
      },
    }), new Date('2026-07-14T00:40:00.000Z')).state).toBe('dead');
    expect(deriveValuationPreparationHealth(valuationHealthInput({
      latestLocalFailure: {
        status: 'failed', command: 'queue', recordedAt: '2026-07-14T00:34:00.000Z',
        errorCode: 'database_error', message: 'database operation failed',
      },
    }), new Date('2026-07-14T00:40:00.000Z')).state).toBe('healthy');
  });

  test('does not carry yesterday current after the next schedule boundary', () => {
    const oldRun = { ...valuationHealthInput().currentRun!, runDate: '2026-07-13' };
    expect(deriveValuationPreparationHealth(
      valuationHealthInput({ currentRun: oldRun }), new Date('2026-07-14T00:29:00.000Z'),
    ).state).toBe('quiet');
    expect(deriveValuationPreparationHealth(
      valuationHealthInput({ currentRun: oldRun }), new Date('2026-07-14T00:31:00.000Z'),
    ).state).toBe('dead');
  });
});
