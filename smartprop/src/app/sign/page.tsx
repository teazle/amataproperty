'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

function SignFormContent() {
  const searchParams = useSearchParams();
  const [formData, setFormData] = useState({
    aid: searchParams.get('aid') || '',
    lid: searchParams.get('lid') || '',
    commissionSplit: '50/50',
    buyerRequirements: '',
    listingUrl: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/sign/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to submit agreement');
      }

      const result = await response.json();
      
      // Show success message
      toast.success('Agreement submitted successfully!');
      
      // Open the generated summary in a new window
      if (result.summaryUrl) {
        window.open(result.summaryUrl, '_blank');
      }
      
    } catch (error) {
      console.error('Error submitting agreement:', error);
      toast.error('Failed to submit agreement. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <Card>
          <CardHeader>
            <CardTitle>Co-broking Agreement</CardTitle>
            <CardDescription>
              Complete the agreement details and submit for processing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Agent ID and Listing ID */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="aid" className="text-sm font-medium">
                    Agent ID
                  </label>
                  <Input
                    id="aid"
                    type="text"
                    value={formData.aid}
                    onChange={(e) => handleInputChange('aid', e.target.value)}
                    placeholder="Enter agent ID"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="lid" className="text-sm font-medium">
                    Listing ID
                  </label>
                  <Input
                    id="lid"
                    type="text"
                    value={formData.lid}
                    onChange={(e) => handleInputChange('lid', e.target.value)}
                    placeholder="Enter listing ID"
                    required
                  />
                </div>
              </div>

              {/* Commission Split */}
              <div className="space-y-2">
                <label htmlFor="commissionSplit" className="text-sm font-medium">
                  Commission Split
                </label>
                <Input
                  id="commissionSplit"
                  type="text"
                  value={formData.commissionSplit}
                  onChange={(e) => handleInputChange('commissionSplit', e.target.value)}
                  placeholder="e.g., 50/50"
                />
                <p className="text-xs text-gray-500">
                  Default: 50/50 (Agent/Listing Agent)
                </p>
              </div>

              {/* Buyer Requirements */}
              <div className="space-y-2">
                <label htmlFor="buyerRequirements" className="text-sm font-medium">
                  Buyer Requirements
                </label>
                <textarea
                  id="buyerRequirements"
                  value={formData.buyerRequirements}
                  onChange={(e) => handleInputChange('buyerRequirements', e.target.value)}
                  placeholder="Describe buyer requirements, budget, timeline, etc."
                  className="w-full min-h-[120px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
                  required
                />
              </div>

              {/* Listing URL */}
              <div className="space-y-2">
                <label htmlFor="listingUrl" className="text-sm font-medium">
                  Listing URL
                </label>
                <Input
                  id="listingUrl"
                  type="url"
                  value={formData.listingUrl}
                  onChange={(e) => handleInputChange('listingUrl', e.target.value)}
                  placeholder="https://example.com/listing"
                  required
                />
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Processing...' : 'Submit Agreement'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SignPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    }>
      <SignFormContent />
    </Suspense>
  );
}
