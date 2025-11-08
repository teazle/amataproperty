'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Save, X } from 'lucide-react';

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
}

interface EditListingModalProps {
  listing: Listing | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedListing: Listing) => void;
}

const districts = [
  'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10',
  'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20',
  'D21', 'D22', 'D23', 'D24', 'D25', 'D26', 'D27', 'D28'
];

const propertyTypes = [
  'Condominium',
  'Apartment',
  'Terrace',
  'Semi-Detached',
  'Detached',
  'Executive Condominium',
  'HDB',
  'Landed',
  'Commercial',
  'Industrial',
  'Mixed Use'
];

const tenureOptions = [
  'Freehold',
  '99 years',
  '999 years',
  '60 years',
  '30 years'
];

export default function EditListingModal({ listing, isOpen, onClose, onSave }: EditListingModalProps) {
  const [formData, setFormData] = useState({
    // Listing details
    title: '',
    price: '',
    district: '',
    property_type: '',
    address: '',
    beds: '',
    baths: '',
    size_sqft: '',
    price_psf: '',
    year_built: '',
    tenure: '',
    
    // Agent details
    agent_name: '',
    agent_phone: '',
    agent_email: '',
    agent_agency: '',
    agent_cea_reg_no: ''
  });

  const [isLoading, setIsLoading] = useState(false);

  // Initialize form data when listing changes
  useEffect(() => {
    if (listing) {
      setFormData({
        title: listing.title || '',
        price: listing.price?.toString() || '',
        district: listing.district || '',
        property_type: listing.property_type || '',
        address: listing.address || '',
        beds: listing.beds?.toString() || '',
        baths: listing.baths?.toString() || '',
        size_sqft: listing.size_sqft?.toString() || '',
        price_psf: listing.price_psf?.toString() || '',
        year_built: listing.year_built?.toString() || '',
        tenure: listing.tenure || '',
        
        agent_name: listing.agents?.name || '',
        agent_phone: listing.agents?.phone || '',
        agent_email: listing.agents?.email || '',
        agent_agency: listing.agents?.agency || '',
        agent_cea_reg_no: listing.agents?.cea_reg_no || ''
      });
    }
  }, [listing]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (!listing) return;

    setIsLoading(true);
    try {
      const updateData = {
        // Only include fields that have values
        ...(formData.title && { title: formData.title }),
        ...(formData.price && { price: parseInt(formData.price) }),
        ...(formData.district && { district: formData.district }),
        ...(formData.property_type && { property_type: formData.property_type }),
        ...(formData.address && { address: formData.address }),
        ...(formData.beds && { beds: parseInt(formData.beds) }),
        ...(formData.baths && { baths: parseInt(formData.baths) }),
        ...(formData.size_sqft && { size_sqft: parseFloat(formData.size_sqft) }),
        ...(formData.price_psf && { price_psf: parseFloat(formData.price_psf) }),
        ...(formData.year_built && { year_built: parseInt(formData.year_built) }),
        ...(formData.tenure && { tenure: formData.tenure }),
        
        // Agent details
        ...(formData.agent_name && { agent_name: formData.agent_name }),
        ...(formData.agent_phone && { agent_phone: formData.agent_phone }),
        ...(formData.agent_email && { agent_email: formData.agent_email }),
        ...(formData.agent_agency && { agent_agency: formData.agent_agency }),
        ...(formData.agent_cea_reg_no && { agent_cea_reg_no: formData.agent_cea_reg_no })
      };

      const response = await fetch(`/api/listings/${listing.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update listing');
      }

      const result = await response.json();
      toast.success('Listing updated successfully');
      onSave(result.listing);
      onClose();
    } catch (error: any) {
      console.error('Error updating listing:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update listing');
    } finally {
      setIsLoading(false);
    }
  };

  // Don't render if not open or no listing
  if (!isOpen || !listing) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto z-[100]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Edit Listing</span>
            <span className="text-sm font-normal text-gray-500">({listing.portal})</span>
          </DialogTitle>
          <DialogDescription>
            Update the listing details and agent information. Leave fields empty to keep current values.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Basic Information</h3>
            
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="Property title"
              />
            </div>

            <div>
              <Label htmlFor="price">Price (SGD)</Label>
              <Input
                id="price"
                type="number"
                value={formData.price}
                onChange={(e) => handleInputChange('price', e.target.value)}
                placeholder="e.g., 1500000"
              />
            </div>

            <div>
              <Label htmlFor="district">District</Label>
              <Select value={formData.district} onValueChange={(value) => handleInputChange('district', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select district" />
                </SelectTrigger>
                <SelectContent>
                  {districts.map((district) => (
                    <SelectItem key={district} value={district}>
                      {district}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="property_type">Property Type</Label>
              <Select value={formData.property_type} onValueChange={(value) => handleInputChange('property_type', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select property type" />
                </SelectTrigger>
                <SelectContent>
                  {propertyTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="Property address"
              />
            </div>
          </div>

          {/* Property Details */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Property Details</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="beds">Bedrooms</Label>
                <Input
                  id="beds"
                  type="number"
                  value={formData.beds}
                  onChange={(e) => handleInputChange('beds', e.target.value)}
                  placeholder="e.g., 3"
                />
              </div>
              <div>
                <Label htmlFor="baths">Bathrooms</Label>
                <Input
                  id="baths"
                  type="number"
                  value={formData.baths}
                  onChange={(e) => handleInputChange('baths', e.target.value)}
                  placeholder="e.g., 2"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="size_sqft">Size (sqft)</Label>
              <Input
                id="size_sqft"
                type="number"
                value={formData.size_sqft}
                onChange={(e) => handleInputChange('size_sqft', e.target.value)}
                placeholder="e.g., 1200"
              />
            </div>

            <div>
              <Label htmlFor="price_psf">Price PSF</Label>
              <Input
                id="price_psf"
                type="number"
                value={formData.price_psf}
                onChange={(e) => handleInputChange('price_psf', e.target.value)}
                placeholder="e.g., 1250"
              />
            </div>

            <div>
              <Label htmlFor="year_built">Year Built</Label>
              <Input
                id="year_built"
                type="number"
                value={formData.year_built}
                onChange={(e) => handleInputChange('year_built', e.target.value)}
                placeholder="e.g., 2020"
              />
            </div>

            <div>
              <Label htmlFor="tenure">Tenure</Label>
              <Select value={formData.tenure} onValueChange={(value) => handleInputChange('tenure', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tenure" />
                </SelectTrigger>
                <SelectContent>
                  {tenureOptions.map((tenure) => (
                    <SelectItem key={tenure} value={tenure}>
                      {tenure}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Agent Information */}
          <div className="space-y-4 md:col-span-2">
            <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Agent Information</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="agent_name">Agent Name</Label>
                <Input
                  id="agent_name"
                  value={formData.agent_name}
                  onChange={(e) => handleInputChange('agent_name', e.target.value)}
                  placeholder="Agent name"
                />
              </div>
              <div>
                <Label htmlFor="agent_phone">Phone Number</Label>
                <Input
                  id="agent_phone"
                  value={formData.agent_phone}
                  onChange={(e) => handleInputChange('agent_phone', e.target.value)}
                  placeholder="e.g., +65 9123 4567"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="agent_email">Email</Label>
                <Input
                  id="agent_email"
                  type="email"
                  value={formData.agent_email}
                  onChange={(e) => handleInputChange('agent_email', e.target.value)}
                  placeholder="agent@example.com"
                />
              </div>
              <div>
                <Label htmlFor="agent_agency">Agency</Label>
                <Input
                  id="agent_agency"
                  value={formData.agent_agency}
                  onChange={(e) => handleInputChange('agent_agency', e.target.value)}
                  placeholder="Agency name"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="agent_cea_reg_no">CEA Registration Number</Label>
              <Input
                id="agent_cea_reg_no"
                value={formData.agent_cea_reg_no}
                onChange={(e) => handleInputChange('agent_cea_reg_no', e.target.value)}
                placeholder="e.g., R123456A"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
