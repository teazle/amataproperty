import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import { createCampaignStore } from '../src/lib/newsletter/campaign-store';
import {
  CampaignConfigurationError,
  runNewsletterCampaign,
  runNewsletterTestSend,
} from '../src/lib/newsletter/campaign-runner';
import { normalizeSingaporeRecipient } from '../src/lib/newsletter/recipient';
import { getWAHAReadiness, sendCampaignWhatsApp } from '../src/lib/wa/waha';

export type CampaignCliCommand =
  | { command: 'run'; dryRun: boolean; date?: string; json: boolean }
  | { command: 'test-send'; destination: string; sourceLeadId: string; json: boolean }
  | { command: 'resolve-unknown'; sendId: string; resolver: string; resolution: 'sent' | 'failed'; reason: string; json: boolean };

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new CampaignConfigurationError(`${name} requires a value.`);
  return value;
}

function requireOption(args: string[], name: string): string {
  const value = optionValue(args, name);
  if (!value) throw new CampaignConfigurationError(`${name} is required.`);
  return value;
}

export function parseCampaignCliArgs(args: string[]): CampaignCliCommand {
  const json = args.includes('--json');
  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'run';
  if (command === 'run') {
    const dryRun = args.includes('--dry-run');
    const date = optionValue(args, '--date');
    if (date && !dryRun) {
      throw new CampaignConfigurationError('Production --date is forbidden; use --dry-run --date yyyy-mm-dd.');
    }
    return { command: 'run', dryRun, ...(date ? { date } : {}), json };
  }
  if (command === 'test-send') {
    return {
      command,
      destination: requireOption(args, '--to'),
      sourceLeadId: requireOption(args, '--lead-id'),
      json,
    };
  }
  if (command === 'resolve-unknown') {
    const resolution = requireOption(args, '--resolution');
    if (resolution !== 'sent' && resolution !== 'failed') {
      throw new CampaignConfigurationError('--resolution must be sent or failed.');
    }
    return {
      command,
      sendId: requireOption(args, '--send-id'),
      resolver: requireOption(args, '--resolver'),
      resolution,
      reason: requireOption(args, '--reason'),
      json,
    };
  }
  throw new CampaignConfigurationError(`Unknown command: ${command}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new CampaignConfigurationError(`${name} is required.`);
  return value;
}

function operatorRecipients(): string[] {
  return requiredEnv('SMARTPROP_NEWSLETTER_REPORT_TO').split(',').map((value) => value.trim()).filter(Boolean);
}

async function writeRecoveryRecord(record: object): Promise<void> {
  const directory = process.env.SMARTPROP_NEWSLETTER_RECOVERY_DIR || '/opt/smartprop/logs/newsletter/recovery';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(directory, `${safeTimestamp}-${crypto.randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

function printResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (value && typeof value === 'object' && 'status' in value) {
    const result = value as Record<string, unknown>;
    process.stdout.write([
      `status=${String(result.status)}`,
      `selected=${String(result.selectedCount ?? 0)}`,
      `attempted=${String(result.attemptedCount ?? 0)}`,
      `accepted=${String(result.acceptedCount ?? 0)}`,
      `rejected=${String(result.rejectedCount ?? 0)}`,
      `unknown=${String(result.unknownCount ?? 0)}`,
      `skipped=${String(result.skippedCount ?? 0)}`,
      result.blocker ? `blocker=${String(result.blocker)}` : '',
    ].filter(Boolean).join(' ') + '\n');
    return;
  }
  process.stdout.write('completed\n');
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const parsed = parseCampaignCliArgs(args);
  config({ path: join(process.cwd(), '.env.local'), quiet: true });

  const client = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const store = createCampaignStore(client);

  if (parsed.command === 'resolve-unknown') {
    await store.resolveUnknown(parsed.sendId, parsed.resolver, parsed.resolution, parsed.reason);
    printResult({ status: 'completed' }, parsed.json);
    return 0;
  }

  const dependencies = {
    store,
    preflight: async () => {
      const readiness = await getWAHAReadiness();
      return { ready: readiness.ready, error: readiness.error };
    },
    transport: sendCampaignWhatsApp,
    sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    writeRecoveryRecord,
  };

  if (parsed.command === 'test-send') {
    const configuredDestination = requiredEnv('SMARTPROP_NEWSLETTER_TEST_TO');
    const requested = normalizeSingaporeRecipient(parsed.destination);
    const configured = normalizeSingaporeRecipient(configuredDestination);
    if (!requested || requested !== configured) {
      throw new CampaignConfigurationError('test-send --to must equal SMARTPROP_NEWSLETTER_TEST_TO.');
    }
    const result = await runNewsletterTestSend(dependencies, {
      destination: requested,
      configuredDestination,
      sourceLeadId: parsed.sourceLeadId,
      featuredUrlBase: process.env.SMARTPROP_NEWSLETTER_FEATURED_URL_BASE,
    });
    printResult({ status: result.outcome, providerMessageId: result.outcome === 'accepted' ? result.messageId : undefined }, parsed.json);
    return result.outcome === 'accepted' ? 0 : result.outcome === 'unknown' ? 30 : 10;
  }

  const result = await runNewsletterCampaign(dependencies, {
    enabled: process.env.SMARTPROP_NEWSLETTER_ENABLED === '1',
    operatorRecipients: operatorRecipients(),
    dryRun: parsed.dryRun,
    date: parsed.date,
    claimToken: process.env.SMARTPROP_NEWSLETTER_CLAIM_TOKEN || `${hostname()}:newsletter-runner`,
    featuredUrlBase: process.env.SMARTPROP_NEWSLETTER_FEATURED_URL_BASE,
  });
  printResult(result, parsed.json);
  if (result.status === 'recovery-required' || result.unknownCount > 0) return 30;
  if (result.status === 'blocked') return 10;
  return 0;
}

if (import.meta.main) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    const configuration = error instanceof CampaignConfigurationError;
    process.stderr.write(`${configuration ? 'configuration error' : 'campaign error'}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = configuration ? 20 : 30;
  });
}
