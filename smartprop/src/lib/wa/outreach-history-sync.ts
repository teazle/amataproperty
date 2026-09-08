export type ConversationHistoryEntry = {
  role: 'user' | 'agent';
  message: string;
  timestamp: string;
  messageId?: string;
};

export type OutreachHistorySyncOptions = {
  status?: string;
};

export type OutreachHistoryUpdate = {
  conversation_history: ConversationHistoryEntry[];
  last_message_at: string;
  status?: string;
};

export type OutreachHistorySyncDependencies = {
  getConversationHistory: (outreachId: string) => Promise<ConversationHistoryEntry[]>;
  updateOutreach: (outreachId: string, update: OutreachHistoryUpdate) => Promise<{
    error: { message: string } | null;
  }>;
};

export function createOutreachHistorySynchronizer(
  dependencies: OutreachHistorySyncDependencies,
): (outreachId: string, options?: OutreachHistorySyncOptions) => Promise<ConversationHistoryEntry[]> {
  return async (outreachId: string, options: OutreachHistorySyncOptions = {}) => {
    const history = await dependencies.getConversationHistory(outreachId);
    const update: OutreachHistoryUpdate = {
      conversation_history: history,
      last_message_at: history.at(-1)?.timestamp || new Date().toISOString(),
      ...(options.status ? { status: options.status } : {}),
    };
    const { error } = await dependencies.updateOutreach(outreachId, update);
    if (error) throw new Error(`Failed to sync outreach conversation history: ${error.message}`);
    return history;
  };
}
