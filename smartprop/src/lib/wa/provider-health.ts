import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getWAHAReadiness } from './waha';

const execFileAsync = promisify(execFile);
const OPENCLAW_STATUS_ARGS = ['channels', 'status', '--json'];

export type WhatsAppProvider = 'waha' | 'openclaw';

export interface MessagingProviderHealth {
  provider: WhatsAppProvider | 'unknown';
  online: boolean;
  ready: boolean;
  account?: string;
  sessionStatus?: string;
  engineState?: string;
  error?: string;
}

export interface OpenClawRunnerResult {
  stdout: string;
  stderr: string;
}

export type OpenClawRunner = (
  command: string,
  args: string[],
) => Promise<OpenClawRunnerResult>;

export interface OpenClawReadinessOptions {
  account?: string;
  command?: string;
  run?: OpenClawRunner;
}

export interface MessagingProviderHealthOptions extends OpenClawReadinessOptions {
  provider?: string;
}

const defaultOpenClawRunner: OpenClawRunner = async (command, args) => {
  const result = await execFileAsync(command, args, {
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
};

function selectedProvider(provider = process.env.SMARTPROP_WHATSAPP_PROVIDER): WhatsAppProvider | 'unknown' {
  const normalized = (provider || 'waha').trim().toLowerCase();
  if (normalized === 'waha' || normalized === 'openclaw') return normalized;
  return 'unknown';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function namedEntry(entries: unknown, name: string): Record<string, unknown> | null {
  const record = asRecord(entries);
  if (record) return asRecord(record[name]);
  if (!Array.isArray(entries)) return null;

  const matches = entries
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => [entry.account, entry.accountId, entry.id, entry.name].includes(name));
  return matches.length === 1 ? matches[0] : null;
}

function selectedWhatsAppAccount(payload: unknown, account: string): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  const channels = root.channels;
  const channel = asRecord(channels)?.whatsapp || namedEntry(channels, 'whatsapp');
  const channelRecord = asRecord(channel);
  return channelRecord ? namedEntry(channelRecord.accounts, account) : null;
}

function isOpenClawAccountReady(account: Record<string, unknown>): boolean {
  return account.running === true && account.connected === true;
}

export async function getOpenClawWhatsAppReadiness(
  options: OpenClawReadinessOptions = {},
): Promise<MessagingProviderHealth> {
  const account = options.account || process.env.SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT || 'default';
  const command = options.command || process.env.OPENCLAW_BIN || 'openclaw';
  const run = options.run || defaultOpenClawRunner;

  try {
    const { stdout } = await run(command, OPENCLAW_STATUS_ARGS);
    let payload: unknown;
    try {
      payload = JSON.parse(stdout);
    } catch {
      return {
        provider: 'openclaw',
        online: true,
        ready: false,
        account,
        error: 'OpenClaw channels status returned malformed JSON',
      };
    }

    const selectedAccount = selectedWhatsAppAccount(payload, account);
    if (!selectedAccount) {
      return {
        provider: 'openclaw',
        online: true,
        ready: false,
        account,
        error: `OpenClaw WhatsApp account "${account}" is missing or ambiguous`,
      };
    }

    if (!isOpenClawAccountReady(selectedAccount)) {
      return {
        provider: 'openclaw',
        online: true,
        ready: false,
        account,
        error: `OpenClaw WhatsApp account "${account}" is not running and connected`,
      };
    }

    return { provider: 'openclaw', online: true, ready: true, account };
  } catch (error) {
    const isTimeout = error instanceof Error && (error.name === 'AbortError' || /timeout|timed out/i.test(error.message));
    return {
      provider: 'openclaw',
      online: false,
      ready: false,
      account,
      error: isTimeout
        ? 'OpenClaw channels status timeout'
        : `OpenClaw channels status failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getMessagingProviderHealth(
  options: MessagingProviderHealthOptions = {},
): Promise<MessagingProviderHealth> {
  const provider = selectedProvider(options.provider);
  if (provider === 'openclaw') return getOpenClawWhatsAppReadiness(options);
  if (provider === 'unknown') {
    return {
      provider,
      online: false,
      ready: false,
      error: `Unsupported SMARTPROP_WHATSAPP_PROVIDER: ${options.provider || process.env.SMARTPROP_WHATSAPP_PROVIDER}`,
    };
  }

  const readiness = await getWAHAReadiness();
  return {
    provider: 'waha',
    online: readiness.online,
    ready: readiness.ready,
    sessionStatus: readiness.sessionStatus,
    engineState: readiness.engineState,
    error: readiness.error,
  };
}
