'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getRecentListings } from '../actions';
import { RefreshCw } from 'lucide-react';

interface Listing {
  id: string;
  title?: string;
  address?: string;
  district?: string;
  price?: number;
  beds?: number;
  baths?: number;
  size_sqft?: number;
  posted_at?: string;
  scraped_at?: string;
  agents?: {
    name?: string;
    phone?: string;
  };
}

export function RecentListingsPreview() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Load initial data
    loadListings();
    
    // Set up SSE connection for live updates
    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource(`${window.location.origin}/api/scraper/recent-listings`);

        eventSource.onopen = () => {
          console.log('SSE connection opened for recent listings');
          setIsConnected(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'recent_listings' && data.listings) {
              setListings(data.listings);
            } else if (data.error) {
              console.error('SSE error:', data.error);
            }
          } catch (error) {
            console.error('Error parsing SSE message:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.error('SSE error for recent listings:', error);
          setIsConnected(false);
          
          // Close current connection
          if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
            eventSource.close();
          }
          
          // Reconnect after 3 seconds
          reconnectTimeout = setTimeout(() => {
            console.log('Reconnecting to recent listings SSE...');
            connectSSE();
          }, 3000);
        };

      } catch (error) {
        console.error('Error creating EventSource for recent listings:', error);
      }
    };

    // Start the connection
    connectSSE();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close();
      }
    };
  }, []);

  const loadListings = async () => {
    setIsRefreshing(true);
    try {
      const result = await getRecentListings(5);
      if (result.success) {
        setListings(result.listings);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  if (listings.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Recently Scraped Listings</CardTitle>
            <div className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-xs text-gray-500">
                {isConnected ? 'Live' : 'Disconnected'}
              </span>
            </div>
          </div>
          <Button
            onClick={loadListings}
            disabled={isRefreshing}
            variant="outline"
            size="sm"
            className="ml-4"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {listings.map((listing, _index) => (
            <div
              key={listing.id}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{listing.address || listing.title?.substring(0, 50)}</span>
                  <Badge variant="outline">{listing.district}</Badge>
                </div>
                <div className="text-sm text-gray-700 mt-1">
                  ${listing.price?.toLocaleString()} • {listing.beds || 0}bd/{listing.baths || 0}ba • {listing.size_sqft}sqft
                </div>
                {listing.agents && (
                  <div className="text-xs text-gray-700 mt-1">
                    Agent: {listing.agents.name} • {listing.agents.phone}
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-700">
                {listing.scraped_at ? new Date(listing.scraped_at).toLocaleTimeString() : ''}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

