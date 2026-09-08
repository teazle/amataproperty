import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CampaignTransportResult } from '../newsletter/campaign-types';
import { sendOpenClawWhatsAppMessage } from './openclaw';
import {
  getOpenClawWhatsAppReadiness,
  type OpenClawRunner,
} from './provider-health';
import { getWAHAReadiness, sendCampaignWhatsApp } from './waha';

const execFileAsync = promisify(execFile);

export interface SelectedTransportDependencies {
  provider?: string;
  openClawAgentId?: string;
  openClawAccount?: string;
  openClawCommand?: string;
  openClawRun?: OpenClawRunner;
  getWAHAReadiness?: () => Promise<{ online: boolean; ready: boolean; error?: string }>;
  sendWAHA?: (to: string, text: string) => Promise<CampaignTransportResult>;
}

export interface SelectedWhatsAppCampaignTransport {
  preflight: () => Promise<{ ready: boolean; error?: string }>;
  transport: (to: string, text: string, idempotencyKey?: unknown) => Promise<CampaignTransportResult>;
}

type SelectedProvider = 'waha' | 'openclaw' | 'unknown';

const defaultOpenClawRun: OpenClawRunner = async (command, args) => {
  const result = await execFileAsync(command, args, {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
};

function selectProvider(value: string | undefined): SelectedProvider {
  const normalized = (value || 'waha').trim().toLowerCase();
  if (normalized === 'waha' || normalized === 'openclaw') return normalized;
  return 'unknown';
}

export function createSelectedWhatsAppCampaignTransport(
  dependencies: SelectedTransportDependencies = {},
): SelectedWhatsAppCampaignTransport {
  const configuredProvider = dependencies.provider ?? process.env.SMARTPROP_WHATSAPP_PROVIDER;
  const provider = selectProvider(configuredProvider);

  if (provider === 'unknown') {
    const error = `Unsupported SMARTPROP_WHATSAPP_PROVIDER: ${configuredProvider}`;
    return {
      preflight: async () => ({ ready: false, error }),
      transport: async () => ({ outcome: 'blocked', error }),
    };
  }

  if (provider === 'waha') {
    const readiness = dependencies.getWAHAReadiness || getWAHAReadiness;
    const transport = dependencies.sendWAHA || sendCampaignWhatsApp;
    return {
      preflight: async () => {
        const result = await readiness();
        return { ready: result.ready, error: result.error };
      },
      transport: async (to, text) => transport(to, text),
    };
  }

  const agentId = (
    dependencies.openClawAgentId ?? process.env.SMARTPROP_OPENCLAW_WHATSAPP_AGENT_ID
  )?.trim();
  const account = (
    dependencies.openClawAccount ?? process.env.SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT
  )?.trim();
  const command = dependencies.openClawCommand || process.env.OPENCLAW_BIN || 'openclaw';
  const run = dependencies.openClawRun || defaultOpenClawRun;
  const configurationError = !agentId || !account
    ? 'OpenClaw customer sending requires configured SMARTPROP_OPENCLAW_WHATSAPP_AGENT_ID and SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT'
    : undefined;
  const readiness = async () => configurationError
    ? { ready: false, error: configurationError }
    : getOpenClawWhatsAppReadiness({ account, command, run });

  return {
    preflight: async () => {
      const result = await readiness();
      return { ready: result.ready, error: result.error };
    },
    transport: async (to, text, idempotencyKey) => {
      const ready = await readiness();
      if (!ready.ready) {
        return {
          outcome: 'blocked',
          error: ready.error || `OpenClaw WhatsApp account "${account}" is not ready`,
        };
      }

      const result = await sendOpenClawWhatsAppMessage(to, text, {
        command,
        agentId,
        accountId: account,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
        run,
      });
      const messageId = typeof result.messageId === 'string' ? result.messageId.trim() : '';
      if (result.success && messageId) {
        return { outcome: 'accepted', messageId };
      }
      return {
        outcome: 'unknown',
        error: `OpenClaw send outcome is ambiguous: ${result.error || 'successful response did not contain a provider message id'}`,
      };
    },
  };
}
