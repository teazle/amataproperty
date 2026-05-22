import { createHash } from 'crypto';
import { getSupabaseClient } from '@/workers/supa';

export type WhatsAppDirection = 'inbound' | 'outbound';

export type ConversationHistoryEntry = {
  role: 'user' | 'agent';
  message: string;
  timestamp: string;
  messageId?: string;
};

export type WhatsAppMessageLogInput = {
  outreachId?: string | null;
  agentId?: string | null;
  direction: WhatsAppDirection;
  phone: string;
  chatId?: string | null;
  wahaMessageId?: string | null;
  body: string;
  rawPayload?: unknown;
  occurredAt?: string;
};

export type OutreachWithContext = {
  id: string;
  agent_id: string | null;
  listing_id: string | null;
  status: string | null;
  conversation_phase: string | null;
  conversation_state: string | null;
  conversation_history: unknown;
  auto_reply_count: number | null;
  first_message_sent_at: string | null;
  last_message_at: string | null;
  co_broking_status: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion' | null;
  co_broking_notes: string | null;
  agents?: {
    id: string;
    name: string | null;
    phone: string | null;
    agency?: string | null;
  } | null;
  listings?: {
    id: string;
    title: string | null;
    price: number | null;
    district: string | null;
    property_type: string | null;
    url?: string | null;
  } | null;
};

export function normalizeWhatsAppPhone(value: string): string {
  return value.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/[^\d]/g, '');
}

function phoneVariations(phone: string): string[] {
  const clean = normalizeWhatsAppPhone(phone);
  const without65 = clean.replace(/^65/, '');
  return [clean, without65, `65${without65}`].filter((item, index, arr) => item && arr.indexOf(item) === index);
}

function fallbackDedupeKey(input: WhatsAppMessageLogInput): string {
  const hash = createHash('sha256')
    .update(`${input.direction}|${normalizeWhatsAppPhone(input.phone)}|${input.body}|${input.occurredAt || ''}`)
    .digest('hex')
    .slice(0, 32);
  return `fallback:${hash}`;
}

export function buildDedupeKey(input: WhatsAppMessageLogInput): string {
  if (input.wahaMessageId) {
    return `${input.direction}:${input.wahaMessageId}`;
  }
  return fallbackDedupeKey(input);
}

export async function findLatestOutreachByPhone(phone: string): Promise<OutreachWithContext | null> {
  const supabase = getSupabaseClient();
  const variations = phoneVariations(phone);
  const phoneFilter = variations.map(value => `phone.eq.${value}`).join(',');

  const { data: agents, error: agentError } = await supabase
    .from('agents')
    .select('id')
    .or(phoneFilter);

  if (agentError || !agents?.length) {
    return null;
  }

  const agentIds = agents.map((agent: { id: string }) => agent.id);
  const { data } = await supabase
    .from('outreach')
    .select(`
      *,
      agents(id,name,phone,agency),
      listings(id,title,price,district,property_type,url)
    `)
    .in('agent_id', agentIds)
    .order('created_at', { ascending: false })
    .limit(1);

  return (data?.[0] as OutreachWithContext | undefined) || null;
}

export async function logWhatsAppMessage(input: WhatsAppMessageLogInput): Promise<{
  inserted: boolean;
  duplicate: boolean;
  id?: string;
}> {
  const supabase = getSupabaseClient();
  const cleanPhone = normalizeWhatsAppPhone(input.phone);
  const dedupeKey = buildDedupeKey(input);

  const { data, error } = await supabase
    .from('wa_messages')
    .insert({
      outreach_id: input.outreachId || null,
      agent_id: input.agentId || null,
      direction: input.direction,
      phone: cleanPhone,
      chat_id: input.chatId || null,
      waha_message_id: input.wahaMessageId || null,
      dedupe_key: dedupeKey,
      body: input.body,
      raw_payload: input.rawPayload || null,
      occurred_at: input.occurredAt || new Date().toISOString(),
    })
    .select('id')
    .single();

  if (!error) {
    return { inserted: true, duplicate: false, id: data?.id };
  }

  if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
    return { inserted: false, duplicate: true };
  }

  throw new Error(`Failed to log WhatsApp message: ${error.message}`);
}

export async function getConversationHistory(outreachId: string): Promise<ConversationHistoryEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('wa_messages')
    .select('direction, body, occurred_at, waha_message_id')
    .eq('outreach_id', outreachId)
    .order('occurred_at', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load WhatsApp history: ${error.message}`);
  }

  return (data || []).map((row: any) => ({
    role: row.direction === 'outbound' ? 'user' : 'agent',
    message: row.body,
    timestamp: row.occurred_at || new Date().toISOString(),
    messageId: row.waha_message_id || undefined,
  }));
}

export async function syncOutreachConversationHistory(outreachId: string): Promise<ConversationHistoryEntry[]> {
  const supabase = getSupabaseClient();
  const history = await getConversationHistory(outreachId);
  await supabase
    .from('outreach')
    .update({
      conversation_history: history,
      last_message_at: history.at(-1)?.timestamp || new Date().toISOString(),
    })
    .eq('id', outreachId);
  return history;
}
