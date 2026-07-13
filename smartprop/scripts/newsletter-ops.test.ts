import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { deriveNewsletterHealth, type NewsletterHealthInput } from '../src/lib/newsletter/newsletter-health';

const root = join(import.meta.dir, '..');
const wrapperPath = join(root, 'scripts/run-whatsapp-newsletter-campaign.sh');
const verifierPath = join(root, 'scripts/verify-newsletter-campaign.sh');
const servicePath = join(root, 'systemd/smartprop-whatsapp-newsletter.service');
const timerPath = join(root, 'systemd/smartprop-whatsapp-newsletter.timer');
const runbookPath = join(root, 'docs/WHATSAPP_NEWSLETTER_OPERATIONS.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function healthInput(overrides: Partial<NewsletterHealthInput> = {}): NewsletterHealthInput {
  return {
    enabled: true,
    sourceRevision: 'abc123',
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
    ...overrides,
  };
}

describe('WhatsApp newsletter operations contract', () => {
  test('ships the scheduler, verifier, units, and operations runbook', () => {
    for (const path of [wrapperPath, verifierPath, servicePath, timerPath, runbookPath]) {
      expect(existsSync(path)).toBe(true);
    }
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
    expect(wrapper).toContain('/usr/bin/flock -n -E 75');
    expect(wrapper).toContain('/opt/smartprop/app/smartprop');
    expect(wrapper).toContain('BUN_BIN=/root/.bun/bin/bun');
    expect(wrapper).toContain('scripts/run-whatsapp-newsletter-campaign.ts run --json');
    expect(wrapper).toContain('10:30');
    expect(wrapper).toContain('"$exit_code" -eq 75');
    expect(wrapper).toContain('exit 10');
    expect(wrapper).toContain('exit 0');
    expect(wrapper).toContain('find "$LOG_DIR" -type f -name');
    expect(wrapper).toContain('-mtime +30');
    expect(wrapper).toContain('! -name run.lock');
  });

  test('bounds the oneshot service without enabling it or protecting Bun home', () => {
    const service = read(servicePath);
    for (const setting of [
      'Type=oneshot',
      'Restart=on-failure',
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
    expect(verifier).toContain('systemctl is-enabled');
    expect(verifier).toContain('systemctl is-active');
    expect(verifier).toContain('SELECT');
    expect(verifier).toContain('check.lastHeartbeatAt');
    expect(verifier).toContain('check.lastMeaningfulWorkAt');
    expect(verifier).toContain('newsletter health is not fresh for live mode');
    expect(verifier).not.toContain("' || fail 'invalid newsletter health JSON'");
    expect(verifier).not.toContain('ec2-user');
    expect(verifier).not.toMatch(/\b22\b(?!22)/);
    expect(verifier).not.toMatch(/\b(enable|start|restart|daemon-reload|preset)\b/);
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
      'alerts on absence',
      'timer is intentionally disabled',
    ]) expect(runbook).toContain(phrase);
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

  test('requires a current SGT-date heartbeat and WORKING readiness to be healthy', () => {
    expect(deriveNewsletterHealth(healthInput(), new Date('2026-07-13T02:00:00.000Z')).status).toBe('healthy');
    expect(deriveNewsletterHealth(healthInput({ wahaReady: false }), new Date('2026-07-13T02:00:00.000Z')).status).toBe('blocked');
    expect(deriveNewsletterHealth(healthInput({
      latestRun: { ...healthInput().latestRun!, heartbeatAt: '2026-07-12T01:35:00.000Z' },
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
