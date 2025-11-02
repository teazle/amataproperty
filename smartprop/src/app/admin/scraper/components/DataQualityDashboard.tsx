'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DataQualityDashboardProps {
  metrics: {
    completenessScore: number;
    phoneValidationRate: number;
    duplicatesToday: number;
    staleListings: number;
  };
}

export function DataQualityDashboard({ metrics }: DataQualityDashboardProps) {
  const qualityCards = [
    {
      title: 'Data Completeness',
      value: `${metrics.completenessScore}%`,
      description: 'Fields filled in listings',
      icon: '📊',
      color: metrics.completenessScore >= 90 ? 'text-green-600' : metrics.completenessScore >= 70 ? 'text-yellow-600' : 'text-red-600'
    },
    {
      title: 'Phone Validation',
      value: `${metrics.phoneValidationRate}%`,
      description: 'Listings with phone numbers',
      icon: '📱',
      color: metrics.phoneValidationRate >= 95 ? 'text-green-600' : metrics.phoneValidationRate >= 80 ? 'text-yellow-600' : 'text-red-600'
    },
    {
      title: 'Duplicates Today',
      value: metrics.duplicatesToday.toString(),
      description: 'Updated existing listings',
      icon: '🔄',
      color: 'text-blue-600'
    },
    {
      title: 'Stale Listings',
      value: metrics.staleListings.toString(),
      description: 'Not seen in 7+ days',
      icon: '⏰',
      color: metrics.staleListings > 100 ? 'text-red-600' : 'text-gray-600'
    }
  ];

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-semibold text-gray-900">Data Quality Overview</h2>
        <p className="text-sm text-gray-700">Last 100 listings analyzed</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {qualityCards.map((card, index) => (
          <Card key={index}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <span>{card.icon}</span>
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${card.color}`}>
                {card.value}
              </div>
              <p className="text-xs text-gray-700 mt-1">
                {card.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

