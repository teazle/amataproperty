/**
 * Global Application Store
 * Centralized state management for all app features
 */

import { createClient } from '@supabase/supabase-js';
import { enableMapSet } from 'immer';
import { useMemo } from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// Enable Immer MapSet plugin
enableMapSet();

// ===== LISTINGS STORE =====
interface Listing {
  id: string;
  title: string;
  price?: number;
  district?: string;
  property_type?: string;
  portal: string;
  url: string;
  posted_at?: string;
  scraped_at: string;
  viewing_timeslots?: string;
  viewing_status?: string;
  agents?: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    agency?: string;
  };
}

interface ListingsState {
  listings: Map<string, Listing>;
  isLoading: boolean;
  lastUpdate: string;
  filters: {
    searchTerm: string;
    priceRange: [number, number];
    district: string;
    propertyType: string;
    portal: string;
    viewingStatus: string;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  subscriptions: {
    listings: (() => void) | null;
  };
}

interface ListingsActions {
  setListings: (listings: Listing[]) => void;
  addListing: (listing: Listing) => void;
  updateListing: (id: string, updates: Partial<Listing>) => void;
  setLoading: (loading: boolean) => void;
  setFilters: (filters: Partial<ListingsState['filters']>) => void;
  setPagination: (pagination: Partial<ListingsState['pagination']>) => void;
  getFilteredListings: () => Listing[];
  fetchListings: (page?: number, limit?: number) => Promise<void>;
  refreshListing: (id: string) => Promise<void>;
  subscribeToListings: () => (() => void);
  unsubscribeFromListings: () => void;
}

// ===== AGENTS STORE =====
interface Agent {
  id: string;
  name: string;
  phone: string;
  email?: string;
  agency?: string;
  cea_reg_no?: string;
  source: string;
  last_seen_at: string;
  total_listings?: number;
  active_conversations?: number;
  typically_co_brokes?: boolean;
}

interface AgentsState {
  agents: Map<string, Agent>;
  agentsLoading: boolean;
  agentsLastUpdate: string;
  agentsFilters: {
    searchTerm: string;
    agency: string;
    source: string;
  };
  agentsPagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  agentsSubscriptions: {
    agents: (() => void) | null;
  };
}

interface AgentsActions {
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  setAgentsLoading: (loading: boolean) => void;
  setAgentsFilters: (filters: Partial<AgentsState['agentsFilters']>) => void;
  getFilteredAgents: () => Agent[];
  fetchAgents: () => Promise<void>;
  getAgentStats: () => {
    total: number;
    withListings: number;
    activeConversations: number;
  };
  subscribeToAgents: () => (() => void);
  unsubscribeFromAgents: () => void;
}

// ===== SCRAPER STORE =====
interface ScraperJob {
  id: string;
  type: 'propertyguru' | 'edgeprop';
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  progress: number;
  total_pages: number;
  current_page: number;
  listings_found: number;
  errors: string[];
}

interface ScraperState {
  jobs: Map<string, ScraperJob>;
  isRunning: boolean;
  lastRun: string;
  stats: {
    totalListings: number;
    newListings: number;
    updatedListings: number;
    errors: number;
  };
}

interface ScraperActions {
  addJob: (job: ScraperJob) => void;
  updateJob: (id: string, updates: Partial<ScraperJob>) => void;
  setRunning: (running: boolean) => void;
  updateStats: (stats: Partial<ScraperState['stats']>) => void;
  getActiveJobs: () => ScraperJob[];
  startScraping: (type: 'propertyguru' | 'edgeprop') => Promise<void>;
  stopScraping: (jobId: string) => Promise<void>;
}

// ===== NOTIFICATIONS STORE =====
interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
}

interface NotificationsActions {
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

// ===== COMBINED STORE =====
type GlobalStore = ListingsState & ListingsActions & 
                  AgentsState & AgentsActions & 
                  ScraperState & ScraperActions & 
                  NotificationsState & NotificationsActions;

export const useGlobalStore = create<GlobalStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // ===== LISTINGS =====
      listings: new Map(),
      isLoading: false,
      lastUpdate: new Date().toISOString(),
      subscriptions: {
        listings: null,
      },
      filters: {
        searchTerm: '',
        priceRange: [0, 10000000],
        district: 'all',
        propertyType: 'all',
        portal: 'all',
        viewingStatus: 'all',
      },
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        hasMore: false,
      },

      setListings: (listings) =>
        set((state) => {
          state.listings.clear();
          listings.forEach(listing => {
            state.listings.set(listing.id, listing);
          });
          state.lastUpdate = new Date().toISOString();
        }),

      addListing: (listing) =>
        set((state) => {
          state.listings.set(listing.id, listing);
          state.lastUpdate = new Date().toISOString();
        }),

      updateListing: (id, updates) =>
        set((state) => {
          const listing = state.listings.get(id);
          if (listing) {
            Object.assign(listing, updates);
            state.lastUpdate = new Date().toISOString();
          }
        }),

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setFilters: (filters) =>
        set((state) => {
          Object.assign(state.filters, filters);
        }),

      setPagination: (pagination) =>
        set((state) => {
          Object.assign(state.pagination, pagination);
        }),

      getFilteredListings: () => {
        const { listings, filters } = get();
        return Array.from(listings.values()).filter(listing => {
          // Search filter
          if (filters.searchTerm) {
            const searchLower = filters.searchTerm.toLowerCase();
            const matchesSearch = 
              listing.title?.toLowerCase().includes(searchLower) ||
              listing.district?.toLowerCase().includes(searchLower) ||
              listing.property_type?.toLowerCase().includes(searchLower) ||
              listing.agents?.name?.toLowerCase().includes(searchLower);
            
            if (!matchesSearch) return false;
          }

          // Price filter
          if (listing.price) {
            if (listing.price < filters.priceRange[0] || listing.price > filters.priceRange[1]) {
              return false;
            }
          }

          // District filter
          if (filters.district !== 'all' && listing.district !== filters.district) {
            return false;
          }

          // Property type filter
          if (filters.propertyType !== 'all' && listing.property_type !== filters.propertyType) {
            return false;
          }

          // Portal filter
          if (filters.portal !== 'all' && listing.portal !== filters.portal) {
            return false;
          }

          // Viewing status filter
          if (filters.viewingStatus !== 'all' && listing.viewing_status !== filters.viewingStatus) {
            return false;
          }

          return true;
        });
      },

      fetchListings: async (page = 1, limit?: number) => {
        const actualLimit = limit || 1000; // Default to 1000 for enhanced pages, 50 for others
        set((state) => {
          state.isLoading = true;
        });

        try {
          const response = await fetch(`/api/listings?page=${page}&limit=${actualLimit}`);
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Response is not JSON');
          }
          
          const data = await response.json();
          
          console.log('Store fetchListings:', { 
            page, 
            limit: actualLimit, 
            receivedCount: data.listings?.length || 0,
            total: data.total,
            timestamp: new Date().toISOString(),
            callId: Math.random().toString(36).substr(2, 9)
          });
          
          set((state) => {
            if (page === 1) {
              state.listings.clear();
            }
            if (data.listings && Array.isArray(data.listings)) {
              data.listings.forEach((listing: Listing) => {
                state.listings.set(listing.id, listing);
              });
            }
            state.pagination = {
              page: data.page || page,
              limit: data.limit || 50,
              total: data.total || 0,
              hasMore: data.hasMore || false,
            };
            state.lastUpdate = new Date().toISOString();
          });
        } catch (error) {
          console.error('Error fetching listings:', error);
          // Set empty state on error
          set((state) => {
            state.listings.clear();
            state.pagination = {
              page: 1,
              limit: 50,
              total: 0,
              hasMore: false,
            };
          });
        } finally {
          set((state) => {
            state.isLoading = false;
          });
        }
      },

      refreshListing: async (id) => {
        try {
          const response = await fetch(`/api/listings/${id}`);
          const listing = await response.json();
          
          set((state) => {
            state.listings.set(id, listing);
            state.lastUpdate = new Date().toISOString();
          });
        } catch (error) {
          console.error('Error refreshing listing:', error);
        }
      },

      subscribeToListings: () => {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        
        const channel = supabase
          .channel('listings-realtime')
          .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'listings' },
            (payload) => {
              set((state) => {
                state.listings.set(payload.new.id, payload.new as Listing);
                state.lastUpdate = new Date().toISOString();
              });
              
              // Show notification for new listing
              get().addNotification({
                type: 'success',
                title: 'New Listing',
                message: `New property added: ${payload.new.title}`,
              });
            }
          )
          .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'listings' },
            (payload) => {
              set((state) => {
                state.listings.set(payload.new.id, payload.new as Listing);
              });
            }
          )
          .subscribe();
          
        // Store cleanup function
        const cleanup = () => channel.unsubscribe();
        set((state) => { state.subscriptions.listings = cleanup; });
        
        return cleanup;
      },

      unsubscribeFromListings: () => {
        const cleanup = get().subscriptions.listings;
        if (cleanup) {
          cleanup();
          set((state) => { state.subscriptions.listings = null; });
        }
      },

      // ===== AGENTS =====
      agents: new Map(),
      agentsLoading: false,
      agentsLastUpdate: new Date().toISOString(),
      agentsSubscriptions: {
        agents: null,
      },
      agentsFilters: {
        searchTerm: '',
        agency: 'all',
        source: 'all',
      },
      agentsPagination: {
        page: 1,
        limit: 50,
        total: 0,
        hasMore: false,
      },

      setAgents: (agents) =>
        set((state) => {
          state.agents.clear();
          agents.forEach(agent => {
            state.agents.set(agent.id, agent);
          });
          state.agentsLastUpdate = new Date().toISOString();
        }),

      addAgent: (agent) =>
        set((state) => {
          state.agents.set(agent.id, agent);
          state.agentsLastUpdate = new Date().toISOString();
        }),

      updateAgent: (id, updates) =>
        set((state) => {
          const agent = state.agents.get(id);
          if (agent) {
            Object.assign(agent, updates);
            state.agentsLastUpdate = new Date().toISOString();
          }
        }),

      setAgentsLoading: (loading) =>
        set((state) => {
          state.agentsLoading = loading;
        }),

      setAgentsFilters: (filters) =>
        set((state) => {
          Object.assign(state.agentsFilters, filters);
        }),

      getFilteredAgents: () => {
        const { agents, agentsFilters } = get();
        return Array.from(agents.values()).filter(agent => {
          if (agentsFilters.searchTerm) {
            const searchLower = agentsFilters.searchTerm.toLowerCase();
            const matchesSearch = 
              agent.name.toLowerCase().includes(searchLower) ||
              agent.phone.includes(agentsFilters.searchTerm) ||
              agent.email?.toLowerCase().includes(searchLower) ||
              agent.agency?.toLowerCase().includes(searchLower);
            
            if (!matchesSearch) return false;
          }

          if (agentsFilters.agency !== 'all' && agent.agency !== agentsFilters.agency) {
            return false;
          }

          if (agentsFilters.source !== 'all' && agent.source !== agentsFilters.source) {
            return false;
          }

          return true;
        });
      },

      fetchAgents: async () => {
        set((state) => {
          state.isLoading = true;
        });

        try {
          const response = await fetch('/api/agents');
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Response is not JSON');
          }
          
          const data = await response.json();
          
          set((state) => {
            state.agents.clear();
            if (data.agents && Array.isArray(data.agents)) {
              data.agents.forEach((agent: Agent) => {
                state.agents.set(agent.id, agent);
              });
            }
            state.lastUpdate = new Date().toISOString();
          });
        } catch (error) {
          console.error('Error fetching agents:', error);
          // Set empty state on error
          set((state) => {
            state.agents.clear();
          });
        } finally {
          set((state) => {
            state.isLoading = false;
          });
        }
      },

      getAgentStats: () => {
        const agents = Array.from(get().agents.values());
        return {
          total: agents.length,
          withListings: agents.filter(agent => (agent.total_listings || 0) > 0).length,
          activeConversations: agents.filter(agent => (agent.active_conversations || 0) > 0).length,
        };
      },

      subscribeToAgents: () => {
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        
        const channel = supabase
          .channel('agents-realtime')
          .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'agents' },
            (payload) => {
              set((state) => {
                state.agents.set(payload.new.id, payload.new as Agent);
                state.lastUpdate = new Date().toISOString();
              });
              
              // Show notification for new agent
              get().addNotification({
                type: 'info',
                title: 'New Agent',
                message: `New agent added: ${payload.new.name}`,
              });
            }
          )
          .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'agents' },
            (payload) => {
              set((state) => {
                state.agents.set(payload.new.id, payload.new as Agent);
              });
            }
          )
          .subscribe();
          
        // Store cleanup function
        const cleanup = () => channel.unsubscribe();
        set((state) => { state.agentsSubscriptions.agents = cleanup; });
        
        return cleanup;
      },

      unsubscribeFromAgents: () => {
        const cleanup = get().agentsSubscriptions.agents;
        if (cleanup) {
          cleanup();
          set((state) => { state.agentsSubscriptions.agents = null; });
        }
      },

      // ===== SCRAPER =====
      jobs: new Map(),
      isRunning: false,
      lastRun: '',
      stats: {
        totalListings: 0,
        newListings: 0,
        updatedListings: 0,
        errors: 0,
      },

      addJob: (job) =>
        set((state) => {
          state.jobs.set(job.id, job);
        }),

      updateJob: (id, updates) =>
        set((state) => {
          const job = state.jobs.get(id);
          if (job) {
            Object.assign(job, updates);
          }
        }),

      setRunning: (running) =>
        set((state) => {
          state.isRunning = running;
        }),

      updateStats: (stats) =>
        set((state) => {
          Object.assign(state.stats, stats);
        }),

      getActiveJobs: () => {
        return Array.from(get().jobs.values()).filter(job => 
          job.status === 'running' || job.status === 'pending'
        );
      },

      startScraping: async (type) => {
        set((state) => {
          state.isRunning = true;
        });

        try {
          const response = await fetch('/api/scraper/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
          });
          
          const { jobId } = await response.json();
          
          set((state) => {
            state.jobs.set(jobId, {
              id: jobId,
              type,
              status: 'running',
              started_at: new Date().toISOString(),
              progress: 0,
              total_pages: 0,
              current_page: 0,
              listings_found: 0,
              errors: [],
            });
            state.lastRun = new Date().toISOString();
          });
        } catch (error) {
          console.error('Error starting scraper:', error);
        } finally {
          set((state) => {
            state.isRunning = false;
          });
        }
      },

      stopScraping: async (jobId) => {
        try {
          await fetch(`/api/scraper/stop/${jobId}`, { method: 'POST' });
          
          set((state) => {
            const job = state.jobs.get(jobId);
            if (job) {
              job.status = 'completed';
              job.completed_at = new Date().toISOString();
            }
          });
        } catch (error) {
          console.error('Error stopping scraper:', error);
        }
      },

      // ===== NOTIFICATIONS =====
      notifications: [],
      unreadCount: 0,

      addNotification: (notification) => {
        const id = Math.random().toString(36).substr(2, 9);
        const newNotification: Notification = {
          ...notification,
          id,
          timestamp: new Date().toISOString(),
          read: false,
        };

        set((state) => {
          state.notifications.unshift(newNotification);
          state.unreadCount += 1;
        });
      },

      markAsRead: (id) =>
        set((state) => {
          const notification = state.notifications.find(n => n.id === id);
          if (notification && !notification.read) {
            notification.read = true;
            state.unreadCount -= 1;
          }
        }),

      markAllAsRead: () =>
        set((state) => {
          state.notifications.forEach(notification => {
            notification.read = true;
          });
          state.unreadCount = 0;
        }),

      removeNotification: (id) =>
        set((state) => {
          const index = state.notifications.findIndex(n => n.id === id);
          if (index !== -1) {
            const notification = state.notifications[index];
            if (!notification.read) {
              state.unreadCount -= 1;
            }
            state.notifications.splice(index, 1);
          }
        }),

      clearAll: () =>
        set((state) => {
          state.notifications = [];
          state.unreadCount = 0;
        }),
    }))
  )
);

// Helper functions for filtering
const _filterListings = (listings: Listing[], filters: ListingsState['filters']) => {
  return listings.filter(listing => {
    // Search filter
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      const title = listing.title?.toLowerCase() || '';
      const district = listing.district?.toLowerCase() || '';
      if (!title.includes(searchLower) && !district.includes(searchLower)) {
        return false;
      }
    }
    
    // Portal filter
    if (filters.portal !== 'all' && listing.portal !== filters.portal) {
      return false;
    }
    
    // District filter
    if (filters.district !== 'all' && listing.district !== filters.district) {
      return false;
    }
    
    // Property type filter
    if (filters.propertyType !== 'all' && listing.property_type !== filters.propertyType) {
      return false;
    }
    
    // Price range filter
    if (listing.price && (listing.price < filters.priceRange[0] || listing.price > filters.priceRange[1])) {
      return false;
    }
    
    // Viewing status filter
    if (filters.viewingStatus !== 'all' && listing.viewing_status !== filters.viewingStatus) {
      return false;
    }
    
    return true;
  });
};

const filterAgents = (agents: Agent[], filters: AgentsState['agentsFilters']) => {
  return agents.filter(agent => {
    // Search filter
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      const name = agent.name?.toLowerCase() || '';
      const agency = agent.agency?.toLowerCase() || '';
      if (!name.includes(searchLower) && !agency.includes(searchLower)) {
        return false;
      }
    }
    
    // Agency filter
    if (filters.agency !== 'all' && agent.agency !== filters.agency) {
      return false;
    }
    
    // Source filter
    if (filters.source !== 'all' && agent.source !== filters.source) {
      return false;
    }
    
    return true;
  });
};

const calculateAgentStats = (agents: Agent[]) => {
  return {
    total: agents.length,
    withListings: agents.filter(agent => (agent.total_listings || 0) > 0).length,
    activeConversations: agents.filter(agent => (agent.active_conversations || 0) > 0).length,
    coBrokingWilling: agents.filter(agent => agent.typically_co_brokes === true).length,
    coBrokingNotWilling: agents.filter(agent => agent.typically_co_brokes === false).length,
  };
};

// Removed unused selector functions to clean up ESLint warnings
// selectFilteredAgents, selectAgentStats, selectActiveJobs were not being used

// ===== SELECTORS FOR OPTIMIZED RE-RENDERS =====
export const useListingsSelectors = {
  useListings: () => useGlobalStore(state => state.listings),
  useFilteredListings: () => useGlobalStore(state => Array.from(state.listings.values())),
  useListing: (id: string) => useGlobalStore(state => state.listings.get(id)),
  useLoading: () => useGlobalStore(state => state.isLoading),
  useFilters: () => useGlobalStore(state => state.filters),
  usePagination: () => useGlobalStore(state => state.pagination),
};

export const useAgentsSelectors = {
  useAgents: () => useGlobalStore(state => state.agents),
  useFilteredAgents: () => {
    const agents = useGlobalStore(state => state.agents);
    const filters = useGlobalStore(state => state.agentsFilters);
    
    return useMemo(() => 
      filterAgents(Array.from(agents.values()), filters),
      [agents, filters]
    );
  },
  useAgent: (id: string) => useGlobalStore(state => state.agents.get(id)),
  useLoading: () => useGlobalStore(state => state.agentsLoading),
  useFilters: () => useGlobalStore(state => state.agentsFilters),
  usePagination: () => useGlobalStore(state => state.agentsPagination),
  useStats: () => {
    const agents = useGlobalStore(state => state.agents);
    
    return useMemo(() => 
      calculateAgentStats(Array.from(agents.values())),
      [agents]
    );
  },
};

const getActiveJobs = (jobs: Map<string, ScraperJob>) => {
  return Array.from(jobs.values()).filter(job => job.status === 'running');
};

export const useScraperSelectors = {
  useJobs: () => useGlobalStore(state => state.jobs),
  useActiveJobs: () => {
    const jobs = useGlobalStore(state => state.jobs);
    return useMemo(() => 
      getActiveJobs(jobs),
      [jobs]
    );
  },
  useIsRunning: () => useGlobalStore(state => state.isRunning),
  useStats: () => useGlobalStore(state => state.stats),
};

export const useNotificationsSelectors = {
  useNotifications: () => useGlobalStore(state => state.notifications),
  useUnreadCount: () => useGlobalStore(state => state.unreadCount),
};
