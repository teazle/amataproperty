'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, Mail, Copy, Home, MapPin, Search, Bed, Bath, Edit, Trash2 } from 'lucide-react';
import EditListingModal from '@/components/EditListingModal';
// Using API endpoint instead of direct Supabase calls

interface ViewingSlot {
  date?: string;
  day?: string;
  time: string;
}

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
    slots?: ViewingSlot[];
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


// No mapping - display district codes as they are in the database

// Standardized district codes D01 to D28 only
const districts = [
  'All',
  // Standard D01-D28 format only
  'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10',
  'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20',
  'D21', 'D22', 'D23', 'D24', 'D25', 'D26', 'D27', 'D28',
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

export default function ListingsPage() {
  const [selectedDistrict, setSelectedDistrict] = useState('All');
  const [selectedPriceBand, setSelectedPriceBand] = useState('All');
  const [selectedPortal, setSelectedPortal] = useState('All');
  const [selectedBeds, setSelectedBeds] = useState('All');
  const [selectedBaths, setSelectedBaths] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Edit functionality state
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  // Delete functionality state
  const [deletingListing, setDeletingListing] = useState<Listing | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch listings from API
  const fetchListings = async () => {
    try {
      console.log('Fetching listings from API...');
      
      const response = await fetch('/api/listings?limit=1000');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.error) {
        console.error('API error:', result.error);
        setListings([]);
        setIsLoading(false);
        return;
      }

      console.log('Successfully fetched listings:', result.listings?.length || 0);
      
      // Transform the data to handle agents properly
      const transformedData = (result.listings || []).map((listing: Listing) => ({
        ...listing,
        agents: Array.isArray(listing.agents) ? listing.agents[0] : listing.agents
      }));
      
      setListings(transformedData);
    } catch (error) {
      console.error('Error fetching listings:', error);
      setListings([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch listings on component mount
  useEffect(() => {
    console.log('Component mounted, fetching listings...');
    fetchListings();
  }, []);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // You could add a toast notification here if needed
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  // Edit functionality handlers
  const handleEditListing = (listing: Listing) => {
    setEditingListing(listing);
    setIsEditModalOpen(true);
  };

  const handleSaveListing = (updatedListing: Listing) => {
    // Update the listing in the local state
    setListings(prevListings => 
      prevListings.map(listing => 
        listing.id === updatedListing.id ? updatedListing : listing
      )
    );
    
    // You could add a toast notification here if needed
    console.log('Listing updated successfully');
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setEditingListing(null);
  };

  // Delete functionality handlers
  const handleDeleteListing = (listing: Listing) => {
    setDeletingListing(listing);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingListing) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/listings/${deletingListing.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete listing');
      }

      // Remove the listing from local state
      setListings(prevListings => 
        prevListings.filter(listing => listing.id !== deletingListing.id)
      );
      
      console.log('Listing deleted successfully');
      setIsDeleteModalOpen(false);
      setDeletingListing(null);
    } catch (error) {
      console.error('Error deleting listing:', error);
      // You could add a toast notification here if needed
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setIsDeleteModalOpen(false);
    setDeletingListing(null);
  };

  // Helper function to display district code as-is
  const getDistrictDisplayName = (districtCode: string | undefined) => {
    if (!districtCode) return 'No District';
    return districtCode;
  };

  const filteredListings = listings.filter(listing => {
    // Match by district code with support for both legacy and new formats
    let districtMatch = false;
    
    if (selectedDistrict === 'All') {
      districtMatch = true;
    } else if (selectedDistrict === 'No District') {
      districtMatch = listing.district === null || listing.district === undefined;
    } else {
      // Handle both legacy and new district formats in database
      const selectedDistrictNum = selectedDistrict.replace('D', ''); // Extract number from "D10" -> "10"
      const listingDistrictNum = listing.district?.replace('D', '') || ''; // Extract number from listing district
      
      districtMatch = listing.district === selectedDistrict || // Exact match (D10 = D10)
                     listingDistrictNum === selectedDistrictNum || // Legacy match (10 = 10, or D10 = 10)
                     listing.district === selectedDistrictNum; // Match legacy format (10) with new format (D10)
    }
    const priceBand = priceBands.find(band => band.label === selectedPriceBand);
    const priceMatch = selectedPriceBand === 'All' || (priceBand && listing.price !== null && listing.price >= priceBand.min && listing.price <= priceBand.max);
    const portalMatch = selectedPortal === 'All' || listing.portal === selectedPortal;
    
    // Beds filter
    const bedsMatch = selectedBeds === 'All' || 
      (selectedBeds === '5+' ? (listing.beds !== null && listing.beds !== undefined && listing.beds >= 5) :
      (listing.beds !== null && listing.beds !== undefined && listing.beds === parseInt(selectedBeds)));
    
    // Baths filter
    const bathsMatch = selectedBaths === 'All' || 
      (selectedBaths === '5+' ? (listing.baths !== null && listing.baths !== undefined && listing.baths >= 5) :
      (listing.baths !== null && listing.baths !== undefined && listing.baths === parseInt(selectedBaths)));
    
    // Search across multiple fields
    const searchMatch = searchTerm === '' || 
      listing.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (listing.address && listing.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (listing.agents?.name && listing.agents.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (listing.property_type && listing.property_type.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (listing.district && listing.district.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return districtMatch && priceMatch && portalMatch && bedsMatch && bathsMatch && searchMatch;
  });

  const formatPrice = (price: number | null) => {
    if (!price) return 'N/A';
    return `$${price.toLocaleString()}`;
  };

  // Helper function to extract key details from the details field
  const parsePropertyDetails = (listing: Listing) => {
    const detailsObj: Record<string, string> = {};
    
    
    // Property type
    if (listing.property_type) {
      detailsObj.type = listing.property_type;
    }
    
    // Size from size_sqft
    if (listing.size_sqft) {
      detailsObj.size = `${listing.size_sqft.toLocaleString()} sqft`;
    }
    
    // PSF from price_psf
    if (listing.price_psf) {
      detailsObj.psf = `${listing.price_psf} psf`;
    }
    
    // Tenure
    if (listing.tenure) {
      detailsObj.tenure = listing.tenure;
    }
    
    // Beds and baths
    if (listing.beds) {
      detailsObj.beds = `${listing.beds} bed${listing.beds > 1 ? 's' : ''}`;
    }
    
    if (listing.baths) {
      detailsObj.baths = `${listing.baths} bath${listing.baths > 1 ? 's' : ''}`;
    }
    
    // Year built
    if (listing.year_built) {
      detailsObj.age = `${new Date().getFullYear() - listing.year_built} years old`;
    }
    
    return detailsObj;
  };

  // Helper function to format project details into readable sections
  const _parseProjectDetails = (projectDetails: string | undefined) => {
    if (!projectDetails) return null;
    
    const sections: Record<string, string[]> = {};
    const lines = projectDetails.split('\n').filter(line => line.trim());
    
    let currentSection = 'General';
    const sectionKeywords = ['Tenure', 'Age', 'Rental Yield', 'Capital Gain', 'Transactions', 'Sale Volume', 'Rental Volume'];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // Check if this line starts a new section
      const foundSection = sectionKeywords.find(keyword => 
        trimmedLine.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (foundSection) {
        currentSection = foundSection;
        if (!sections[currentSection]) sections[currentSection] = [];
      }
      
      if (!sections[currentSection]) sections[currentSection] = [];
      sections[currentSection].push(trimmedLine);
    }
    
    return sections;
  };

  // Helper function to format property details into structured sections
  const _parsePropertyDetailsStructured = (details: string | undefined) => {
    if (!details) return null;
    
    const sections: Record<string, string[]> = {};
    const lines = details.split('\n').filter(line => line.trim());
    
    let currentSection = 'General';
    const sectionKeywords = ['Details', 'Location', 'Type', 'Tenure', 'Size', 'Furnishing', 'Completion', 'Units', 'PSF'];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // Check if this line starts a new section
      const foundSection = sectionKeywords.find(keyword => 
        trimmedLine.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (foundSection) {
        currentSection = foundSection;
        if (!sections[currentSection]) sections[currentSection] = [];
      }
      
      if (!sections[currentSection]) sections[currentSection] = [];
      sections[currentSection].push(trimmedLine);
    }
    
    return sections;
  };

  // Helper function to truncate long text
  const _truncateText = (text: string | undefined, maxLength: number = 100) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  // Helper function to get next occurrence of a day
  const getNextDayOfWeek = (dayName: string): Date => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.findIndex(d => dayName.toLowerCase().includes(d));
    
    if (targetDay === -1) {
      // If "today" or "tomorrow"
      if (dayName.toLowerCase().includes('today')) {
        return new Date();
      } else if (dayName.toLowerCase().includes('tomorrow')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
      }
      // Default to today
      return new Date();
    }

    const today = new Date();
    const currentDay = today.getDay();
    const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7;
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntilTarget);
    
    return targetDate;
  };

  // Helper function to format viewing timeslots with actual dates
  const formatViewingTimeslots = (listing: Listing): string => {
    // If structured data exists, always use it to display actual dates
    if (listing.viewing_timeslots_structured && 
        listing.viewing_timeslots_structured.available && 
        listing.viewing_timeslots_structured.slots) {
      
      const formattedSlots = listing.viewing_timeslots_structured.slots.map((slot) => {
        let dateStr = '';
        
        // Parse date - structured data already has ISO dates in Singapore time context
        if (slot.date) {
          const date = new Date(slot.date);
          // No timezone conversion needed - date is already stored in SG context
          dateStr = date.toLocaleDateString('en-SG', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric'
          });
        } else if (slot.day) {
          // Handle day names like "Monday" for old entries without dates
          const date = getNextDayOfWeek(slot.day);
          dateStr = date.toLocaleDateString('en-SG', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric'
          });
        }
        
        const timeStr = slot.time || '';
        return `${dateStr} ${timeStr}`.trim();
      }).join(', ');
      
      return formattedSlots || listing.viewing_timeslots || 'N/A';
    }
    
    // Fall back to text field if no structured data (for old entries)
    return listing.viewing_timeslots || 'N/A';
  };

  // Toggle expanded row
  const _toggleExpanded = (listingId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(listingId)) {
      newExpanded.delete(listingId);
    } else {
      newExpanded.add(listingId);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Listings</h1>
        <p className="text-gray-800 mt-2">Browse and filter property listings with agent contact information</p>
      </div>

      <Card className="bg-white">
        <CardHeader className="bg-white">
          <CardTitle className="text-black">Property Listings</CardTitle>
          <CardDescription className="text-gray-800">
            {isLoading ? 'Loading...' : `${filteredListings.length} listing${filteredListings.length !== 1 ? 's' : ''} found`}
          </CardDescription>
        </CardHeader>
        <CardContent className="bg-white">
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
                  <Bed className="h-4 w-4 text-indigo-600" />
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
                  <Bath className="h-4 w-4 text-teal-600" />
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
                {isLoading ? (
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
                    const _propertyDetails = parsePropertyDetails(listing);
                    
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
                            <div className="flex gap-1">
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
                              <button 
                                type="button"
                                className="h-6 w-6 p-0 border rounded hover:bg-red-100 text-red-600 flex items-center justify-center"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteListing(listing);
                                }}
                                title="Delete listing"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
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
                                    // Log full listing data to console for debugging
                                    console.log('📊 Full Listing Data:', {
                                      id: listing.id,
                                      title: listing.title,
                                      price: listing.price,
                                      portal: listing.portal,
                                      property_type: listing.property_type,
                                      address: listing.address,
                                      district: listing.district,
                                      beds: listing.beds,
                                      baths: listing.baths,
                                      size_sqft: listing.size_sqft,
                                      price_psf: listing.price_psf,
                                      year_built: listing.year_built,
                                      tenure: listing.tenure,
                                      viewing_status: listing.viewing_status,
                                      viewing_requested_at: listing.viewing_requested_at,
                                      viewing_timeslots: listing.viewing_timeslots,
                                      viewing_timeslots_structured: listing.viewing_timeslots_structured,
                                      posted_at: listing.posted_at,
                                      scraped_at: listing.scraped_at,
                                      url: listing.url,
                                      agent: listing.agents,
                                      agent_id: listing.agent_id,
                                    });
                                  } else {
                                    detailsRow.style.display = 'none';
                                  }
                                }
                              }}
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
                              <div className="flex flex-wrap gap-1 justify-center">
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
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
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
                              
                              {(listing.viewing_status || listing.viewing_timeslots || listing.viewing_requested_at || listing.viewing_timeslots_structured) && (
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
                                  {(listing.viewing_timeslots_structured || listing.viewing_timeslots) && (
                                    <div className="space-y-1">
                                      <p className="text-gray-800">📅 Viewing Timeslots:</p>
                                      <div className="text-black font-medium break-words whitespace-pre-wrap">
                                        {listing.viewing_timeslots_structured && listing.viewing_timeslots_structured.available && listing.viewing_timeslots_structured.slots ? (
                                          <div className="space-y-1">
                                            {listing.viewing_timeslots_structured.slots.map((slot, index) => {
                                              let dateStr = '';
                                              if (slot.date) {
                                                const date = new Date(slot.date);
                                                dateStr = date.toLocaleDateString('en-SG', { 
                                                  weekday: 'short', 
                                                  month: 'short', 
                                                  day: 'numeric'
                                                });
                                              } else if (slot.day) {
                                                const date = getNextDayOfWeek(slot.day);
                                                dateStr = date.toLocaleDateString('en-SG', { 
                                                  weekday: 'short', 
                                                  month: 'short', 
                                                  day: 'numeric'
                                                });
                                              }
                                              return (
                                                <Badge key={index} variant="outline" className="mr-1 mb-1">
                                                  {dateStr} {slot.time}
                                                </Badge>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <p>{listing.viewing_timeslots || 'N/A'}</p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {listing.outreach && listing.outreach.length > 0 && (
                                <div className="space-y-2">
                                  <h4 className="font-semibold text-black border-b pb-1">🤝 Co-broking Status</h4>
                                  <div className="space-y-2">
                                    {listing.outreach.map((outreach, index) => (
                                      <div key={index} className="space-y-1">
                                        <div className="flex items-center gap-2">
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
                                            <span className="text-xs text-gray-600">
                                              {outreach.conversation_phase.replace('_', ' ')}
                                            </span>
                                          )}
                                        </div>
                                        {outreach.co_broking_notes && (
                                          <p className="text-xs text-gray-700 italic">
                                            <span className="text-gray-800">Notes:</span> {outreach.co_broking_notes}
                                          </p>
                                        )}
                                        {outreach.last_message_at && (
                                          <p className="text-xs text-gray-600">
                                            <span className="text-gray-800">Last Message:</span> {new Date(outreach.last_message_at).toLocaleString()}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              <div className="space-y-2">
                                <h4 className="font-semibold text-black border-b pb-1">📅 Dates & Links</h4>
                                <p><span className="text-gray-800">Posted At:</span> <span className="text-black">{listing.posted_at ? new Date(listing.posted_at).toLocaleDateString() : 'N/A'}</span></p>
                                <p><span className="text-gray-800">Scraped At:</span> <span className="text-black">{listing.scraped_at ? new Date(listing.scraped_at).toLocaleDateString() : 'N/A'}</span></p>
                                <p><span className="text-gray-800">Listing ID:</span> <span className="text-black">{listing.id}</span></p>
                                {listing.url && (
                                  <div className="space-y-1">
                                    <span className="text-gray-800">Original URL:</span>
                                    <div className="break-all overflow-hidden">
                                      <a href={listing.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                                        {listing.url}
                                      </a>
                                    </div>
                                  </div>
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
        </CardContent>
      </Card>

      {/* Edit Listing Modal */}
      <EditListingModal
        listing={editingListing}
        isOpen={isEditModalOpen}
        onClose={handleCloseEditModal}
        onSave={handleSaveListing}
      />

      {/* Delete Confirmation Dialog */}
      {isDeleteModalOpen && deletingListing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Delete Listing</h3>
                <p className="text-sm text-gray-500">This action cannot be undone.</p>
              </div>
            </div>
            
            <div className="mb-6">
              <p className="text-gray-700">
                Are you sure you want to delete the listing <strong>&quot;{deletingListing.title}&quot;</strong>?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This will permanently remove the listing and all associated data.
              </p>
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Listing
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
