/**
 * React Hook for Real-Time Conversation Synchronization
 * Syncs WAHA webhook updates with Zustand store
 */

import { useEffect, useRef } from 'react';
import { useConversationStore, subscribeToConversationUpdates } from '@/lib/stores/conversation-store';
import { supabaseClient as supabase } from '@/lib/supabase-client';

export function useConversationSync() {
  const { fetchConversations, processIncomingMessage, processOutgoingMessage } = useConversationStore();
  const isSubscribed = useRef(false);

  useEffect(() => {
    // Initial fetch
    fetchConversations();

    // Set up real-time subscription to outreach table
    if (!isSubscribed.current) {
      const channel = supabase
        .channel('outreach_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'outreach',
          },
          async (payload) => {
            console.log('🔄 Real-time outreach update:', payload);
            
            // Handle different event types
            switch (payload.eventType) {
              case 'INSERT':
              case 'UPDATE':
                // Refresh the specific conversation
                const conversationId = payload.new.id;
                await useConversationStore.getState().refreshConversation(conversationId);
                break;
              
              case 'DELETE':
                // Remove from store
                useConversationStore.setState((state) => {
                  state.conversations.delete(payload.old.id);
                });
                break;
            }
          }
        )
        .subscribe();

      isSubscribed.current = true;

      return () => {
        supabase.removeChannel(channel);
        isSubscribed.current = false;
      };
    }
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
