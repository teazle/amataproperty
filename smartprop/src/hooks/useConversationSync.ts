/** React hook for authenticated conversation polling. */

import { useConversationStore } from '@/lib/stores/conversation-store';
import { useEffect } from 'react';
import { startConversationPolling } from './conversation-polling';

export function useConversationSync() {
  const { fetchConversations, processIncomingMessage, processOutgoingMessage } = useConversationStore();

  useEffect(() => {
    return startConversationPolling(fetchConversations);
  }, [fetchConversations]);

  return {
    processIncomingMessage,
    processOutgoingMessage,
  };
}

/**
 * Hook for processing WAHA webhook messages
 * This would be called from your webhook endpoint
 */
export function useWAHAWebhookProcessor() {
  const { processIncomingMessage, processOutgoingMessage } = useConversationSync();

  const handleIncomingMessage = async (
    agentPhone: string,
    messageText: string,
    messageId?: string
  ) => {
    await processIncomingMessage(agentPhone, messageText, messageId);
  };

  const handleOutgoingMessage = async (
    agentPhone: string,
    messageText: string
  ) => {
    await processOutgoingMessage(agentPhone, messageText);
  };

  return {
    handleIncomingMessage,
    handleOutgoingMessage,
  };
}
