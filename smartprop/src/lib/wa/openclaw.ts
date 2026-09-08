import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface OpenClawSendResult {
  success: boolean;
  messageId?: string;
  messageText?: string;
  error?: string;
  rawOutput?: string;
}

export interface OpenClawRunnerResult {
  stdout: string;
  stderr: string;
}

export type OpenClawRunner = (
  command: string,
  args: string[],
) => Promise<OpenClawRunnerResult>;

export interface OpenClawSendOptions {
  command?: string;
  run?: OpenClawRunner;
  agentId?: string;
  accountId?: string;
  idempotencyKey?: string;
}

const defaultRun: OpenClawRunner = async (command, args) => {
  const result = await execFileAsync(command, args, {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
};

export function normalizeOpenClawWhatsAppTarget(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.startsWith('65')) {
    return `+${digits}`;
  }
  if (digits.length === 8) {
    return `+65${digits}`;
  }
  return value.trim().startsWith('+') ? value.trim() : `+${digits}`;
}

export function buildOpenClawMessageArgs(
  target: string,
  message: string,
  input: Required<Pick<OpenClawSendOptions, 'agentId' | 'accountId' | 'idempotencyKey'>>,
): string[] {
  return [
    'gateway', 'call', 'send', '--params', JSON.stringify({
      agentId: input.agentId,
      accountId: input.accountId,
      channel: 'whatsapp',
      to: target,
      message,
      idempotencyKey: input.idempotencyKey,
    }), '--timeout', '50000', '--json',
  ];
}

export function parseOpenClawMessageId(stdout: string): string | undefined {
  const parsed = JSON.parse(stdout || '{}') as {
    messageId?: string;
    payload?: {
      result?: {
        messageId?: string;
      };
    };
  };

  return parsed.messageId || parsed.payload?.result?.messageId;
}

function isMatchingOpenClawReceipt(
  stdout: string,
  idempotencyKey: string,
): boolean {
  try {
    const parsed = JSON.parse(stdout || '{}') as {
      runId?: unknown;
      channel?: unknown;
      messageId?: unknown;
    };
    return parsed.runId === idempotencyKey &&
      parsed.channel === 'whatsapp' &&
      typeof parsed.messageId === 'string' && parsed.messageId.trim().length > 0;
  } catch {
    return false;
  }
}

export async function sendOpenClawWhatsAppMessage(
  to: string,
  text: string,
  options: OpenClawSendOptions = {},
): Promise<OpenClawSendResult> {
  const command = options.command || process.env.OPENCLAW_BIN || 'openclaw';
  const run = options.run || defaultRun;
  const target = normalizeOpenClawWhatsAppTarget(to);
  const agentId = options.agentId?.trim();
  const accountId = options.accountId?.trim();
  const idempotencyKey = options.idempotencyKey?.trim();
  if (!agentId || !accountId || !idempotencyKey) {
    return {
      success: false,
      error: 'OpenClaw send requires configured agentId, accountId, and idempotencyKey',
    };
  }
  const args = buildOpenClawMessageArgs(target, text, { agentId, accountId, idempotencyKey });

  try {
    const { stdout, stderr } = await run(command, args);
    const messageId = parseOpenClawMessageId(stdout)?.trim();

    if (!messageId || !isMatchingOpenClawReceipt(stdout, idempotencyKey)) {
      return {
        success: false,
        error: stderr || 'OpenClaw send outcome is unconfirmed; do not retry automatically',
        rawOutput: stdout,
      };
    }

    return {
      success: true,
      messageId,
      messageText: text,
      rawOutput: stdout,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown OpenClaw send error',
    };
  }
}

export function shouldUseOpenClawWhatsApp(): boolean {
  const provider = (process.env.SMARTPROP_WHATSAPP_PROVIDER || 'openclaw').toLowerCase();
  return provider === 'openclaw';
}
