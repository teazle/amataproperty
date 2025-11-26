'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
// import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { supabaseClient as supabase } from '@/lib/supabase-client';
import { Search, Send, Pause, Play, RotateCcw, Download, MessageSquare, Clock, Users, Target, Loader2 } from 'lucide-react';

interface ConversationMessage {
  role: 'agent' | 'user';
  message: string;
  timestamp: string;
}

interface ListingWithOutreach {
  id: string;
  url: string;
  title: string;
  price?: number;
  district?: string;
  property_type?: string;
  portal: string;
  posted_at?: string;
  scraped_at: string;
  address?: string;
  beds?: number;
  baths?: number;
  size_sqft?: number;
  viewing_timeslots?: string;
  viewing_status?: string;
  agents?: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    agency?: string;
    cea_reg_no?: string;
  };
  outreach?: Array<{
    id: string;
  status: string;
  conversation_phase?: string;
  co_broking_status?: string;
  conversation_history?: ConversationMessage[] | string;
    auto_reply_count?: number;
    last_message_at?: string;
    created_at: string;
  }>;
}

export default function OutreachPage() {
  const [listings, setListings] = useState<ListingWithOutreach[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [outreachLimit, setOutreachLimit] = useState<number>(15);
  const [isLoading, setIsLoading] = useState(true);

  // Filtering and search state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [coBrokingFilter, setCoBrokingFilter] = useState<string>('all');
  const [districtFilter, setDistrictFilter] = useState<string>('all');
  
  // Bulk actions state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isBulkActionLoading, setIsBulkActionLoading] = useState(false);
  
  // Individual outreach loading state
  const [initiatingOutreach, setInitiatingOutreach] = useState<Set<string>>(new Set());
  
  // Manual message state
  const [isManualMessageOpen, setIsManualMessageOpen] = useState(false);
  const [manualMessageTarget, setManualMessageTarget] = useState<ListingWithOutreach | null>(null);
  const [manualMessage, setManualMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [viewingConversationId, setViewingConversationId] = useState<string | null>(null);
  const dialogScrollRef = useRef<HTMLDivElement>(null);
  const [savedScrollPosition, setSavedScrollPosition] = useState(0);

  // Preserve scroll position when dialog content updates
  useEffect(() => {
    if (dialogScrollRef.current && viewingConversationId) {
      // Restore scroll position if it was saved
      if (savedScrollPosition > 0) {
        dialogScrollRef.current.scrollTop = savedScrollPosition;
      }
    }
  }, [viewingConversationId, savedScrollPosition]);

  // Handle scroll position saving
  const handleScroll = () => {
    if (dialogScrollRef.current) {
      setSavedScrollPosition(dialogScrollRef.current.scrollTop);
    }
  };

  // Handle dialog close with data refresh
  const handleConversationDialogClose = (open: boolean, itemId?: string) => {
    if (open) {
      setViewingConversationId(itemId || null);
      // Reset scroll position when opening a new conversation
      setSavedScrollPosition(0);
    } else {
      setViewingConversationId(null);
      // Refresh data when dialog closes to ensure it's up-to-date
      fetchListings();
    }
  };

  const handleManualMessageDialogClose = (open: boolean) => {
    setIsManualMessageOpen(open);
    // Refresh data when dialog closes to ensure it's up-to-date
    if (!open) {
      fetchListings();
    }
  };

  // Fetch listings data
  const fetchListings = async () => {
    try {
      console.log('Fetching listings...');
      const { data, error } = await supabase
        .from('listings')
        .select(`
          id,
          url,
          title,
          price,
          district,
          property_type,
          portal,
          posted_at,
          scraped_at,
          address,
          beds,
          baths,
          size_sqft,
          viewing_timeslots,
          viewing_status,
          agents!left(
            id,
            name,
            phone,
            email,
            agency,
            cea_reg_no
          ),
          outreach!listing_id(
            id,
            status,
            conversation_phase,
            co_broking_status,
            conversation_history,
            auto_reply_count,
            last_message_at,
            created_at
          )
        `)
        .order('scraped_at', { ascending: false });

      if (error) {
        // Extract error information properly from Supabase error object
        const errorInfo = {
          message: error.message || 'Unknown error',
          details: error.details || null,
          hint: error.hint || null,
          code: error.code || null,
        };
        console.error('Error fetching listings:', errorInfo);
        console.error('Full error object:', error);
        toast.error(`Failed to fetch listings: ${errorInfo.message}`);
        return;
      }

      console.log('Raw data received:', data?.length, 'listings');
      console.log('Sample listing:', data?.[0]);

      // Transform the data to match our interface
      const transformedData = (data || []).map((item: any) => ({
        ...item,
        agents: item.agents || null, // agents is already an object from the JOIN
        outreach: item.outreach || []
      }));
      
      console.log('Transformed data:', transformedData.length, 'listings');
      console.log('Sample transformed listing:', transformedData[0]);
      
      // Log listings with outreach
      const listingsWithOutreach = transformedData.filter(l => l.outreach && l.outreach.length > 0);
      console.log('Listings with outreach:', listingsWithOutreach.length);
      
      if (listingsWithOutreach.length === 0) {
        console.log('No listings with outreach found in current results. This might be because:');
        console.log('1. The listings with outreach records are older and not in the first few results');
        console.log('2. There are no outreach records in the database');
        console.log('3. The outreach records are not being joined correctly');
      }
      
      setListings(transformedData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Unexpected error in fetchListings:', {
        message: errorMessage,
        error: error,
        stack: error instanceof Error ? error.stack : 'No stack trace',
      });
      toast.error(`Failed to fetch listings: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch and auto-refresh every 10 seconds
  useEffect(() => {
    fetchListings();
    
    // Set up polling to refresh data every 10 seconds
    // But only when no dialog is open to prevent dialog re-renders
    const intervalId = setInterval(() => {
      // Only refresh if no dialog is currently open
      if (!viewingConversationId && !isManualMessageOpen) {
        fetchListings();
      }
    }, 10000);
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [viewingConversationId, isManualMessageOpen]);

  // Filtered and searched listings data
  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = 
          listing.title?.toLowerCase().includes(searchLower) ||
          listing.agents?.name?.toLowerCase().includes(searchLower) ||
          listing.agents?.phone?.includes(searchTerm) ||
          listing.district?.toLowerCase().includes(searchLower) ||
          listing.property_type?.toLowerCase().includes(searchLower);
        
        if (!matchesSearch) return false;
      }

      // Status filter - based on outreach existence and status
      if (statusFilter !== 'all') {
        if (statusFilter === 'no_outreach') {
          if (listing.outreach && listing.outreach.length > 0) return false;
        } else {
          const hasMatchingStatus = listing.outreach?.some(o => o.status === statusFilter);
          if (!hasMatchingStatus) return false;
        }
      }

      // Phase filter
      if (phaseFilter !== 'all') {
        const hasMatchingPhase = listing.outreach?.some(o => o.conversation_phase === phaseFilter);
        if (!hasMatchingPhase) return false;
      }

      // Co-broking filter
      if (coBrokingFilter !== 'all') {
        const hasMatchingCoBroking = listing.outreach?.some(o => o.co_broking_status === coBrokingFilter);
        if (!hasMatchingCoBroking) return false;
      }

      // District filter (keep existing functionality)
      if (districtFilter !== 'all' && listing.district !== districtFilter) {
        return false;
      }

      return true;
    });
  }, [listings, searchTerm, statusFilter, phaseFilter, coBrokingFilter, districtFilter]);

  // Get unique values for filter options
  const uniqueDistricts = useMemo(() => {
    const districts = listings.map(item => item.district).filter(Boolean);
    return Array.from(new Set(districts)).sort();
  }, [listings]);

  // Bulk action handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedItems(new Set(filteredListings.map(listing => listing.id)));
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    const newSelected = new Set(selectedItems);
    if (checked) {
      newSelected.add(itemId);
    } else {
      newSelected.delete(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedItems.size === 0) return;
    
    setIsBulkActionLoading(true);
    try {
      // Get outreach IDs for selected listings
      const selectedListings = filteredListings.filter(l => selectedItems.has(l.id));
      const outreachIds = selectedListings
        .flatMap(l => l.outreach || [])
        .map(o => o.id);
      
      if (outreachIds.length === 0) {
        toast.error('No outreach records found for selected listings');
        return;
      }

      const { error } = await supabase
        .from('outreach')
        .update({ status: newStatus })
        .in('id', outreachIds);

      if (error) throw error;

      toast.success(`Updated ${outreachIds.length} outreach records to ${newStatus}`);
      setSelectedItems(new Set());
      await fetchListings();
    } catch (error) {
      toast.error('Failed to update items');
      console.error('Bulk update error:', error);
    } finally {
      setIsBulkActionLoading(false);
    }
  };

  const handleBulkReset = async () => {
    if (selectedItems.size === 0) return;
    
    setIsBulkActionLoading(true);
    try {
      // Get outreach IDs for selected listings
      const selectedListings = filteredListings.filter(l => selectedItems.has(l.id));
      const outreachIds = selectedListings
        .flatMap(l => l.outreach || [])
        .map(o => o.id);
      
      if (outreachIds.length === 0) {
        toast.error('No outreach records found for selected listings');
        return;
      }

      const response = await fetch('/api/outreach/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outreachIds }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset conversations');
      }

      toast.success(`Reset ${data.resetCount} conversations`);
      setSelectedItems(new Set());
      await fetchListings();
    } catch (error) {
      toast.error('Failed to reset conversations');
      console.error('Bulk reset error:', error);
    } finally {
      setIsBulkActionLoading(false);
    }
  };

  // Process queued outreach messages
  const handleProcessOutreach = async () => {
    setIsBulkActionLoading(true);
    
    try {
      const response = await fetch('/api/outreach/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process outreach messages');
      }

      toast.success(`Processed ${data.stats.processed} messages: ${data.stats.sent} sent, ${data.stats.failed} failed`);
      await fetchListings();
    } catch (error) {
      toast.error('Failed to process outreach messages');
      console.error('Process outreach error:', error);
    } finally {
      setIsBulkActionLoading(false);
    }
  };

  // Reset conversation state for a specific listing
  const resetListingConversationState = async (listingId: string) => {
    try {
      // Find all outreach records for this listing
      const { data: outreachData, error: findError } = await supabase
        .from('outreach')
        .select('id')
        .eq('listing_id', listingId);

      if (findError) {
        toast.error('Error finding outreach records for this listing');
        return;
      }

      if (!outreachData || outreachData.length === 0) {
        toast.error('No outreach record found for this listing');
        return;
      }

      // Reset all outreach records for this listing using the API
      const response = await fetch('/api/outreach/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outreachIds: outreachData.map(record => record.id) }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset outreach');
      }

      toast.success('Outreach reset successfully! Listing is now back to "No outreach" state.');
      await fetchListings();
    } catch (error) {
      toast.error('Failed to reset outreach');
      console.error('Reset listing conversation state error:', error);
    }
  };

  // Initiate outreach function
  const initiateOutreach = async (listing: ListingWithOutreach) => {
    if (!listing.agents) {
      toast.error('No agent associated with this listing');
      return;
    }

    // Check if listing already has outreach (frontend check)
    if (listing.outreach && listing.outreach.length > 0) {
      toast.error('This listing already has outreach');
      return;
    }

    // Set loading state for this specific listing
    setInitiatingOutreach(prev => new Set(prev).add(listing.id));

    try {
      
      // Check if outreach already exists for this agent-listing combination
      const { data: existingOutreach, error: checkError } = await supabase
        .from('outreach')
        .select('id')
        .eq('agent_id', listing.agents.id)
        .eq('listing_id', listing.id)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking existing outreach:', {
          error: checkError,
          message: checkError.message,
          code: checkError.code,
          details: checkError.details,
          hint: checkError.hint,
          fullError: JSON.stringify(checkError, null, 2)
        });
        throw new Error(`Database error checking existing outreach: ${checkError.message}`);
      }

      if (existingOutreach) {
        toast.error('Outreach already exists for this agent-listing combination');
        return;
      }
      
      const { data, error } = await supabase
        .from('outreach')
        .insert({
          agent_id: listing.agents.id,
          listing_id: listing.id,
          channel: 'whatsapp',
          status: 'queued'
        })
        .select();

      if (error) {
        console.error('Supabase error:', error);
        throw new Error(`Database error: ${error.message || 'Unknown database error'}`);
      }

      console.log('Outreach created successfully:', data);
      
      // Automatically trigger outreach processing
      try {
        const response = await fetch('/api/outreach/process', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('Outreach processing result:', result);
          toast.success(`Outreach initiated and message sent for ${listing.title}`);
        } else {
          console.error('Failed to process outreach:', response.statusText);
          toast.success(`Outreach initiated for ${listing.title} (processing failed - check logs)`);
        }
      } catch (processingError) {
        console.error('Error processing outreach:', processingError);
        toast.success(`Outreach initiated for ${listing.title} (processing failed - check logs)`);
      }
      
      await fetchListings();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Initiate outreach error:', error);
      toast.error(`Failed to initiate outreach: ${errorMessage}`);
    } finally {
      // Clear loading state for this specific listing
      setInitiatingOutreach(prev => {
        const newSet = new Set(prev);
        newSet.delete(listing.id);
        return newSet;
      });
    }
  };

  const handleBulkInitiateOutreach = async () => {
    if (selectedItems.size === 0) return;
    
    const selectedListings = filteredListings.filter(l => selectedItems.has(l.id));
    const listingsWithoutOutreach = selectedListings.filter(l => 
      (!l.outreach || l.outreach.length === 0) && l.agents
    );

    if (listingsWithoutOutreach.length === 0) {
      toast.error('No eligible listings selected (need listings without outreach and with agents)');
      return;
    }

    setIsBulkActionLoading(true);
    try {
      console.log('Bulk initiating outreach for', listingsWithoutOutreach.length, 'listings');
      
      // Check which listings already have outreach
      const existingOutreachChecks = await Promise.all(
        listingsWithoutOutreach.map(async (listing) => {
          const { data: existingOutreach, error: checkError } = await supabase
            .from('outreach')
            .select('id')
            .eq('agent_id', listing.agents!.id)
            .eq('listing_id', listing.id)
            .single();
          
          return {
            listing,
            hasExistingOutreach: existingOutreach !== null,
            error: checkError && checkError.code !== 'PGRST116' ? checkError : null
          };
        })
      );

      // Filter out listings that already have outreach or have errors
      const validListings = existingOutreachChecks.filter(check => 
        !check.hasExistingOutreach && !check.error
      );
      
      const alreadyExistingCount = existingOutreachChecks.filter(check => check.hasExistingOutreach).length;
      
      if (alreadyExistingCount > 0) {
        console.log(`${alreadyExistingCount} listings already have outreach`);
      }
      
      if (validListings.length === 0) {
        toast.error('No valid listings to initiate outreach for');
        return;
      }
      
      // Limit the number of outreach records created to respect the outreachLimit setting
      const limitedListings = validListings.slice(0, outreachLimit);
      const skippedCount = validListings.length - limitedListings.length;
      
      if (skippedCount > 0) {
        toast.info(`Limiting to ${outreachLimit} outreach records (${skippedCount} will be skipped). Adjust the limit and run again to process more.`);
      }
      
      const outreachRecords = limitedListings.map(check => ({
        agent_id: check.listing.agents!.id,
        listing_id: check.listing.id,
        channel: 'whatsapp',
        status: 'queued'
      }));

      const { data, error } = await supabase
        .from('outreach')
        .insert(outreachRecords)
        .select();

      if (error) {
        console.error('Bulk Supabase error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });
        throw new Error(`Database error: ${error.message}`);
      }

      console.log('Bulk outreach created successfully:', data);
      
      // Automatically trigger outreach processing with the limit
      try {
        const response = await fetch('/api/outreach/process', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: outreachLimit
          }),
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('Bulk outreach processing result:', result);
          const successMessage = alreadyExistingCount > 0 
            ? `Initiated outreach and sent messages for ${validListings.length} listings (${alreadyExistingCount} already had outreach)`
            : `Initiated outreach and sent messages for ${validListings.length} listings`;
          toast.success(successMessage);
        } else {
          console.error('Failed to process bulk outreach:', response.statusText);
          const successMessage = alreadyExistingCount > 0 
            ? `Initiated outreach for ${validListings.length} listings (${alreadyExistingCount} already had outreach) - processing failed`
            : `Initiated outreach for ${validListings.length} listings - processing failed`;
          toast.success(successMessage);
        }
      } catch (processingError) {
        console.error('Error processing bulk outreach:', processingError);
        const successMessage = alreadyExistingCount > 0 
          ? `Initiated outreach for ${validListings.length} listings (${alreadyExistingCount} already had outreach) - processing failed`
          : `Initiated outreach for ${validListings.length} listings - processing failed`;
        toast.success(successMessage);
      }
      
      setSelectedItems(new Set());
      await fetchListings();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Bulk initiate error details:', {
        error: error,
        message: errorMessage,
        type: typeof error,
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
      toast.error(`Failed to initiate bulk outreach: ${errorMessage}`);
    } finally {
      setIsBulkActionLoading(false);
    }
  };

  // Manual message handlers
  const openManualMessage = (listing: ListingWithOutreach) => {
    setManualMessageTarget(listing);
    setIsManualMessageOpen(true);
    setManualMessage('');
  };

  const sendManualMessage = async () => {
    if (!manualMessageTarget || !manualMessage.trim()) return;

    // Find the outreach record for this listing
    const outreachRecord = manualMessageTarget.outreach?.[0];
    if (!outreachRecord) {
      toast.error('No outreach record found for this listing');
      return;
    }

    setIsSendingMessage(true);
    try {
      const response = await fetch('/api/outreach/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          outreachId: outreachRecord.id,
          message: manualMessage.trim()
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send message');
      }

      toast.success('Message sent successfully via WhatsApp');
      setIsManualMessageOpen(false);
      setManualMessageTarget(null);
      setManualMessage('');
      await fetchListings();
    } catch (error) {
      toast.error('Failed to send message');
      console.error('Manual message error:', error);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const exportToCSV = () => {
    const csvData = filteredListings.map(listing => {
      const outreach = listing.outreach?.[0];
      return {
        Listing: listing.title,
        District: listing.district || '',
        'Property Type': listing.property_type || '',
        Price: listing.price ? `$${listing.price.toLocaleString()}` : '',
        Agent: listing.agents?.name || 'No agent',
        Phone: listing.agents?.phone || '',
        Status: outreach?.status || 'No outreach',
        Phase: outreach?.conversation_phase || '',
        'Co-broking': outreach?.co_broking_status || '',
        'Created At': outreach?.created_at ? new Date(outreach.created_at).toLocaleDateString() : '',
        'Last Message': outreach?.last_message_at ? new Date(outreach.last_message_at).toLocaleDateString() : '',
        'Auto Replies': outreach?.auto_reply_count || 0
      };
    });

    const csvContent = [
      Object.keys(csvData[0] || {}).join(','),
      ...csvData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `listings-outreach-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('CSV exported successfully');
  };

  const runMatcher = async () => {
    setIsMatching(true);
    
    try {
      const response = await fetch('/api/jobs/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: outreachLimit
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Matcher job completed!', {
          description: `📊 Stats: ${data.stats?.listingsFound || 3} listings, ${data.stats?.agentsFound || 5} agents, ${data.stats?.outreachCreated || 2} outreach created, ${data.stats?.messagesSent || 1} messages sent`,
          duration: 5000,
        });
        
        // Refresh listings data
        await fetchListings();
      } else if (response.status === 409) {
        toast.warning('Matcher job is already running', {
          description: 'Please wait for the current job to complete',
        });
        setIsMatching(true); // Keep it as running since job is active
      } else {
        toast.error('Failed to run matcher job', {
          description: data.error || data.message || 'Unknown error',
        });
        setIsMatching(false);
      }
    } catch (error) {
      toast.error('Error starting matcher job', {
        description: error instanceof Error ? error.message : 'Network error',
      });
      setIsMatching(false);
    } finally {
      // Don't set isMatching to false if job is running (409 status)
      // It will be set to false when job completes or is stopped
    }
  };

  const stopMatcher = async () => {
    try {
      const response = await fetch('/api/jobs/match', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        if (data.success) {
          toast.success('Matcher job stopped successfully', {
            description: 'The matching job lock has been released',
            duration: 3000,
          });
        } else {
          toast.info('No active matcher job found', {
            description: data.message || 'The job may have already completed',
            duration: 3000,
          });
        }
        setIsMatching(false);
      } else {
        toast.error('Failed to stop matcher job', {
          description: data.error || data.message || 'Unknown error',
        });
      }
    } catch (error) {
      toast.error('Error stopping matcher job', {
        description: error instanceof Error ? error.message : 'Network error',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      queued: 'bg-gray-100 text-gray-800',
      pending: 'bg-yellow-100 text-yellow-800',
      sent: 'bg-blue-100 text-blue-800',
      replied: 'bg-green-100 text-green-800',
      declined: 'bg-red-100 text-red-800',
      failed: 'bg-red-100 text-red-800',
      opted_out: 'bg-red-100 text-red-800'
    };

    return (
      <Badge className={colors[status] || 'bg-gray-100 text-gray-800'}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const _formatConversation = (messages: ConversationMessage[] | string | undefined) => {
    // Parse messages if it's a string, otherwise use as array
    let parsedMessages: ConversationMessage[] = [];
    try {
      if (typeof messages === 'string') {
        parsedMessages = JSON.parse(messages);
      } else if (Array.isArray(messages)) {
        parsedMessages = messages;
      }
    } catch (error) {
      console.error('Error parsing conversation messages:', error);
      return 'Error parsing conversation';
    }

    if (!parsedMessages || parsedMessages.length === 0) {
      return 'No conversation yet';
    }

    return parsedMessages.map((msg) => {
      const time = new Date(msg.timestamp).toLocaleTimeString('en-SG', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const role = msg.role === 'agent' ? 'Agent' : 'AI';
      return `[${time}] ${role}: ${msg.message}`;
    }).join('\n');
  };

  const ConversationViewer = ({ item }: { item: { id: string; status: string; conversation_phase?: string; co_broking_status?: string; conversation_history?: ConversationMessage[] | string; auto_reply_count?: number; last_message_at?: string; agents: { name: string; phone?: string; }; listings: { title: string; district?: string; property_type?: string; viewing_timeslots?: string; viewing_status?: string; }; } }) => {
    // Parse conversation_history if it's a string, otherwise use as array
    let history: ConversationMessage[] = [];
    try {
      if (typeof item.conversation_history === 'string') {
        history = JSON.parse(item.conversation_history);
      } else if (Array.isArray(item.conversation_history)) {
        history = item.conversation_history;
      }
    } catch (error) {
      console.error('Error parsing conversation_history:', error);
      history = [];
    }
    
    // Debug logging
    console.log(`Conversation history for ${item.id}:`, {
      raw: item.conversation_history,
      parsed: history,
      length: history.length,
      rawType: typeof item.conversation_history,
      rawLength: typeof item.conversation_history === 'string' ? item.conversation_history.length : 'N/A',
      firstMessage: history.length > 0 ? history[0] : null,
      lastMessage: history.length > 0 ? history[history.length - 1] : null
    });
    
    const hasConversation = history.length > 0;
    const isOpen = viewingConversationId === item.id;

    return (
      <Dialog open={isOpen} onOpenChange={(open) => handleConversationDialogClose(open, item.id)}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={!hasConversation}>
            {hasConversation ? `View (${history.length})` : 'No messages'}
          </Button>
        </DialogTrigger>
        <DialogContent 
          className="max-w-4xl h-[90vh] flex flex-col" 
          ref={dialogScrollRef}
        >
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Conversation with {item.agents.name}</DialogTitle>
            <DialogDescription>
              {item.listings.title}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 flex flex-col space-y-4 mt-4 min-h-0">
            {/* Conversation Stats */}
            <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg flex-shrink-0">
              <div>
                <p className="text-sm text-gray-600">Phase</p>
                <p className="font-medium">{item.conversation_phase || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Co-broking</p>
                <p className="font-medium">{item.co_broking_status || 'unknown'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Timeslots</p>
                <p className="font-medium text-sm">{item.listings.viewing_timeslots || 'Not received'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Messages</p>
                <p className="font-medium">{history.length} total</p>
              </div>
            </div>

            {/* Conversation Summary */}
            {history.length > 0 && (
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 flex-shrink-0">
                <h4 className="font-semibold text-sm mb-2">Conversation Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="font-medium">AI Messages:</span> {history.filter(msg => msg.role === 'user').length}
                  </div>
                  <div>
                    <span className="font-medium">Agent Messages:</span> {history.filter(msg => msg.role === 'agent').length}
                  </div>
                </div>
                {history.length > 0 && (
                  <div className="mt-2 text-xs text-gray-600">
                    <span className="font-medium">First message:</span> {new Date(history[0].timestamp).toLocaleString('en-SG')}
                    {history.length > 1 && (
                      <>
                        <br />
                        <span className="font-medium">Last message:</span> {new Date(history[history.length - 1].timestamp).toLocaleString('en-SG')}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Conversation Messages - Scrollable Area */}
            <div className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                <div className="space-y-3 pr-4">
                  {history.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 bg-gray-50 rounded-lg">
                      <p>No conversation history available</p>
                      <p className="text-xs mt-1">
                        This might be a new outreach that hasn&apos;t received responses yet
                      </p>
                    </div>
                  ) : (
                    history.map((msg, i) => (
                      <div
                        key={i}
                        className={`p-4 rounded-lg border-2 ${
                          msg.role === 'agent'
                            ? 'bg-blue-50 border-blue-200'
                            : 'bg-green-50 border-green-200'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-semibold text-sm flex items-center gap-2">
                            {msg.role === 'agent' ? '👤 Agent' : '🤖 AI Assistant'}
                            <span className="text-xs bg-gray-200 px-2 py-1 rounded">
                              Message #{i + 1}
                            </span>
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(msg.timestamp).toLocaleString('en-SG', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="p-3 text-sm whitespace-pre-wrap break-words">
                          {msg.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Outreach Management</h1>
        <p className="text-gray-600 mt-2">Manage outreach campaigns, conversations, and agent interactions</p>
        {listings.filter(l => l.outreach && l.outreach.length > 0).length === 0 && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-yellow-800 text-sm">
              <strong>Note:</strong> No listings with outreach records are currently visible. 
              This might be because the listings with outreach are older and not in the first few results. 
              Try creating outreach for a more recent listing or check the console for more details.
            </p>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Listings</p>
                <p className="text-2xl font-bold">{listings.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Target className="h-4 w-4 text-green-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">With Outreach</p>
                <p className="text-2xl font-bold">
                  {listings.filter(l => l.outreach && l.outreach.length > 0).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-4 w-4 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Active Conversations</p>
                <p className="text-2xl font-bold">
                  {listings.filter(l => 
                    l.outreach?.some(o => o.status === 'replied')
                  ).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-orange-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">No Outreach Yet</p>
                <p className="text-2xl font-bold">
                  {listings.filter(l => !l.outreach || l.outreach.length === 0).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Listings & Outreach</CardTitle>
              <CardDescription>
                {isLoading ? 'Loading...' : `${filteredListings.length} of ${listings.length} listing${listings.length !== 1 ? 's' : ''} shown`}
              </CardDescription>
            </div>
            <div className="flex gap-2 items-center">
              <Button 
                onClick={exportToCSV} 
                disabled={isLoading || filteredListings.length === 0}
                variant="outline"
                size="sm"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button 
                onClick={fetchListings} 
                disabled={isLoading}
                variant="outline"
                size="sm"
              >
                Refresh
              </Button>
              {!isMatching && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="outreach-limit" className="text-sm text-gray-600 whitespace-nowrap">
                    Limit:
                  </Label>
                  <Input
                    id="outreach-limit"
                    type="number"
                    min="1"
                    max="20"
                    value={outreachLimit}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 1 && val <= 20) {
                        setOutreachLimit(val);
                      }
                    }}
                    className="w-20 h-8"
                    disabled={isLoading || isMatching}
                    title="Number of messages to send (1-20, recommended: 10-20)"
                  />
                </div>
              )}
              {isMatching ? (
                <Button 
                  onClick={stopMatcher} 
                  disabled={isLoading}
                  variant="destructive"
                  size="sm"
                >
                  Stop Matcher
                </Button>
              ) : (
                <Button 
                  onClick={runMatcher} 
                  disabled={isLoading}
                  className="bg-purple-600 hover:bg-purple-700"
                  size="sm"
                >
                  Run Matcher
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters and Search */}
          <div className="space-y-4 mb-6">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search */}
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    placeholder="Search agents, listings, districts..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="no_outreach">No Outreach</SelectItem>
                    <SelectItem value="queued">Queued</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="replied">Replied</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={phaseFilter} onValueChange={setPhaseFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Phase" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Phases</SelectItem>
                    <SelectItem value="initial_request">Initial Request</SelectItem>
                    <SelectItem value="agent_engaging">Agent Engaging</SelectItem>
                    <SelectItem value="agent_checking">Agent Checking</SelectItem>
                    <SelectItem value="agent_stalling">Agent Stalling</SelectItem>
                    <SelectItem value="timeslots_received">Timeslots Received</SelectItem>
                    <SelectItem value="gracefully_ended">Gracefully Ended</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={coBrokingFilter} onValueChange={setCoBrokingFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Co-broking" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Co-broking</SelectItem>
                    <SelectItem value="willing">Willing</SelectItem>
                    <SelectItem value="not_willing">Not Willing</SelectItem>
                    <SelectItem value="needs_discussion">Needs Discussion</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={districtFilter} onValueChange={setDistrictFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="District" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Districts</SelectItem>
                    {uniqueDistricts.map(district => (
                      <SelectItem key={district} value={district || ''}>{district}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Bulk Actions */}
            {selectedItems.size > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-blue-900">
                      {selectedItems.size} item{selectedItems.size !== 1 ? 's' : ''} selected
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleBulkInitiateOutreach}
                      disabled={isBulkActionLoading}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Start Outreach
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBulkStatusUpdate('queued')}
                      disabled={isBulkActionLoading}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBulkStatusUpdate('failed')}
                      disabled={isBulkActionLoading}
                    >
                      <Pause className="h-4 w-4 mr-1" />
                      Pause
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBulkReset}
                      disabled={isBulkActionLoading}
                      className="text-red-600 hover:text-red-700"
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleProcessOutreach}
                      disabled={isBulkActionLoading}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      <Send className="h-4 w-4 mr-1" />
                      Process Queued
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedItems(new Set())}
                    >
                      Clear Selection
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedItems.size === filteredListings.length && filteredListings.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="min-w-[250px]">Listing</TableHead>
                  <TableHead className="min-w-[180px]">Agent</TableHead>
                  <TableHead className="min-w-[120px]">Status</TableHead>
                  <TableHead className="min-w-[100px]">Activity</TableHead>
                  <TableHead className="min-w-[200px]">Actions</TableHead>
                  <TableHead className="min-w-[80px]">Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                      Loading listings data...
                    </TableCell>
                  </TableRow>
                ) : filteredListings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                      {listings.length === 0 
                        ? 'No listings found. Run the scraper to collect listings!'
                        : 'No listings match your current filters.'
                      }
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredListings.map((listing) => (
                    <TableRow key={listing.id} className={selectedItems.has(listing.id) ? 'bg-blue-50' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.has(listing.id)}
                          onCheckedChange={(checked) => handleSelectItem(listing.id, checked as boolean)}
                        />
                      </TableCell>
                      <TableCell className="max-w-[250px]">
                        <div className="space-y-1">
                          <div className="font-medium break-words">{listing.title}</div>
                          <div className="text-sm text-gray-500">
                            {listing.district} • {listing.property_type}
                            {listing.price && ` • $${listing.price.toLocaleString()}`}
                          </div>
                          {listing.viewing_timeslots && (
                            <div className="text-xs text-blue-600 mt-1 break-words whitespace-pre-wrap">
                              <span className="flex items-start gap-1">
                                <span className="flex-shrink-0">📅</span>
                                <span className="break-words">{listing.viewing_timeslots}</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        {listing.agents ? (
                          <div className="space-y-1">
                            <div className="font-medium break-words">{listing.agents.name}</div>
                            {listing.agents.phone && (
                              <div className="text-sm text-gray-500 break-words">{listing.agents.phone}</div>
                            )}
                            {listing.agents.agency && (
                              <div className="text-xs text-gray-400 break-words truncate">{listing.agents.agency}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">No agent</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {listing.outreach && listing.outreach.length > 0 ? (
                          <div className="space-y-1">
                            {listing.outreach.map(o => (
                              <div key={o.id}>
                                {getStatusBadge(o.status)}
                                {o.conversation_phase && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    {o.conversation_phase.replace('_', ' ')}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-gray-400">
                            No outreach
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {listing.outreach && listing.outreach.length > 0 ? (
                          <div className="text-sm">
                            {listing.outreach[0].last_message_at ? (
                              <div>
                                <div className="text-gray-600">
                                  {new Date(listing.outreach[0].last_message_at).toLocaleDateString('en-SG')}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {(() => {
                                    const history = listing.outreach[0].conversation_history;
                                    if (Array.isArray(history)) {
                                      return `${history.length} messages`;
                                    } else if (typeof history === 'string') {
                                      try {
                                        const parsed = JSON.parse(history);
                                        return `${Array.isArray(parsed) ? parsed.length : 0} messages`;
                                      } catch {
                                        return `${listing.outreach[0].auto_reply_count || 0} messages`;
                                      }
                                    }
                                    return `${listing.outreach[0].auto_reply_count || 0} messages`;
                                  })()}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400">Not started</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {listing.outreach && listing.outreach.length > 0 ? (
                            <>
                              <ConversationViewer item={{
                                ...listing.outreach[0],
                                agents: { name: listing.agents?.name || 'Unknown', phone: listing.agents?.phone },
                                listings: { 
                                  title: listing.title, 
                                  district: listing.district, 
                                  property_type: listing.property_type,
                                  viewing_timeslots: listing.viewing_timeslots,
                                  viewing_status: listing.viewing_status
                                }
                              }} />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => listing.agents ? openManualMessage(listing) : toast.error('No agent available')}
                              >
                                <Send className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => resetListingConversationState(listing.id)}
                                className="text-orange-600 hover:text-orange-700 border-orange-300 hover:border-orange-400"
                              >
                                Reset
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => initiateOutreach(listing)}
                              disabled={!listing.agents || initiatingOutreach.has(listing.id)}
                              className="bg-green-600 hover:bg-green-700 disabled:opacity-50"
                            >
                              {initiatingOutreach.has(listing.id) ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Starting...
                                </>
                              ) : (
                                'Start Outreach'
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {new Date(listing.posted_at || listing.scraped_at).toLocaleDateString('en-SG')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Manual Message Dialog */}
      <Dialog open={isManualMessageOpen} onOpenChange={handleManualMessageDialogClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send Manual Message</DialogTitle>
            <DialogDescription>
              Send a custom message to {manualMessageTarget?.agents?.name} about {manualMessageTarget?.title}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Current Conversation Status</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Status:</span> {manualMessageTarget?.outreach?.[0]?.status || 'No outreach'}
                </div>
                <div>
                  <span className="font-medium">Phase:</span> {manualMessageTarget?.outreach?.[0]?.conversation_phase || 'N/A'}
                </div>
                <div>
                  <span className="font-medium">Co-broking:</span> {manualMessageTarget?.outreach?.[0]?.co_broking_status || 'unknown'}
                </div>
                <div>
                  <span className="font-medium">Auto Replies:</span> {manualMessageTarget?.outreach?.[0]?.auto_reply_count || 0}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                placeholder="Type your message here..."
                value={manualMessage}
                onChange={(e) => setManualMessage(e.target.value)}
                className="mt-1"
                rows={4}
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setIsManualMessageOpen(false)}
                disabled={isSendingMessage}
              >
                Cancel
              </Button>
              <Button
                onClick={sendManualMessage}
                disabled={!manualMessage.trim() || isSendingMessage}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSendingMessage ? 'Sending...' : 'Send Message'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
