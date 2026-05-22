import Groq from 'groq-sdk';
import { parseViewingTimeslotsWithAI, formatParsedTimeslots, type ParsedViewingSlots } from '@/lib/ai/groq';
import { sendMessageWithTyping } from '@/lib/wa/waha';
import {
  findLatestOutreachByPhone,
  getConversationHistory,
  logWhatsAppMessage,
  normalizeWhatsAppPhone,
  syncOutreachConversationHistory,
  type ConversationHistoryEntry,
  type OutreachWithContext,
} from '@/lib/wa/message-log';
import { getSupabaseClient } from '@/workers/supa';
import { cleanQuotes } from './quote-cleaner';

export type WhatsAppConversationPhase =
  | 'initial_contact'
  | 'awaiting_cobroking'
  | 'awaiting_timeslots'
  | 'timeslots_received'
  | 'completed'
  | 'gracefully_ended'
  | 'manual_review';

export type WhatsAppDecision = {
  shouldSend: boolean;
  replyMessage?: string;
  nextPhase: WhatsAppConversationPhase;
  conversationState: string;
  coBrokingStatus: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion';
  timeslotsReceived: boolean;
  timeslotsText?: string;
  status?: string;
  reason: string;
};

export type WhatsAppInboundInput = {
  from: string;
  to?: string;
  body: string;
  messageId?: string | null;
  timestamp?: string | number | null;
  rawPayload?: unknown;
};

let groq: Groq | null = null;

function getGroqClient(): Groq {
  if (!groq) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

function normalizePhase(value: string | null | undefined): WhatsAppConversationPhase {
  switch (value) {
    case 'initial_contact':
    case 'awaiting_cobroking':
    case 'awaiting_timeslots':
    case 'timeslots_received':
    case 'completed':
    case 'gracefully_ended':
    case 'manual_review':
      return value;
    case 'agent_engaging':
    case 'agent_checking':
    case 'agent_stalling':
      return 'awaiting_timeslots';
    case 'property_unavailable':
      return 'gracefully_ended';
    case 'initial_request':
    default:
      return 'awaiting_cobroking';
  }
}

function textIncludesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function compact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAsked(history: ConversationHistoryEntry[], topic: 'cobroking' | 'timeslots'): boolean {
  return history.some(entry => {
    if (entry.role !== 'user') return false;
    const text = compact(entry.message);
    if (topic === 'cobroking') {
      return /co[-\s]?brok\w*|open to work together/.test(text);
    }
    return /availability|viewing|timeslot|time slot|what time|when would work/.test(text);
  });
}

function isAcknowledgment(text: string): boolean {
  return /^(ok|okay|sure|noted|thanks|thank you|thx|alright|got it|ok thanks|ok thank you)[.! ]*$/i.test(text.trim());
}

function isDirectQuestion(text: string): boolean {
  return text.includes('?') || /^(what|when|where|who|how|can|could|are|is|do|does|did)\b/i.test(text.trim());
}

function detectSignals(message: string, history: ConversationHistoryEntry[]) {
  const text = compact(message);
  const previousBuyerText = history
    .filter(entry => entry.role === 'user')
    .slice(-3)
    .map(entry => compact(entry.message))
    .join(' ');
  const coBrokingWasAsked = /co[-\s]?brok\w*/.test(previousBuyerText);

  const notWilling = textIncludesAny(text, [
    /\b(no|cannot|can't|dont|don't|won't|not)\b.{0,18}\b(co[-\s]?brok\w*)/,
    /\bprincipal only\b/,
    /\bexclusive\b/,
    /\bnot open\b.{0,18}\b(co[-\s]?brok\w*)\b/,
  ]);

  const asksSensitive = textIncludesAny(text, [
    /\bbuyer profile\b/,
    /\bbuyer details\b/,
    /\bprofile first\b/,
    /\bcommission\b/,
    /\bsplit\b/,
    /\bfinancial\b/,
    /\bproof of funds\b/,
  ]);

  const botQuestion = /\b(bot|ai|automated|robot)\b/i.test(message) && isDirectQuestion(message);

  const timeslotRequested = textIncludesAny(text, [
    /\bwhat (time|timeslot|slot|availability)\b/,
    /\bwhen (can|are|would|is|works|work)\b/,
    /\byour availability\b/,
    /\bwhat works\b/,
  ]);

  const timeslotProvided = textIncludesAny(text, [
    /\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\b.*\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
    /\b\d{1,2}(:\d{2})?\s*(am|pm)\b.*\b(to|-|until)\b.*\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
    /\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\b.*\b(morning|afternoon|evening)\b/i,
    /\b(morning|afternoon|evening|weekend|weekday|today|tomorrow)\b.*\b(can|available|free|works|ok)\b/i,
    /\b(can|available|free|works|ok)\b.*\b(morning|afternoon|evening|weekend|weekday|today|tomorrow)\b/i,
  ]);

  const willing = !notWilling && (
    (/^(yes|yup|sure|ok|okay|can)\b[.! ]*$/.test(text) || /^ok can\b/.test(text) || /\b(no problem|of course)\b/.test(text)) && coBrokingWasAsked ||
    /\b(can|open|willing).{0,18}\b(co[-\s]?brok\w*)\b/.test(text) ||
    timeslotRequested ||
    timeslotProvided
  );

  const needsDiscussion = !notWilling && !willing && textIncludesAny(text, [
    /\bmaybe\b/,
    /\bdepends\b/,
    /\blet'?s discuss\b/,
    /\bcan discuss\b/,
    /\bneed to check\b/,
    /\bcheck first\b/,
    /\bcheck and revert\b/,
    /\bprofile first\b/,
  ]);

  return {
    notWilling,
    willing,
    needsDiscussion,
    asksSensitive,
    botQuestion,
    timeslotRequested,
    timeslotProvided,
    acknowledgment: isAcknowledgment(message),
    directQuestion: isDirectQuestion(message),
  };
}

function baseReplyForDecision(args: {
  firstName: string;
  propertyTitle: string;
  signals: ReturnType<typeof detectSignals>;
  currentPhase: WhatsAppConversationPhase;
  coBrokingStatus: WhatsAppDecision['coBrokingStatus'];
  timeslotsText?: string;
  askedCobroking: boolean;
  askedTimeslots: boolean;
}): Omit<WhatsAppDecision, 'replyMessage'> & { draft: string } {
  const { firstName, propertyTitle, signals, currentPhase, coBrokingStatus, timeslotsText, askedCobroking, askedTimeslots } = args;

  if ((currentPhase === 'completed' || currentPhase === 'gracefully_ended') && signals.acknowledgment) {
    return {
      shouldSend: false,
      nextPhase: currentPhase,
      conversationState: currentPhase,
      coBrokingStatus,
      timeslotsReceived: currentPhase === 'completed',
      status: currentPhase === 'completed' ? 'replied' : undefined,
      reason: 'Conversation already closed and agent only acknowledged',
      draft: '',
    };
  }

  if (signals.notWilling) {
    return {
      shouldSend: true,
      nextPhase: 'gracefully_ended',
      conversationState: 'gracefully_ended',
      coBrokingStatus: 'not_willing',
      timeslotsReceived: false,
      status: 'opted_out',
      reason: 'Agent is not willing to co-broke',
      draft: `Understood ${firstName}. Thanks for letting me know. I will not proceed further on this one.`,
    };
  }

  if (signals.timeslotProvided) {
    return {
      shouldSend: true,
      nextPhase: 'completed',
      conversationState: 'completed',
      coBrokingStatus: coBrokingStatus === 'not_willing' ? 'not_willing' : 'willing',
      timeslotsReceived: true,
      timeslotsText,
      status: 'replied',
      reason: 'Timeslots received and co-broking is accepted or implied',
      draft: `Thanks ${firstName}. I will coordinate with my buyer around ${timeslotsText || 'those viewing slots'} and get back to you shortly.`,
    };
  }

  if (signals.botQuestion) {
    const next = coBrokingStatus === 'willing' ? 'awaiting_timeslots' : 'awaiting_cobroking';
    return {
      shouldSend: true,
      nextPhase: next,
      conversationState: next,
      coBrokingStatus,
      timeslotsReceived: false,
      status: 'replied',
      reason: 'Agent asked whether this is automated',
      draft: `No, this is Jeremy. I am helping a buyer who is interested in ${propertyTitle}. ${coBrokingStatus === 'willing' ? 'May I check what viewing times you have this week?' : 'Are you open to co-broking on this?'}`,
    };
  }

  if (signals.asksSensitive) {
    const next = coBrokingStatus === 'willing' ? 'awaiting_timeslots' : 'awaiting_cobroking';
    const nextQuestion = coBrokingStatus === 'willing'
      ? 'Could you share what viewing times you have this week?'
      : askedCobroking
        ? 'If you are open to co-broking, we can arrange a viewing first and discuss the details properly there.'
        : 'Are you open to co-broking on this property?';
    return {
      shouldSend: true,
      nextPhase: next,
      conversationState: next,
      coBrokingStatus: coBrokingStatus === 'unknown' ? 'needs_discussion' : coBrokingStatus,
      timeslotsReceived: false,
      status: 'replied',
      reason: 'Sensitive business question should be deferred',
      draft: `I can share more context when we meet. ${nextQuestion}`,
    };
  }

  if (signals.acknowledgment && !signals.willing && (currentPhase === 'awaiting_timeslots' || coBrokingStatus === 'willing')) {
    return {
      shouldSend: false,
      nextPhase: 'awaiting_timeslots',
      conversationState: 'awaiting_timeslots',
      coBrokingStatus,
      timeslotsReceived: false,
      status: 'replied',
      reason: 'Agent acknowledged but has not provided timeslots',
      draft: '',
    };
  }

  if (signals.willing || coBrokingStatus === 'willing') {
    if (signals.timeslotRequested) {
      return {
        shouldSend: true,
        nextPhase: 'awaiting_timeslots',
        conversationState: 'awaiting_timeslots',
        coBrokingStatus: 'willing',
        timeslotsReceived: false,
        status: 'replied',
        reason: 'Agent asked for buyer-side availability',
        draft: `My buyer is generally easier Monday to Friday, 6pm to 10pm. What timing works best on your side this week?`,
      };
    }

    return {
      shouldSend: true,
      nextPhase: 'awaiting_timeslots',
      conversationState: 'awaiting_timeslots',
      coBrokingStatus: 'willing',
      timeslotsReceived: false,
      status: 'replied',
      reason: 'Co-broking accepted; ask for viewing times',
      draft: askedTimeslots
        ? `Thanks ${firstName}. Just let me know what viewing slots you have this week and I will coordinate with my buyer.`
        : `Thanks ${firstName}. Could you share what viewing slots you have this week?`,
    };
  }

  if (signals.needsDiscussion) {
    return {
      shouldSend: true,
      nextPhase: 'awaiting_cobroking',
      conversationState: 'awaiting_cobroking',
      coBrokingStatus: 'needs_discussion',
      timeslotsReceived: false,
      status: 'replied',
      reason: 'Agent needs discussion before confirming co-broking',
      draft: `No issue ${firstName}. We can discuss the details properly at the viewing. Are you open to co-broking if the buyer is suitable?`,
    };
  }

  return {
    shouldSend: true,
    nextPhase: 'awaiting_cobroking',
    conversationState: 'awaiting_cobroking',
    coBrokingStatus,
    timeslotsReceived: false,
    status: 'replied',
    reason: 'Need co-broking confirmation',
    draft: askedCobroking
      ? `May I check if you are open to co-broking on ${propertyTitle}?`
      : `Hi ${firstName}, may I check if you are open to co-broking on ${propertyTitle}?`,
  };
}

async function warmWithGroq(args: {
  draft: string;
  agentName: string;
  propertyTitle: string;
  latestMessage: string;
  history: ConversationHistoryEntry[];
  reason: string;
}): Promise<string> {
  if (!process.env.GROQ_API_KEY || !args.draft.trim()) {
    return args.draft;
  }

  try {
    const recent = args.history
      .slice(-8)
      .map(entry => `${entry.role === 'user' ? 'Jeremy' : 'Agent'}: ${entry.message}`)
      .join('\n');

    const completion = await getGroqClient().chat.completions.create({
      model: process.env.WHATSAPP_GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.45,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: `Rewrite the draft as Jeremy, a Singapore buyer agent.
Keep the same business intent. Do not add facts. Do not answer commission, buyer finances, or sensitive buyer details.
Style: warm, short, natural, human, professional. No salesy wording. No exclamation marks. No repeated greeting if the chat already started.
Return only the final WhatsApp message text.`,
        },
        {
          role: 'user',
          content: `Agent: ${args.agentName}
Property: ${args.propertyTitle}
Latest agent message: ${args.latestMessage}
Reason: ${args.reason}
Recent conversation:
${recent || '(none)'}

Draft:
${args.draft}`,
        },
      ],
    });

    const text = cleanQuotes(completion.choices[0]?.message?.content?.trim() || '');
    return text || args.draft;
  } catch (error) {
    console.warn('WhatsApp Groq wording failed, using deterministic draft:', error instanceof Error ? error.message : String(error));
    return args.draft;
  }
}

export async function decideWhatsAppReply(input: {
  outreach: OutreachWithContext;
  messageText: string;
  history: ConversationHistoryEntry[];
  parsedSlots?: ParsedViewingSlots | null;
  useGroq?: boolean;
}): Promise<WhatsAppDecision> {
  const phase = normalizePhase(input.outreach.conversation_phase);
  const agentName = input.outreach.agents?.name || 'there';
  const firstName = agentName.split(/\s+/)[0] || 'there';
  const propertyTitle = input.outreach.listings?.title || 'the property';
  const history = input.history;
  const signals = detectSignals(input.messageText, history);
  const existingCoBroking = input.outreach.co_broking_status || 'unknown';
  const coBrokingStatus = existingCoBroking === 'willing'
    ? 'willing'
    : signals.willing
      ? 'willing'
      : signals.notWilling
        ? 'not_willing'
        : signals.needsDiscussion
          ? 'needs_discussion'
          : existingCoBroking;
  const timeslotsText = input.parsedSlots?.available
    ? formatParsedTimeslots(input.parsedSlots)
    : signals.timeslotProvided
      ? input.messageText
      : undefined;

  const base = baseReplyForDecision({
    firstName,
    propertyTitle,
    signals,
    currentPhase: phase,
    coBrokingStatus,
    timeslotsText,
    askedCobroking: hasAsked(history, 'cobroking'),
    askedTimeslots: hasAsked(history, 'timeslots'),
  });

  const replyMessage = input.useGroq === false
    ? base.draft
    : await warmWithGroq({
        draft: base.draft,
        agentName,
        propertyTitle,
        latestMessage: input.messageText,
        history,
        reason: base.reason,
      });

  return {
    shouldSend: base.shouldSend && Boolean(replyMessage.trim()),
    replyMessage: replyMessage.trim() || undefined,
    nextPhase: base.nextPhase,
    conversationState: base.conversationState,
    coBrokingStatus: base.coBrokingStatus,
    timeslotsReceived: base.timeslotsReceived,
    timeslotsText: base.timeslotsText,
    status: base.status,
    reason: base.reason,
  };
}

export async function processInboundWhatsAppMessage(input: WhatsAppInboundInput): Promise<{
  success: boolean;
  duplicate?: boolean;
  outreachId?: string;
  sent?: boolean;
  decision?: WhatsAppDecision;
  reason?: string;
}> {
  const phone = normalizeWhatsAppPhone(input.from);
  const outreach = await findLatestOutreachByPhone(phone);
  const occurredAt = input.timestamp
    ? new Date(typeof input.timestamp === 'number' ? input.timestamp * 1000 : input.timestamp).toISOString()
    : new Date().toISOString();

  if (!outreach) {
    await logWhatsAppMessage({
      direction: 'inbound',
      phone,
      chatId: input.from,
      wahaMessageId: input.messageId || null,
      body: input.body,
      rawPayload: input.rawPayload,
      occurredAt,
    });
    return { success: true, reason: 'No outreach found for inbound WhatsApp sender' };
  }

  const inboundLog = await logWhatsAppMessage({
    outreachId: outreach.id,
    agentId: outreach.agent_id,
    direction: 'inbound',
    phone,
    chatId: input.from,
    wahaMessageId: input.messageId || null,
    body: input.body,
    rawPayload: input.rawPayload,
    occurredAt,
  });

  if (inboundLog.duplicate) {
    return { success: true, duplicate: true, outreachId: outreach.id, reason: 'Duplicate inbound WAHA message ignored' };
  }

  let history = await getConversationHistory(outreach.id);
  const parsedSlots = await parseViewingTimeslotsWithAI(history.map(entry => `${entry.role}: ${entry.message}`).join('\n')).catch(() => null);
  const decision = await decideWhatsAppReply({
    outreach,
    messageText: input.body,
    history,
    parsedSlots,
  });

  const supabase = getSupabaseClient();
  const updateData: Record<string, unknown> = {
    conversation_phase: decision.nextPhase,
    conversation_state: decision.conversationState,
    last_message_at: new Date().toISOString(),
    status: decision.status || outreach.status || 'replied',
    co_broking_status: decision.coBrokingStatus,
  };

  if (decision.timeslotsReceived && outreach.listing_id) {
    await supabase
      .from('listings')
      .update({
        viewing_timeslots: decision.timeslotsText || input.body,
        viewing_status: 'received',
        ...(parsedSlots?.available ? { viewing_timeslots_structured: parsedSlots } : {}),
      })
      .eq('id', outreach.listing_id);
  }

  if (!decision.shouldSend || !decision.replyMessage) {
    await supabase.from('outreach').update(updateData).eq('id', outreach.id);
    await syncOutreachConversationHistory(outreach.id);
    return { success: true, outreachId: outreach.id, sent: false, decision };
  }

  const typingDelay = Math.min(8000, Math.max(1200, decision.replyMessage.length * 45));
  const sendResult = await sendMessageWithTyping(phone, decision.replyMessage, typingDelay);
  if (!sendResult.success) {
    await supabase
      .from('outreach')
      .update({
        ...updateData,
        conversation_phase: 'manual_review',
        conversation_state: 'manual_review',
        co_broking_notes: `Auto-reply failed: ${sendResult.error || 'unknown error'}`,
      })
      .eq('id', outreach.id);
    await syncOutreachConversationHistory(outreach.id);
    return { success: false, outreachId: outreach.id, sent: false, decision, reason: sendResult.error };
  }

  await logWhatsAppMessage({
    outreachId: outreach.id,
    agentId: outreach.agent_id,
    direction: 'outbound',
    phone,
    chatId: input.from,
    wahaMessageId: sendResult.messageId || null,
    body: decision.replyMessage,
    rawPayload: sendResult,
  });

  history = await syncOutreachConversationHistory(outreach.id);
  await supabase
    .from('outreach')
    .update({
      ...updateData,
      conversation_history: history,
      auto_reply_count: (outreach.auto_reply_count || 0) + 1,
      last_auto_reply_at: new Date().toISOString(),
      reply_text: decision.replyMessage,
      replied_at: new Date().toISOString(),
      first_message_sent_at: outreach.first_message_sent_at || new Date().toISOString(),
    })
    .eq('id', outreach.id);

  return { success: true, outreachId: outreach.id, sent: true, decision };
}
