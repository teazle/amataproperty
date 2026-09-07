import type { CustomerTextTransport } from './customer-transport';

type ManualPersist = (data: Record<string, unknown>) => Promise<{ error: unknown }>;

type ManualOutreachResult = {
  outcome: 'accepted' | 'blocked' | 'rejected' | 'unknown';
  retryable: false;
  messageId: string | null;
  timestamp: string | null;
  reconciliationWarning?: string;
  error?: string;
};

function persistenceErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  return error ? String(error) : undefined;
}

export async function finalizeManualOutreachSend(input: {
  outreachId: string;
  phone: string;
  message: string;
  conversationHistory: Array<Record<string, unknown>>;
  transport: CustomerTextTransport;
  persist: ManualPersist;
}): Promise<ManualOutreachResult> {
  const result = await input.transport.sendText({
    to: input.phone,
    text: input.message,
    purpose: 'manual_outreach',
  });

  if (result.outcome !== 'accepted') {
    let persistenceError: string | undefined;
    try {
      const persisted = await input.persist({
        conversation_phase: 'manual_review',
        conversation_state: 'manual_review',
        co_broking_notes: `Manual outreach provider outcome=${result.outcome}; retryable=false; ${result.error}`,
      });
      persistenceError = persistenceErrorMessage(persisted.error);
    } catch (error) {
      persistenceError = persistenceErrorMessage(error) || 'database persistence failed';
    }
    return {
      outcome: result.outcome,
      retryable: false,
      messageId: null,
      timestamp: null,
      error: persistenceError
        ? `${result.error}; manual-review persistence failed: ${persistenceError}`
        : result.error,
    };
  }

  const timestamp = new Date().toISOString();
  const conversationHistory = [...input.conversationHistory, {
    role: 'user',
    message: input.message,
    timestamp,
    messageId: result.messageId,
  }];
  let reconciliationWarning: string | undefined;
  try {
    const persisted = await input.persist({
      conversation_history: conversationHistory,
      last_message_at: timestamp,
      status: 'sent',
    });
    reconciliationWarning = persistenceErrorMessage(persisted.error);
  } catch (error) {
    reconciliationWarning = persistenceErrorMessage(error) || 'manual outreach persistence failed';
  }

  return {
    outcome: 'accepted',
    retryable: false,
    messageId: result.messageId,
    timestamp,
    ...(reconciliationWarning ? { reconciliationWarning } : {}),
  };
}
