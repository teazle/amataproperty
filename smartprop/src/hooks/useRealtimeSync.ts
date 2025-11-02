/**
 * Real-time synchronization hooks for Supabase subscriptions
 * Provides easy-to-use hooks for components to subscribe to real-time updates
 */

import { useEffect } from 'react';
import { useGlobalStore } from '@/lib/stores/global-store';

/**
 * Hook to subscribe to real-time listings updates
 * Automatically subscribes on mount and unsubscribes on unmount
 */
export function useRealtimeListings() {
  const { subscribeToListings, unsubscribeFromListings } = useGlobalStore();
  
  useEffect(() => {
    const unsubscribe = subscribeToListings();
    return () => unsubscribe();
  }, [subscribeToListings]);
}

/**
 * Hook to subscribe to real-time agents updates
 * Automatically subscribes on mount and unsubscribes on unmount
 */
export function useRealtimeAgents() {
  const { subscribeToAgents, unsubscribeFromAgents } = useGlobalStore();
  
  useEffect(() => {
    const unsubscribe = subscribeToAgents();
    return () => unsubscribe();
  }, [subscribeToAgents]);
}

/**
 * Hook to subscribe to both listings and agents updates
 * Convenience hook for pages that need both real-time updates
 */
export function useRealtimeData() {
  useRealtimeListings();
  useRealtimeAgents();
}
