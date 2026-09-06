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

function selectedWhatsAppAccount(payload: unknown, account: string): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  const channelAccounts = asRecord(root.channelAccounts);
  const whatsappAccounts = channelAccounts?.whatsapp;
  if (!Array.isArray(whatsappAccounts)) return null;
  const matches = whatsappAccounts
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry?.accountId === account);
  return matches.length === 1 ? matches[0] : null;
}

function isOpenClawAccountReady(account: Record<string, unknown>): boolean {
  const healthState = typeof account.healthState === 'string' ? account.healthState.toLowerCase() : '';
  return account.enabled !== false &&
    account.configured !== false &&
    account.running === true &&
    account.connected === true &&
    account.terminalDisconnect !== true &&
    healthState !== 'terminal' &&
    healthState !== 'terminal-disconnect';
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

    const healthState = typeof selectedAccount.healthState === 'string'
      ? selectedAccount.healthState.toLowerCase()
      : '';
    if (selectedAccount.terminalDisconnect === true || healthState === 'terminal' || healthState === 'terminal-disconnect') {
      return {
        provider: 'openclaw',
        online: true,
        ready: false,
        account,
        error: `OpenClaw WhatsApp account "${account}" has a terminal disconnect`,
      };
    }
    if (selectedAccount.enabled === false || selectedAccount.configured === false) {
      return {
        provider: 'openclaw',
        online: true,
        ready: false,
        account,
        error: `OpenClaw WhatsApp account "${account}" is disabled or unconfigured`,
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
