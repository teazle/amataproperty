/**
 * Enhanced Listings Page with Zustand State Management
 * Real-time updates, optimized performance, and better UX
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { Search, Download, RefreshCw, Eye, MessageSquare, Calendar, DollarSign, MapPin, Home, Phone, Mail, Copy, Edit } from 'lucide-react';
import { useListingsSelectors, useGlobalStore } from '@/lib/stores/global-store';
import { useNotificationsSelectors } from '@/lib/stores/global-store';
import { useRealtimeListings } from '@/hooks/useRealtimeSync';
import EditListingModal from '@/components/EditListingModal';

// Listing interface (same as original page)
interface Listing {
  id: string;
  title: string;
  district?: string;
  price: number | null;
  portal: string;
  property_type?: string;
  agent_id?: string;
  posted_at?: string;
  scraped_at?: string;
  address?: string;
  beds?: number;
  baths?: number;
  size_sqft?: number;
  price_psf?: number;
  year_built?: number;
  tenure?: string;
  url?: string;
  viewing_requested_at?: string;
  viewing_timeslots?: string;
  viewing_status?: string;
  viewing_timeslots_structured?: {
    available?: boolean;
    slots?: Array<{
      date?: string;
      day?: string;
      time: string;
    }>;
  };
  agents?: {
    id: string;
    name: string;
    phone: string;
    email?: string;
    agency?: string;
    cea_reg_no?: string;
    source?: string;
    source_url?: string;
    last_seen_at?: string;
  };
  outreach?: Array<{
    id: string;
    status: string;
    conversation_phase?: string;
    co_broking_status?: string;
    co_broking_notes?: string;
    last_message_at?: string;
    auto_reply_count?: number;
  }>;
}

// Filter constants (same as original page)
const districts = [
  'All',
  // Standard D01-D28 format (what scrapers will now produce)
  'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10',
  'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20',
  'D21', 'D22', 'D23', 'D24', 'D25', 'D26', 'D27', 'D28',
  // Legacy formats (for existing data in DB)
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9',
  // For records with null district
  'No District'
];
const portals = ['All', 'propertyguru', 'edgeprop'];
const priceBands = [
  { label: 'All', min: 0, max: Infinity },
  { label: 'Under $1M', min: 0, max: 999999 },
  { label: '$1M - $2.999M', min: 1000000, max: 2999999 },
  { label: '$3M - $5M', min: 3000000, max: 5000000 },
  { label: 'Above $5M', min: 5000001, max: Infinity },
];

export default function EnhancedListingsPage() {
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  // Filter states (same as original page)
  const [selectedDistrict, setSelectedDistrict] = useState('All');
  const [selectedPriceBand, setSelectedPriceBand] = useState('All');
  const [selectedPortal, setSelectedPortal] = useState('All');
  const [selectedBeds, setSelectedBeds] = useState('All');
  const [selectedBaths, setSelectedBaths] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Get raw listings from store (no filtering yet)
  const rawListings = useListingsSelectors.useListings();
  const loading = useListingsSelectors.useLoading();
  const notifications = useNotificationsSelectors.useNotifications();
  
  // Convert Map to Array for filtering (like original page)
  const listings = Array.from(rawListings.values()) as Listing[];
  
  // Apply filtering logic (same as original page)
  const filteredListings = listings.filter(listing => {
    // Match by district code with support for both legacy and new formats
    let districtMatch = false;
    
    if (selectedDistrict === 'All') {
      districtMatch = true;
    } else if (selectedDistrict === 'No District') {
      districtMatch = listing.district === null;
    } else {
      // Handle both legacy and new district formats
      const selectedDistrictNum = selectedDistrict.replace('D', ''); // Extract number from "D10" -> "10"
      const listingDistrictNum = listing.district?.replace('D', '') || ''; // Extract number from listing district
      
      districtMatch = listing.district === selectedDistrict || // Exact match (D10 = D10)
                     listingDistrictNum === selectedDistrictNum; // Legacy match (10 = 10, or D10 = 10)
    }
    
    const priceBand = priceBands.find(band => band.label === selectedPriceBand);
    const priceMatch = priceBand ? (listing.price !== null && listing.price >= priceBand.min && listing.price <= priceBand.max) : true;
    const portalMatch = selectedPortal === 'All' || listing.portal === selectedPortal;
    
    // Beds filter
    const bedsMatch = selectedBeds === 'All' || 
      (selectedBeds === '5+' ? (listing.beds && listing.beds >= 5) : 
       (listing.beds && listing.beds === parseInt(selectedBeds)));
    
    // Baths filter
    const bathsMatch = selectedBaths === 'All' || 
      (selectedBaths === '5+' ? (listing.baths && listing.baths >= 5) : 
       (listing.baths && listing.baths === parseInt(selectedBaths)));
    
    // Search across multiple fields
    const searchMatch = searchTerm === '' || 
      listing.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (listing.address && listing.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (listing.agents?.name && listing.agents.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (listing.property_type && listing.property_type.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (listing.district && listing.district.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return districtMatch && priceMatch && portalMatch && bedsMatch && bathsMatch && searchMatch;
  });
  
  // Debug logging
  console.log('Component render:', { 
    listingsCount: listings.length, 
    filteredCount: filteredListings.length,
    loading,
    rawListingsSize: rawListings.size
  });
  
  // Helper functions (same as original page)
  const formatPrice = (price: number | null) => {
    if (!price) return 'N/A';
    return `$${price.toLocaleString()}`;
  };

  const getDistrictDisplayName = (districtCode: string | undefined) => {
    if (!districtCode) return 'No District';
    return districtCode;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch (err) {
      console.error('Failed to copy text: ', err);
      toast.error('Failed to copy');
    }
  };
  
  // Store actions
  const { 
    fetchListings, 
    updateListing,
    addNotification 
  } = useGlobalStore();

  // Fetch listings on mount - get all listings (no pagination)
  useEffect(() => {
    fetchListings(1, 1000); // Get all listings with limit=1000
  }, [fetchListings]); // Include fetchListings in dependencies

  // Subscribe to real-time updates
  useRealtimeListings();

  // Real-time updates - only when listings change
  // Note: Removed automatic notification to avoid UI blocking




  const handleRefresh = () => {
    fetchListings(1, 1000); // Get all listings with limit=1000
    addNotification({
      type: 'success',
      title: 'Refreshed',
      message: 'Listings data refreshed successfully',
    });
  };

  const handleExport = () => {
    const csvContent = [
      ['Title', 'Price', 'District', 'Type', 'Agent', 'Phone', 'Status', 'Posted At'],
      ...filteredListings.map(listing => [
        listing.title || '',
        listing.price?.toString() || '',
        listing.district || '',
        listing.property_type || '',
        listing.agents?.name || '',
        listing.agents?.phone || '',
        listing.viewing_status || '',
        listing.posted_at || '',
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `listings-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    addNotification({
      type: 'success',
      title: 'Export Complete',
      message: 'Listings exported to CSV successfully',
    });
  };

  const handleEditListing = (listing: Listing) => {
    setEditingListing(listing);
    setIsEditModalOpen(true);
  };

  const handleSaveListing = (updatedListing: Listing) => {
    // Update the listing in the store
    // Convert null values to undefined for the store
    const storeListing = {
      ...updatedListing,
      price: updatedListing.price === null ? undefined : updatedListing.price
    };
    
    updateListing(updatedListing.id, storeListing);
    
    addNotification({
      type: 'success',
      title: 'Listing Updated',
      message: 'Listing details have been updated successfully',
    });
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setEditingListing(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'received':
        return 'bg-green-100 text-green-800';
      case 'requested':
        return 'bg-blue-100 text-blue-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPortalColor = (portal: string) => {
    switch (portal) {
      case 'propertyguru':
        return 'bg-blue-100 text-blue-800';
      case 'edgeprop':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Property Listings</h1>
          <p className="text-gray-600 mt-2">
            {loading ? 'Loading...' : `${filteredListings.length} listing${filteredListings.length !== 1 ? 's' : ''} found`}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={handleRefresh} variant="outline" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handleExport} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search by title, address, agent name, property type, or district..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-white border-gray-300 text-black placeholder:text-gray-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-white">
        <CardHeader className="bg-white">
          <CardTitle className="text-black">Property Listings</CardTitle>
          <CardDescription className="text-gray-800">
            {loading ? 'Loading...' : `${filteredListings.length} listing${filteredListings.length !== 1 ? 's' : ''} found`}
          </CardDescription>
        </CardHeader>
        <CardContent className="bg-white">
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 mb-6">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              
              {/* District Filter */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-blue-600" />
                  District
                </h3>
                <div className="space-y-3">
                  <Button
                    variant={selectedDistrict === 'All' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDistrict('All')}
                    className={`w-full justify-start ${selectedDistrict === 'All' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'}`}
                  >
                    All Districts
                  </Button>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {districts.slice(1).map((district) => {
                      const isSelected = selectedDistrict === district;
                      
                      return (
                        <Button
                          key={district}
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedDistrict(district)}
                          className={`justify-center text-center h-8 ${isSelected 
                            ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' 
                            : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'}`}
                          title={district}
                        >
                          <span className="text-xs font-medium">{district}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Price Band Filter */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="text-lg">💰</span>
                  Price Range
                </h3>
                <div className="space-y-2">
                  {priceBands.map((band) => {
                    const isSelected = selectedPriceBand === band.label;
                    return (
                      <Button
                        key={band.label}
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedPriceBand(band.label)}
                        className={`w-full justify-start ${isSelected 
                          ? 'bg-green-600 hover:bg-green-700 text-white border-green-600' 
                          : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'}`}
                      >
                        {band.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Bedrooms Filter */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Home className="h-4 w-4 text-indigo-600" />
                  Bedrooms
                </h3>
                <Select value={selectedBeds} onValueChange={setSelectedBeds}>
                  <SelectTrigger className="w-full bg-white border-gray-300 text-gray-900">
                    <SelectValue placeholder="Any beds" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="All" className="text-gray-900">Any beds</SelectItem>
                    <SelectItem value="1" className="text-gray-900">1 bed</SelectItem>
                    <SelectItem value="2" className="text-gray-900">2 beds</SelectItem>
                    <SelectItem value="3" className="text-gray-900">3 beds</SelectItem>
                    <SelectItem value="4" className="text-gray-900">4 beds</SelectItem>
                    <SelectItem value="5+" className="text-gray-900">5+ beds</SelectItem>
                  </SelectContent>
                </Select>
                {selectedBeds !== 'All' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedBeds('All')}
                    className="w-full mt-2 text-xs text-gray-600 hover:text-gray-900"
                  >
                    Clear filter
                  </Button>
                )}
              </div>

              {/* Bathrooms Filter */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Home className="h-4 w-4 text-teal-600" />
                  Bathrooms
                </h3>
                <Select value={selectedBaths} onValueChange={setSelectedBaths}>
                  <SelectTrigger className="w-full bg-white border-gray-300 text-gray-900">
                    <SelectValue placeholder="Any baths" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="All" className="text-gray-900">Any baths</SelectItem>
                    <SelectItem value="1" className="text-gray-900">1 bath</SelectItem>
                    <SelectItem value="2" className="text-gray-900">2 baths</SelectItem>
                    <SelectItem value="3" className="text-gray-900">3 baths</SelectItem>
                    <SelectItem value="4" className="text-gray-900">4 baths</SelectItem>
                    <SelectItem value="5+" className="text-gray-900">5+ baths</SelectItem>
                  </SelectContent>
                </Select>
                {selectedBaths !== 'All' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedBaths('All')}
                    className="w-full mt-2 text-xs text-gray-600 hover:text-gray-900"
                  >
                    Clear filter
                  </Button>
                )}
              </div>

              {/* Portal Filter */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="text-lg">🌐</span>
                  Portal
                </h3>
                <div className="space-y-2">
                  {portals.map((portal) => {
                    const isSelected = selectedPortal === portal;
                    const portalColor = portal === 'propertyguru' ? 'bg-purple-600 hover:bg-purple-700' : 
                                       portal === 'edgeprop' ? 'bg-orange-600 hover:bg-orange-700' : 
                                       'bg-gray-600 hover:bg-gray-700';
                    
                    return (
                      <Button
                        key={portal}
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedPortal(portal)}
                        className={`w-full justify-start ${isSelected 
                          ? `${portalColor} text-white border-transparent` 
                          : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'}`}
                      >
                        <span className="capitalize">{portal === 'All' ? 'All Portals' : portal}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
              
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Listings Table - Same as original page */}
      <div className="rounded-md border bg-white overflow-x-auto">
        <Table className="bg-white min-w-[1200px]">
          <TableHeader className="bg-white">
            <TableRow className="bg-white">
              <TableHead className="bg-white text-black w-[200px]">Title</TableHead>
              <TableHead className="bg-white text-black w-[80px]">District</TableHead>
              <TableHead className="bg-white text-black w-[100px]">Price</TableHead>
              <TableHead className="bg-white text-black w-[80px]">Portal</TableHead>
              <TableHead className="bg-white text-black w-[200px]">Details</TableHead>
              <TableHead className="bg-white text-black w-[120px]">Agent</TableHead>
              <TableHead className="bg-white text-black w-[140px]">Contact</TableHead>
              <TableHead className="bg-white text-black w-[100px]">Co-broking</TableHead>
              <TableHead className="bg-white text-black w-[60px]">Actions</TableHead>
              <TableHead className="bg-white text-black w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="bg-white">
            {loading ? (
              <TableRow className="bg-white">
                <TableCell colSpan={10} className="text-center py-8 text-black bg-white">
                  Loading listings...
                </TableCell>
              </TableRow>
            ) : filteredListings.length === 0 ? (
              <TableRow className="bg-white">
                <TableCell colSpan={10} className="text-center py-8 text-black bg-white">
                  No listings found
                </TableCell>
              </TableRow>
            ) : (
              filteredListings.map((listing) => {
                return (
                  <React.Fragment key={listing.id}>
                    <TableRow className="bg-white">
                      <TableCell className="font-medium bg-white text-black max-w-[200px]">
                        <div className="truncate" title={listing.title}>{listing.title}</div>
                      </TableCell>
                      <TableCell className="bg-white text-black">
                        <Badge variant="secondary" className="text-xs">{getDistrictDisplayName(listing.district)}</Badge>
                      </TableCell>
                      <TableCell className="font-semibold bg-white text-black text-sm">{formatPrice(listing.price)}</TableCell>
                      <TableCell className="bg-white text-black">
                        <Badge variant={listing.portal === 'edgeprop' ? 'default' : 'secondary'} className="text-xs">
                          {listing.portal}
                        </Badge>
                      </TableCell>
                      <TableCell className="bg-white text-black max-w-[200px]">
                        <div className="space-y-1 text-xs">
                          {listing.property_type && (
                            <div className="flex items-center gap-1">
                              <Home className="h-3 w-3 text-blue-500 flex-shrink-0" />
                              <span className="font-medium text-gray-900 truncate">{listing.property_type}</span>
                            </div>
                          )}
                          {listing.address && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-gray-400 flex-shrink-0" />
                              <span className="text-gray-700 text-xs truncate" title={listing.address}>{listing.address}</span>
                            </div>
                          )}
                          <div className="flex gap-3 text-xs">
                            {listing.size_sqft && (
                              <span className="font-medium text-gray-900">{listing.size_sqft.toLocaleString()} sqft</span>
                            )}
                            {listing.price_psf && (
                              <span className="font-medium text-green-600">${listing.price_psf}/psf</span>
                            )}
                          </div>
                          <div className="flex gap-3 text-xs">
                            {listing.beds && (
                              <span className="text-gray-700">{listing.beds} bed{listing.beds !== 1 ? 's' : ''}</span>
                            )}
                            {listing.baths && (
                              <span className="text-gray-700">{listing.baths} bath{listing.baths !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium bg-white text-black max-w-[120px]">
                        <div className="truncate" title={listing.agents?.name || 'N/A'}>
                          {listing.agents?.name || 'N/A'}
                        </div>
                      </TableCell>
                      <TableCell className="bg-white text-black max-w-[140px]">
                        {listing.agents ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-xs">
                              <Phone className="h-3 w-3 text-gray-400 flex-shrink-0" />
                              <a 
                                href={`tel:${listing.agents.phone}`}
                                className="text-blue-600 hover:text-blue-800 hover:underline truncate"
                                title={listing.agents.phone}
                              >
                                {listing.agents.phone}
                              </a>
                              <button
                                onClick={() => copyToClipboard(listing.agents!.phone)}
                                className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                                title="Copy phone"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                            {listing.agents.email && (
                              <div className="flex items-center gap-1 text-xs">
                                <Mail className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                <a 
                                  href={`mailto:${listing.agents.email}`}
                                  className="hover:underline truncate"
                                  title={listing.agents.email}
                                >
                                  {listing.agents.email}
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-800 text-xs">No contact info</span>
                        )}
                      </TableCell>
                      <TableCell className="bg-white text-black max-w-[100px]">
                        {listing.outreach && listing.outreach.length > 0 ? (
                          <div className="space-y-1">
                            {listing.outreach.map((outreach, idx) => (
                              <div key={outreach.id || idx} className="flex flex-col gap-1">
                                <Badge 
                                  variant={
                                    outreach.co_broking_status === 'willing' ? 'default' :
                                    outreach.co_broking_status === 'not_willing' ? 'destructive' :
                                    outreach.co_broking_status === 'needs_discussion' ? 'secondary' :
                                    'outline'
                                  }
                                  className="text-xs"
                                >
                                  {outreach.co_broking_status === 'willing' ? 'Willing' :
                                   outreach.co_broking_status === 'not_willing' ? 'Not Willing' :
                                   outreach.co_broking_status === 'needs_discussion' ? 'Needs Discussion' :
                                   'Unknown'}
                                </Badge>
                                {outreach.conversation_phase && (
                                  <span className="text-xs text-gray-600 truncate" title={outreach.conversation_phase}>
                                    {outreach.conversation_phase.replace('_', ' ')}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-500 text-xs">No outreach</span>
                        )}
                      </TableCell>
                      <TableCell className="bg-white text-black max-w-[60px]">
                        <button 
                          type="button"
                          className="h-6 w-6 p-0 border rounded hover:bg-blue-100 text-blue-600 flex items-center justify-center"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleEditListing(listing);
                          }}
                          title="Edit listing"
                        >
                          <Edit className="h-3 w-3" />
                        </button>
                      </TableCell>
                      <TableCell className="bg-white text-black max-w-[60px]">
                        <button 
                          type="button"
                          className="h-6 w-6 p-0 border rounded hover:bg-gray-100 text-black flex items-center justify-center"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const detailsRow = document.getElementById(`details-${listing.id}`);
                            if (detailsRow) {
                              if (detailsRow.style.display === 'none' || detailsRow.style.display === '') {
                                detailsRow.style.display = 'table-row';
                              } else {
                                detailsRow.style.display = 'none';
                              }
                            }
                          }}
                          title="Toggle details"
                        >
                          ▼
                        </button>
                      </TableCell>
                    </TableRow>
                    <TableRow id={`details-${listing.id}`} style={{display: 'none'}}>
                      <TableCell colSpan={10} className="bg-white p-3">
                        {/* Data Completeness Indicator */}
                        <div className="mb-3 p-2 bg-gray-50 rounded border border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold text-black text-xs">📊 Data Completeness</h4>
                            <span className="text-xs text-gray-800">
                              {[
                                listing.property_type, listing.address, listing.district,
                                listing.beds, listing.baths, listing.size_sqft,
                                listing.price_psf, listing.year_built, listing.tenure,
                                listing.viewing_status
                              ].filter(Boolean).length} / 10 fields populated
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={listing.property_type ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Type</Badge>
                            <Badge variant={listing.address ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Address</Badge>
                            <Badge variant={listing.district ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">District</Badge>
                            <Badge variant={listing.beds ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Beds</Badge>
                            <Badge variant={listing.baths ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Baths</Badge>
                            <Badge variant={listing.size_sqft ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Size</Badge>
                            <Badge variant={listing.price_psf ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">PSF</Badge>
                            <Badge variant={listing.year_built ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Year</Badge>
                            <Badge variant={listing.tenure ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Tenure</Badge>
                            <Badge variant={listing.viewing_status ? 'default' : 'outline'} className="text-xs font-semibold text-gray-900">Viewing</Badge>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                          <div className="space-y-2">
                            <h4 className="font-semibold text-black border-b pb-1">🏠 Basic Info</h4>
                            <p><span className="text-gray-800">Title:</span> <span className="text-black">{listing.title}</span></p>
                            <p><span className="text-gray-800">Property Type:</span> <span className="text-gray-800">{listing.property_type || 'N/A'}</span></p>
                            <p><span className="text-gray-800">Price:</span> <span className="text-black">{formatPrice(listing.price)}</span></p>
                            <p><span className="text-gray-800">Portal:</span> <span className="text-black">{listing.portal}</span></p>
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-black border-b pb-1">📍 Location</h4>
                            {listing.address ? (
                              <p><span className="text-gray-800">Address:</span> <span className="text-black">{listing.address}</span></p>
                            ) : (
                              <p><span className="text-gray-800">Address:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                            {listing.district ? (
                              <>
                                <p><span className="text-gray-800">District:</span> <span className="text-black">{getDistrictDisplayName(listing.district)}</span></p>
                                <p><span className="text-gray-800">District Code:</span> <span className="text-black">{listing.district}</span></p>
                              </>
                            ) : (
                              <p><span className="text-gray-800">District:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-black border-b pb-1">🏡 Property Details</h4>
                            {listing.size_sqft ? (
                              <p><span className="text-gray-800">Size:</span> <span className="text-black">{listing.size_sqft.toLocaleString()} sqft</span></p>
                            ) : (
                              <p><span className="text-gray-800">Size:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                            {listing.price_psf ? (
                              <p><span className="text-gray-800">Price PSF:</span> <span className="text-black">${listing.price_psf}</span></p>
                            ) : (
                              <p><span className="text-gray-800">Price PSF:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                            {listing.beds ? (
                              <p><span className="text-gray-800">Bedrooms:</span> <span className="text-black">{listing.beds}</span></p>
                            ) : (
                              <p><span className="text-gray-800">Bedrooms:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                            {listing.baths ? (
                              <p><span className="text-gray-800">Bathrooms:</span> <span className="text-black">{listing.baths}</span></p>
                            ) : (
                              <p><span className="text-gray-800">Bathrooms:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                            {listing.tenure ? (
                              <p><span className="text-gray-800">Tenure:</span> <span className="text-black">{listing.tenure}</span></p>
                            ) : (
                              <p><span className="text-gray-800">Tenure:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                            {listing.year_built ? (
                              <p><span className="text-gray-800">Year Built:</span> <span className="text-black">{listing.year_built}</span></p>
                            ) : (
                              <p><span className="text-gray-800">Year Built:</span> <span className="text-gray-800 italic">Not available</span></p>
                            )}
                          </div>
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-black border-b pb-1">👤 Agent Details</h4>
                            {listing.agents ? (
                              <>
                                <p><span className="text-gray-800">Name:</span> <span className="text-black">{listing.agents.name}</span></p>
                                <p><span className="text-gray-800">Phone:</span> <span className="text-black">{listing.agents.phone}</span></p>
                                {listing.agents.email && <p><span className="text-gray-800">Email:</span> <span className="text-black">{listing.agents.email}</span></p>}
                                {listing.agents.agency && <p><span className="text-gray-800">Agency:</span> <span className="text-black">{listing.agents.agency}</span></p>}
                                {listing.agents.cea_reg_no && <p><span className="text-gray-800">CEA Reg:</span> <span className="text-black">{listing.agents.cea_reg_no}</span></p>}
                                {listing.agents.source && <p><span className="text-gray-800">Source:</span> <span className="text-black">{listing.agents.source}</span></p>}
                                {listing.agents.last_seen_at && <p><span className="text-gray-800">Last Seen:</span> <span className="text-black">{new Date(listing.agents.last_seen_at).toLocaleDateString()}</span></p>}
                              </>
                            ) : (
                              <p><span className="text-gray-800">Agent ID:</span> <span className="text-black">{listing.agent_id || 'N/A'}</span></p>
                            )}
                          </div>
                          
                          {(listing.viewing_status || listing.viewing_timeslots || listing.viewing_requested_at) && (
                            <div className="space-y-2">
                              <h4 className="font-semibold text-black border-b pb-1">👁️ Viewing Information</h4>
                              {listing.viewing_status && (
                                <p>
                                  <span className="text-gray-800">Status:</span>{' '}
                                  <Badge variant={listing.viewing_status === 'received' ? 'default' : 'secondary'}>
                                    {listing.viewing_status}
                                  </Badge>
                                </p>
                              )}
                              {listing.viewing_requested_at && (
                                <p><span className="text-gray-800">Requested At:</span> <span className="text-black">{new Date(listing.viewing_requested_at).toLocaleString()}</span></p>
                              )}
                              {listing.viewing_timeslots && (
                                <div className="space-y-1">
                                  <p className="text-gray-800">📅 Viewing Timeslots:</p>
                                  <p className="text-black font-medium break-words whitespace-pre-wrap">{listing.viewing_timeslots}</p>
                                </div>
                              )}
                            </div>
                          )}
                          
                          <div className="space-y-2">
                            <h4 className="font-semibold text-black border-b pb-1">📅 Dates & Links</h4>
                            <p><span className="text-gray-800">Posted At:</span> <span className="text-black">{listing.posted_at ? new Date(listing.posted_at).toLocaleDateString() : 'N/A'}</span></p>
                            <p><span className="text-gray-800">Scraped At:</span> <span className="text-black">{listing.scraped_at ? new Date(listing.scraped_at).toLocaleDateString() : 'N/A'}</span></p>
                            <p><span className="text-gray-800">Listing ID:</span> <span className="text-black">{listing.id}</span></p>
                            {listing.url && (
                              <p>
                                <span className="text-gray-800">Original URL:</span>
                                <br />
                                <a href={listing.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs break-all">
                                  {listing.url}
                                </a>
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>


      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="fixed bottom-4 right-4 space-y-2 z-40">
          {notifications.slice(0, 3).map((notification) => (
            <div
              key={notification.id}
              className={`p-4 rounded-lg shadow-lg max-w-sm relative ${
                notification.type === 'success' ? 'bg-green-500 text-white' :
                notification.type === 'error' ? 'bg-red-500 text-white' :
                notification.type === 'warning' ? 'bg-yellow-500 text-white' :
                'bg-blue-500 text-white'
              }`}
            >
              <button
                onClick={() => {
                  // Remove notification by ID
                  const { removeNotification } = useGlobalStore.getState();
                  removeNotification(notification.id);
                }}
                className="absolute top-2 right-2 text-white hover:text-gray-200 text-lg leading-none"
                title="Close notification"
              >
                ×
              </button>
              <div className="font-medium pr-6">{notification.title}</div>
              <div className="text-sm pr-6">{notification.message}</div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Listing Modal */}
      <EditListingModal
        listing={editingListing}
        isOpen={isEditModalOpen}
        onClose={handleCloseEditModal}
        onSave={handleSaveListing}
      />
    </div>
  );
}
