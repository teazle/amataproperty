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

export function buildOpenClawMessageArgs(target: string, message: string): string[] {
  return [
    'message',
    'send',
    '--channel',
    'whatsapp',
    '--target',
    target,
    '--message',
    message,
    '--json',
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

export async function sendOpenClawWhatsAppMessage(
  to: string,
  text: string,
  options: OpenClawSendOptions = {},
): Promise<OpenClawSendResult> {
  const command = options.command || process.env.OPENCLAW_BIN || 'openclaw';
  const run = options.run || defaultRun;
  const target = normalizeOpenClawWhatsAppTarget(to);
  const args = buildOpenClawMessageArgs(target, text);

  try {
    const { stdout, stderr } = await run(command, args);
    const messageId = parseOpenClawMessageId(stdout);

    if (!messageId) {
      return {
        success: false,
        error: stderr || 'OpenClaw send completed without a message id',
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
