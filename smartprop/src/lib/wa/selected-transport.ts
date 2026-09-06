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
  openClawAccount?: string;
  openClawCommand?: string;
  openClawRun?: OpenClawRunner;
  getWAHAReadiness?: () => Promise<{ online: boolean; ready: boolean; error?: string }>;
  sendWAHA?: (to: string, text: string) => Promise<CampaignTransportResult>;
}

export interface SelectedWhatsAppCampaignTransport {
  preflight: () => Promise<{ ready: boolean; error?: string }>;
  transport: (to: string, text: string) => Promise<CampaignTransportResult>;
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

function selectedAccount(value: string | undefined): string {
  return value?.trim() || 'default';
}

function withOpenClawAccount(args: string[], account: string): string[] {
  const targetIndex = args.indexOf('--target');
  if (targetIndex === -1) return [...args, '--account', account];
  return [
    ...args.slice(0, targetIndex),
    '--account',
    account,
    ...args.slice(targetIndex),
  ];
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
      transport,
    };
  }

  const account = selectedAccount(
    dependencies.openClawAccount ?? process.env.SMARTPROP_OPENCLAW_WHATSAPP_ACCOUNT,
  );
  const command = dependencies.openClawCommand || process.env.OPENCLAW_BIN || 'openclaw';
  const run = dependencies.openClawRun || defaultOpenClawRun;
  const readiness = async () => getOpenClawWhatsAppReadiness({ account, command, run });

  return {
    preflight: async () => {
      const result = await readiness();
      return { ready: result.ready, error: result.error };
    },
    transport: async (to, text) => {
      const ready = await readiness();
      if (!ready.ready) {
        return {
          outcome: 'blocked',
          error: ready.error || `OpenClaw WhatsApp account "${account}" is not ready`,
        };
      }

      const result = await sendOpenClawWhatsAppMessage(to, text, {
        command,
        run: (selectedCommand, args) => run(
          selectedCommand,
          withOpenClawAccount(args, account),
        ),
      });
      const messageId = result.messageId?.trim();
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
