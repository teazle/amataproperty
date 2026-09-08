/**
 * Enhanced Listings Page with Zustand State Management
 * Real-time updates, optimized performance, and better UX
 */

'use client';

import EditListingModal from '@/components/EditListingModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from '@/components/ui/table';
import { Copy,Download,Edit,Home,Mail,MapPin,Phone,RefreshCw,Search } from 'lucide-react';
import { districtAliases,getShowingRange } from '@/lib/admin-browsing';
import React,{ useCallback,useEffect,useRef,useState } from 'react';
import { toast } from 'sonner';

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
const districts = ['All', ...Array.from({ length: 28 }, (_value, index) => districtAliases(String(index + 1))[0]), 'No District'];
const portals = ['All', 'propertyguru', 'edgeprop'];
const priceBands = [
  { label: 'All', min: 0, max: Infinity },
  { label: 'Under $1M', min: 0, max: 999999 },
  { label: '$1M - $2.999M', min: 1000000, max: 2999999 },
  { label: '$3M - $5M', min: 3000000, max: 5000000 },
  { label: 'Above $5M', min: 5000001, max: Infinity },
];

export default function EnhancedListingsPage() {
  const [_selectedListingId, _setSelectedListingId] = useState<string | null>(null);
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Filter states (same as original page)
  const [selectedDistrict, setSelectedDistrict] = useState('All');
  const [selectedPriceBand, setSelectedPriceBand] = useState('All');
  const [selectedPortal, setSelectedPortal] = useState('All');
  const [selectedBeds, setSelectedBeds] = useState('All');
  const [selectedBaths, setSelectedBaths] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const pageSize = 50;
  const filteredListings = listings;
  const showing = getShowingRange({ total, page, limit: pageSize, received: listings.length });

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

  const fetchListings = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const priceBand = priceBands.find((band) => band.label === selectedPriceBand);
    const searchParams = new URLSearchParams({ page: String(page), limit: String(pageSize), district: selectedDistrict, portal: selectedPortal, beds: selectedBeds, baths: selectedBaths, search: searchTerm });
    if (priceBand && priceBand.min > 0) searchParams.set('minPrice', String(priceBand.min));
    if (priceBand && Number.isFinite(priceBand.max)) searchParams.set('maxPrice', String(priceBand.max));
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/listings?${searchParams}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      if (requestId !== requestSequence.current) return;
      setListings((result.listings || []).map((listing: Listing & { agents?: Listing['agents'] | Listing['agents'][] }) => ({ ...listing, agents: Array.isArray(listing.agents) ? listing.agents[0] : listing.agents })));
      setTotal(result.pagination?.total || 0);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      console.error('Error fetching listings:', error);
      setListings([]);
      setTotal(0);
      setLoadError('Listings could not be loaded.');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, selectedDistrict, selectedPriceBand, selectedPortal, selectedBeds, selectedBaths, searchTerm]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  const handleRefresh = async () => {
    await fetchListings();
    toast.success('Listings data refreshed successfully');
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

    toast.success('Listings exported to CSV successfully');
  };

  const handleEditListing = (listing: Listing) => {
    console.log('Edit button clicked for listing:', listing.id, listing.title);
    if (!listing) {
      console.error('Cannot edit: listing is null or undefined');
      toast.error('Cannot edit listing: listing data is missing');
      return;
    }
    setEditingListing(listing);
    setIsEditModalOpen(true);
    console.log('Edit modal opened for listing:', listing.id);
  };

  const handleSaveListing = (updatedListing: Listing) => {
    setListings((current) => current.map((listing) => listing.id === updatedListing.id ? updatedListing : listing));
    toast.success('Listing details have been updated successfully');
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setEditingListing(null);
  };

  const _getStatusColor = (status: string) => {
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

  const _getPortalColor = (portal: string) => {
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
            {loading ? 'Loading...' : loadError ? 'Listings unavailable' : `Showing ${showing.start}-${showing.end} of ${total} listings`}
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
            onChange={(e) => { setPage(1); setSearchTerm(e.target.value); }}
            className="pl-10 bg-white border-gray-300 text-black placeholder:text-gray-500"
          />
          {searchTerm && (
            <button
              onClick={() => { setPage(1); setSearchTerm(''); }}
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
            {loading ? 'Loading...' : loadError ? 'Listings unavailable' : `Showing ${showing.start}-${showing.end} of ${total} listings`}
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
                    onClick={() => { setPage(1); setSelectedDistrict('All'); }}
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
                          onClick={() => { setPage(1); setSelectedDistrict(district); }}
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
                        onClick={() => { setPage(1); setSelectedPriceBand(band.label); }}
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
                <Select value={selectedBeds} onValueChange={(value) => { setPage(1); setSelectedBeds(value); }}>
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
                    onClick={() => { setPage(1); setSelectedBeds('All'); }}
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
                <Select value={selectedBaths} onValueChange={(value) => { setPage(1); setSelectedBaths(value); }}>
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
                    onClick={() => { setPage(1); setSelectedBaths('All'); }}
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
                        onClick={() => { setPage(1); setSelectedPortal(portal); }}
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
            ) : loadError ? (
              <TableRow className="bg-white">
                <TableCell colSpan={10} className="py-8 text-center text-black bg-white">
                  <p>{loadError}</p>
                  <Button className="mt-3" size="sm" variant="outline" onClick={fetchListings}>Retry</Button>
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

      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700">
          <span>Showing {showing.start}-{showing.end} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={showing.end >= total} onClick={() => setPage((current) => current + 1)}>Next</Button>
          </div>
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
