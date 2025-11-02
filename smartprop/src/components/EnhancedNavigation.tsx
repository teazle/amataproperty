/**
 * Enhanced Navigation Component
 * Quick access to all enhanced pages with real-time indicators
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Home, 
  Users, 
  MessageSquare, 
  Zap, 
  BarChart3, 
  Target,
  Activity,
  CheckCircle,
  ArrowRight
} from 'lucide-react';
import { useConversationSelectors } from '@/lib/stores/conversation-store';
import { useGlobalStore } from '@/lib/stores/global-store';

export function EnhancedNavigation() {
  const conversationStats = useConversationSelectors.useStats();
  const { notifications } = useGlobalStore();

  const enhancedPages = [
    {
      title: 'Dashboard',
      description: 'Real-time analytics and system overview',
      href: '/admin/dashboard-enhanced',
      icon: BarChart3,
      color: 'text-blue-500',
      bgColor: 'bg-blue-100',
      stats: `${conversationStats.total} conversations`,
      badge: conversationStats.active > 0 ? `${conversationStats.active} active` : null,
    },
    {
      title: 'Listings',
      description: 'Property listings with live updates',
      href: '/admin/listings-enhanced',
      icon: Home,
      color: 'text-green-500',
      bgColor: 'bg-green-100',
      stats: 'Real-time filtering',
      badge: 'Enhanced',
    },
    {
      title: 'Agents',
      description: 'Agent management with co-broking analytics',
      href: '/admin/agents-enhanced',
      icon: Users,
      color: 'text-purple-500',
      bgColor: 'bg-purple-100',
      stats: 'Co-broking insights',
      badge: `${conversationStats.coBrokingWilling} willing`,
    },
    {
      title: 'Conversations',
      description: 'Real-time co-broking conversations',
      href: '/admin/outreach-enhanced',
      icon: MessageSquare,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-100',
      stats: `${conversationStats.active} active chats`,
      badge: conversationStats.active > 0 ? 'Live' : null,
    },
    {
      title: 'Scraper',
      description: 'Live scraping progress and job management',
      href: '/admin/scraper-enhanced',
      icon: Zap,
      color: 'text-orange-500',
      bgColor: 'bg-orange-100',
      stats: 'Real-time progress',
      badge: 'Live',
    },
    {
      title: 'Co-Broking Analytics',
      description: 'Deep insights into co-broking success rates',
      href: '/admin/cobroking-analytics',
      icon: Target,
      color: 'text-red-500',
      bgColor: 'bg-red-100',
      stats: 'Success rate analysis',
      badge: `${(conversationStats.total > 0 ? (conversationStats.coBrokingWilling / conversationStats.total) * 100 : 0).toFixed(1)}%`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          Enhanced Admin Panel
        </h1>
        <p className="text-gray-600 text-lg">
          Real-time co-broking management with live updates
        </p>
        <div className="flex items-center justify-center mt-4 space-x-4">
          <div className="flex items-center space-x-2">
            <Activity className="h-4 w-4 text-green-500 animate-pulse" />
            <span className="text-sm text-gray-600">Live Updates</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircle className="h-4 w-4 text-blue-500" />
            <span className="text-sm text-gray-600">Co-Broking Status Tracking</span>
          </div>
        </div>
      </div>

      {/* Enhanced Pages Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {enhancedPages.map((page, index) => {
          const Icon = page.icon;
          return (
            <Card key={index} className="hover:shadow-lg transition-shadow duration-200">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className={`p-3 rounded-lg ${page.bgColor}`}>
                    <Icon className={`h-6 w-6 ${page.color}`} />
                  </div>
                  {page.badge && (
                    <Badge variant="secondary" className="animate-pulse">
                      {page.badge}
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-xl">{page.title}</CardTitle>
                <CardDescription>{page.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-sm text-gray-600">
                    {page.stats}
                  </div>
                  <Link href={page.href}>
                    <Button className="w-full" variant="outline">
                      <span>Open {page.title}</span>
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Activity className="h-5 w-5 mr-2" />
            Live System Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {conversationStats.total}
              </div>
              <div className="text-sm text-gray-600">Total Conversations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {conversationStats.active}
              </div>
              <div className="text-sm text-gray-600">Active Chats</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {conversationStats.coBrokingWilling}
              </div>
              <div className="text-sm text-gray-600">Willing to Co-Broke</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {conversationStats.completed}
              </div>
              <div className="text-sm text-gray-600">Completed</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 space-y-2 z-50">
          {notifications.slice(0, 3).map((notification) => (
            <div
              key={notification.id}
              className={`p-4 rounded-lg shadow-lg max-w-sm ${
                notification.type === 'success' ? 'bg-green-500 text-white' :
                notification.type === 'error' ? 'bg-red-500 text-white' :
                notification.type === 'warning' ? 'bg-yellow-500 text-white' :
                'bg-blue-500 text-white'
              }`}
            >
              <div className="font-medium">{notification.title}</div>
              <div className="text-sm">{notification.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
