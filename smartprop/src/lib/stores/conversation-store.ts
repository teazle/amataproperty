/**
 * Zustand Store for Real-Time Co-Broking Conversation State Management
 * Handles WAHA message processing, AI analysis, and frontend updates
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { useMemo } from 'react';

// Types
export interface ConversationMessage {
  role: 'user' | 'agent';
  message: string;
  timestamp: string;
  messageId?: string;
}

export interface CoBrokingStatus {
  status: 'unknown' | 'willing' | 'not_willing' | 'needs_discussion';
  confirmed: boolean;
  notes?: string;
  confirmedAt?: string;
}

export interface ConversationPhase {
  phase: 'initial' | 'agent_engaging' | 'timeslots_received' | 'co_broking_discussion' | 'completed' | 'gracefully_ended' | 'property_unavailable';
  objectives: {
    timeslotsReceived: boolean;
    timeslotsText?: string;
    coBrokingConfirmed: boolean;
  };
}

export interface ConversationFilters {
  status: string;
  phase: string;
  coBrokingStatus: string;
  searchTerm: string;
}

export interface OutreachConversation {
  id: string;
  agentId: string;
  listingId: string;
  agentName: string;
  agentPhone: string;
  propertyTitle: string;
  conversationHistory: ConversationMessage[];
  phase: ConversationPhase;
  coBrokingStatus: CoBrokingStatus;
  lastMessageAt: string;
  autoReplyCount: number;
  deflectionCount: number;
  daysElapsed: number;
  status: 'queued' | 'sent' | 'delivered' | 'replied' | 'failed' | 'opted_out' | 'signed';
}

// Store State
interface ConversationStoreState {
  conversations: Map<string, OutreachConversation>;
  activeConversations: Set<string>;
  isLoading: boolean;
  lastUpdate: string;
  filters: {
    status: string;
    phase: string;
    coBrokingStatus: string;
    searchTerm: string;
  };
}

// Store Actions
interface ConversationStoreActions {
  // Conversation Management
  addConversation: (conversation: OutreachConversation) => void;
  updateConversation: (id: string, updates: Partial<OutreachConversation>) => void;
  addMessage: (conversationId: string, message: ConversationMessage) => void;
  updateCoBrokingStatus: (conversationId: string, status: CoBrokingStatus) => void;
  updatePhase: (conversationId: string, phase: ConversationPhase) => void;
  
  // AI Processing
  processIncomingMessage: (agentPhone: string, messageText: string, messageId?: string) => Promise<void>;
  processOutgoingMessage: (agentPhone: string, messageText: string) => Promise<void>;
  
  // UI State
  setLoading: (loading: boolean) => void;
  setFilters: (filters: Partial<ConversationStoreState['filters']>) => void;
  markAsActive: (conversationId: string) => void;
  markAsInactive: (conversationId: string) => void;
  
  // Data Fetching
  fetchConversations: () => Promise<void>;
  refreshConversation: (conversationId: string) => Promise<void>;
  
  // Utilities
  getConversationByAgentPhone: (phone: string) => OutreachConversation | undefined;
  getFilteredConversations: () => OutreachConversation[];
  getConversationStats: () => {
    total: number;
    active: number;
    completed: number;
    coBrokingWilling: number;
    coBrokingNotWilling: number;
  };
}

type ConversationStore = ConversationStoreState & ConversationStoreActions;

// Create the store with Immer for easy state updates
export const useConversationStore = create<ConversationStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Initial State
      conversations: new Map(),
      activeConversations: new Set(),
      isLoading: false,
      lastUpdate: new Date().toISOString(),
      filters: {
        status: 'all',
        phase: 'all',
        coBrokingStatus: 'all',
        searchTerm: '',
      },

      // Actions
      addConversation: (conversation) =>
        set((state) => {
          state.conversations.set(conversation.id, conversation);
          state.lastUpdate = new Date().toISOString();
        }),

      updateConversation: (id, updates) =>
        set((state) => {
          const conversation = state.conversations.get(id);
          if (conversation) {
            Object.assign(conversation, updates);
            state.lastUpdate = new Date().toISOString();
          }
        }),

      addMessage: (conversationId, message) =>
        set((state) => {
          const conversation = state.conversations.get(conversationId);
          if (conversation) {
            conversation.conversationHistory.push(message);
            conversation.lastMessageAt = message.timestamp;
            state.lastUpdate = new Date().toISOString();
          }
        }),

      updateCoBrokingStatus: (conversationId, status) =>
        set((state) => {
          const conversation = state.conversations.get(conversationId);
          if (conversation) {
            conversation.coBrokingStatus = status;
            conversation.phase.objectives.coBrokingConfirmed = status.confirmed;
            state.lastUpdate = new Date().toISOString();
          }
        }),

      updatePhase: (conversationId, phase) =>
        set((state) => {
          const conversation = state.conversations.get(conversationId);
          if (conversation) {
            conversation.phase = phase;
            state.lastUpdate = new Date().toISOString();
          }
        }),

      processIncomingMessage: async (agentPhone, messageText, messageId) => {
        set((state) => {
          state.isLoading = true;
        });

        try {
          // Find conversation by agent phone
          const conversation = get().getConversationByAgentPhone(agentPhone);
          
          if (!conversation) {
            console.warn(`No conversation found for agent phone: ${agentPhone}`);
            return;
          }

          // Add message to conversation
          const message: ConversationMessage = {
            role: 'agent',
            message: messageText,
            timestamp: new Date().toISOString(),
            messageId,
          };

          get().addMessage(conversation.id, message);

          // Process with AI (this would call your existing AI logic)
          // await processMessageWithAI(conversation.id, message);

        } catch (error: unknown) {
          console.error('Error processing incoming message:', error);
        } finally {
          set((state) => {
            state.isLoading = false;
          });
        }
      },

      processOutgoingMessage: async (agentPhone, messageText) => {
        try {
          const conversation = get().getConversationByAgentPhone(agentPhone);
          
          if (!conversation) {
            console.warn(`No conversation found for agent phone: ${agentPhone}`);
            return;
          }

          const message: ConversationMessage = {
            role: 'user',
            message: messageText,
            timestamp: new Date().toISOString(),
          };

          get().addMessage(conversation.id, message);

        } catch (error: unknown) {
          console.error('Error processing outgoing message:', error);
        }
      },

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setFilters: (filters) =>
        set((state) => {
          Object.assign(state.filters, filters);
        }),

      markAsActive: (conversationId) =>
        set((state) => {
          state.activeConversations.add(conversationId);
        }),

      markAsInactive: (conversationId) =>
        set((state) => {
          state.activeConversations.delete(conversationId);
        }),

      fetchConversations: async () => {
        set((state) => {
          state.isLoading = true;
        });

        try {
          // This would fetch from your API
          const response = await fetch('/api/conversations');
          const data = await response.json();
          
          set((state) => {
            state.conversations.clear();
            data.conversations.forEach((conv: OutreachConversation) => {
              state.conversations.set(conv.id, conv);
            });
            state.lastUpdate = new Date().toISOString();
          });
        } catch (error: unknown) {
          console.error('Error fetching conversations:', error);
        } finally {
          set((state) => {
            state.isLoading = false;
          });
        }
      },

      refreshConversation: async (conversationId) => {
        try {
          const response = await fetch(`/api/conversations/${conversationId}`);
          const conversation = await response.json();
          
          set((state) => {
            state.conversations.set(conversationId, conversation);
            state.lastUpdate = new Date().toISOString();
          });
        } catch (error: unknown) {
          console.error('Error refreshing conversation:', error);
        }
      },

      getConversationByAgentPhone: (phone) => {
        const conversations = Array.from(get().conversations.values());
        return conversations.find(conv => 
          conv.agentPhone === phone || 
          conv.agentPhone === `65${phone}` ||
          conv.agentPhone === phone.replace('65', '')
        );
      },

      getFilteredConversations: () => {
        const { conversations, filters } = get();
        const conversationList = Array.from(conversations.values());

        return conversationList.filter(conv => {
          // Status filter
          if (filters.status !== 'all' && conv.status !== filters.status) {
            return false;
          }

          // Phase filter
          if (filters.phase !== 'all' && conv.phase.phase !== filters.phase) {
            return false;
          }

          // Co-broking status filter
          if (filters.coBrokingStatus !== 'all' && conv.coBrokingStatus.status !== filters.coBrokingStatus) {
            return false;
          }

          // Search filter
          if (filters.searchTerm) {
            const searchLower = filters.searchTerm.toLowerCase();
            const matchesSearch = 
              conv.agentName.toLowerCase().includes(searchLower) ||
              conv.agentPhone.includes(filters.searchTerm) ||
              conv.propertyTitle.toLowerCase().includes(searchLower) ||
              conv.conversationHistory.some(msg => 
                msg.message.toLowerCase().includes(searchLower)
              );
            
            if (!matchesSearch) return false;
          }

          return true;
        });
      },

      getConversationStats: () => {
        const conversations = Array.from(get().conversations.values());
        
        return {
          total: conversations.length,
          active: conversations.filter(conv => 
            conv.status === 'replied' || conv.status === 'sent'
          ).length,
          completed: conversations.filter(conv => 
            conv.phase.phase === 'completed'
          ).length,
          coBrokingWilling: conversations.filter(conv => 
            conv.coBrokingStatus.status === 'willing'
          ).length,
          coBrokingNotWilling: conversations.filter(conv => 
            conv.coBrokingStatus.status === 'not_willing'
          ).length,
        };
      },
    }))
  )
);

// Helper function for filtering conversations
const filterConversations = (conversations: OutreachConversation[], filters: ConversationFilters) => {
  return conversations.filter(conversation => {
    // Search filter
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      const agentName = conversation.agentName?.toLowerCase() || '';
      const listingTitle = conversation.propertyTitle?.toLowerCase() || '';
      if (!agentName.includes(searchLower) && !listingTitle.includes(searchLower)) {
        return false;
      }
    }
    
    // Status filter
    if (filters.status !== 'all' && conversation.status !== filters.status) {
      return false;
    }
    
    // Phase filter
    if (filters.phase !== 'all' && conversation.phase.phase !== filters.phase) {
      return false;
    }
    
    // Co-broking status filter
    if (filters.coBrokingStatus !== 'all' && conversation.coBrokingStatus?.status !== filters.coBrokingStatus) {
      return false;
    }
    
    return true;
  });
};

// Helper function for calculating stats
const calculateStats = (conversations: OutreachConversation[]) => {
  return {
    total: conversations.length,
    active: conversations.filter(c => c.status === 'replied').length,
    completed: conversations.filter(c => c.status === 'signed').length,
    coBrokingWilling: conversations.filter(c => c.coBrokingStatus?.status === 'willing').length,
    coBrokingNotWilling: conversations.filter(c => c.coBrokingStatus?.status === 'not_willing').length,
  };
};

// Selectors for optimized re-renders
export const useConversationSelectors = {
  // Get all conversations
  useConversations: () => useConversationStore(state => state.conversations),
  
  // Get filtered conversations - using useMemo to prevent infinite loops
  useFilteredConversations: () => {
    const conversations = useConversationStore(state => state.conversations);
    const filters = useConversationStore(state => state.filters);
    
    return useMemo(() => 
      filterConversations(Array.from(conversations.values()), filters),
      [conversations, filters]
    );
  },
  
  // Get specific conversation
  useConversation: (id: string) => useConversationStore(state => state.conversations.get(id)),
  
  // Get conversation by agent phone
  useConversationByPhone: (phone: string) => {
    const conversations = useConversationStore(state => state.conversations);
    
    return useMemo(() => 
      Array.from(conversations.values()).find(conversation => 
        conversation.agentPhone === phone
      ),
      [conversations, phone]
    );
  },
  
  // Get stats - using useMemo to prevent infinite loops
  useStats: () => {
    const conversations = useConversationStore(state => state.conversations);
    
    return useMemo(() => 
      calculateStats(Array.from(conversations.values())),
      [conversations]
    );
  },
  
  // Get loading state
  useLoading: () => useConversationStore(state => state.isLoading),
  
  // Get filters
  useFilters: () => useConversationStore(state => state.filters),
};

// Real-time subscription for external updates
export const subscribeToConversationUpdates = (callback: (conversations: Map<string, OutreachConversation>) => void) => {
  return useConversationStore.subscribe(
    (state) => state.conversations,
    callback,
    {
      equalityFn: (a, b) => a === b, // Only trigger when conversations map reference changes
    }
  );
};

// Subscribe to specific conversation changes
export const subscribeToConversation = (conversationId: string, callback: (conversation: OutreachConversation | undefined) => void) => {
  return useConversationStore.subscribe(
    (state) => state.conversations.get(conversationId),
    callback
  );
};
