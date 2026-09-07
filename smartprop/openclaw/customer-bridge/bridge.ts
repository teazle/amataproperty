import { createHmac } from 'node:crypto';

// Narrow contract verified against OpenClaw 2026.9.2 before_dispatch types.
export interface InboundEvent {
  messageId?: string; content: string; body?: string; channel?: string;
  senderId?: string; isGroup?: boolean; timestamp?: number;
}
export interface InboundContext {
  messageId?: string; channelId?: string; accountId?: string; senderId?: string;
}
export interface BridgeConfig {
  accountId: string; selfNumber: string; operatorNumbers: string[];
  customerNumbers: string[]; endpoint: string; secret: string;
}
interface Dependencies {
  fetch?: typeof fetch;
  now?: () => number;
  error?: (message: string) => void;
}

function phone(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/@(?:c\.us|s\.whatsapp\.net)$/, '');
  const match = normalized.match(/^(?:\+?65)?([89]\d{7})$/);
  return match ? `+65${match[1]}` : null;
}

export function createCustomerBridge(config: BridgeConfig, dependencies: Dependencies = {}) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      endpoint.pathname !== '/api/wa/openclaw' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Customer bridge requires the local SmartProp webhook endpoint');
  }
  if (!config.secret?.trim() || !config.accountId?.trim() || !phone(config.selfNumber)) throw new Error('Customer bridge credentials/account are incomplete');
  const operators = new Set(config.operatorNumbers.map(phone));
  const customers = new Set(config.customerNumbers.map(phone));
  if (!operators.size || operators.has(null) || customers.has(null) || [...customers].some(value => operators.has(value))) {
    throw new Error('Customer bridge requires valid disjoint operator/customer identities');
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const logError = dependencies.error ?? (() => undefined);

  return async (event: InboundEvent, ctx: InboundContext): Promise<{ handled: true } | undefined> => {
    if (ctx.channelId !== 'whatsapp' || ctx.accountId !== config.accountId) return;
    const claimed = { handled: true } as const;
    const sender = phone(ctx.senderId);
    // Never trust content or a conflicting event to select the privileged route.
    if (!sender || event.channel !== 'whatsapp' || phone(event.senderId) !== sender || event.isGroup !== false) return claimed;
    if (operators.has(sender)) return;
    if (!customers.has(sender)) return claimed;
    if (!event.messageId?.trim() || ctx.messageId !== event.messageId ||
        typeof event.content !== 'string' || !event.content.trim() || event.content.length > 64_000 ||
        !Number.isFinite(event.timestamp) || event.timestamp! <= 0) return claimed;

    // content is the raw hook message; body can contain prepared model context.
    const raw = JSON.stringify({ version: 1, accountId: config.accountId, from: sender,
      to: phone(config.selfNumber), body: event.content, messageId: event.messageId,
      // OpenClaw hook milliseconds -> existing CRM/WAHA numeric seconds.
      timestamp: Math.floor(event.timestamp! / 1000) });
    const timestamp = String(Math.floor(now() / 1000));
    const signature = createHmac('sha256', config.secret).update(`${timestamp}.${raw}`).digest('hex');
    try {
      const response = await fetchImpl(endpoint.toString(), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
        headers: { 'Content-Type': 'application/json', 'X-Smartprop-Timestamp': timestamp, 'X-Smartprop-Signature': signature },
        body: raw,
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== 'object' || !('success' in result) || result.success !== true) {
        logError('SmartProp customer handoff needs reconciliation; no automatic retry');
      }
    } catch {
      logError('SmartProp customer handoff is unknown; no automatic retry');
    }
    // CRM owns the reply. Even failure must not fall through to the operator model.
    return claimed;
  };
}
