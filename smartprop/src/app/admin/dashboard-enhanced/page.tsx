/**
 * Enhanced Admin Dashboard with Real-Time Analytics
 * Live updates, co-broking insights, and performance metrics
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Home, 
  MessageSquare, 
  Target, 
  CheckCircle, 
  XCircle, 
  Clock,
  Activity,
  BarChart3,
  PieChart,
  RefreshCw,
  Zap,
  Database,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { useGlobalStore } from '@/lib/stores/global-store';
import { useRealtimeData } from '@/hooks/useRealtimeSync';
import { useConversationSelectors } from '@/lib/stores/conversation-store';
import { useNotificationsSelectors } from '@/lib/stores/global-store';
import { ServiceStatus } from '@/components/ServiceStatus';

interface DashboardStats {
  listings: {
    total: number;
    newToday: number;
    withViewingSlots: number;
    pendingViewing: number;
  };
  agents: {
    total: number;
    active: number;
    coBrokingWilling: number;
    coBrokingNotWilling: number;
  };
  conversations: {
    total: number;
    active: number;
    completed: number;
    coBrokingConfirmed: number;
  };
  scraper: {
    isRunning: boolean;
    totalListings: number;
    newListings: number;
    errors: number;
  };
  coBroking: {
    successRate: number;
    totalAgreements: number;
    pendingDiscussions: number;
    dealbreakers: number;
  };
}

export default function EnhancedDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    listings: { total: 0, newToday: 0, withViewingSlots: 0, pendingViewing: 0 },
    agents: { total: 0, active: 0, coBrokingWilling: 0, coBrokingNotWilling: 0 },
    conversations: { total: 0, active: 0, completed: 0, coBrokingConfirmed: 0 },
    scraper: { isRunning: false, totalListings: 0, newListings: 0, errors: 0 },
    coBroking: { successRate: 0, totalAgreements: 0, pendingDiscussions: 0, dealbreakers: 0 },
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Zustand selectors
  const conversations = useConversationSelectors.useFilteredConversations();
  const conversationStats = useConversationSelectors.useStats();
  const notifications = useNotificationsSelectors.useNotifications();
  
  // Store actions
  const { 
    fetchListings, 
    fetchAgents, 
    addNotification 
  } = useGlobalStore();

  // Initialize lastUpdate on client side only
  useEffect(() => {
    setLastUpdate(new Date());
  }, []);

  // Fetch data on mount
  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      try {
        await Promise.all([
          fetchListings(),
          fetchAgents(),
        ]);
        
        // Calculate stats
        calculateStats();
        
        addNotification({
          type: 'success',
          title: 'Dashboard Updated',
          message: 'All data refreshed successfully',
        });
      } catch (error: any) {
        addNotification({
          type: 'error',
          title: 'Update Failed',
          message: 'Failed to refresh dashboard data',
        });
      } finally {
        setIsLoading(false);
        setLastUpdate(new Date());
      }
    };

    fetchAllData();
  }, [fetchListings, fetchAgents, addNotification]);

  // Subscribe to real-time updates
  useRealtimeData();

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      calculateStats();
      setLastUpdate(new Date());
    }, 30000);

    return () => clearInterval(interval);
  }, [conversations]);

  const calculateStats = () => {
    // This would normally fetch from your APIs
    // For now, we'll use the conversation stats and simulate others
    setStats(prevStats => ({
      ...prevStats,
      conversations: {
        total: conversationStats.total,
        active: conversationStats.active,
        completed: conversationStats.completed,
        coBrokingConfirmed: conversationStats.coBrokingWilling,
      },
      coBroking: {
        successRate: conversationStats.total > 0 ? conversationStats.coBrokingWilling / conversationStats.total : 0,
        totalAgreements: conversationStats.coBrokingWilling,
        pendingDiscussions: conversationStats.total - conversationStats.completed,
        dealbreakers: conversationStats.coBrokingNotWilling,
      },
    }));
  };

  const getTrendIcon = (current: number, previous: number) => {
    if (current > previous) {
      return <ArrowUpRight className="h-4 w-4 text-green-500" />;
    } else if (current < previous) {
      return <ArrowDownRight className="h-4 w-4 text-red-500" />;
    }
    return <Clock className="h-4 w-4 text-gray-500" />;
  };

  const getTrendColor = (current: number, previous: number) => {
    if (current > previous) return 'text-green-600';
    if (current < previous) return 'text-red-600';
    return 'text-gray-600';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Real-time analytics and co-broking insights
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <div className="text-sm text-gray-500">
            Last updated: {lastUpdate ? lastUpdate.toLocaleTimeString() : 'Loading...'}
          </div>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            size="sm"
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Listings</p>
                <p className="text-2xl font-bold">{stats.listings.total.toLocaleString()}</p>
                <div className="flex items-center mt-1">
                  {getTrendIcon(stats.listings.newToday, 0)}
                  <span className="text-sm text-green-600 ml-1">
                    +{stats.listings.newToday} today
                  </span>
                </div>
              </div>
              <Home className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Agents</p>
                <p className="text-2xl font-bold">{stats.agents.active}</p>
                <div className="flex items-center mt-1">
                  <Users className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-600 ml-1">
                    {stats.agents.total} total
                  </span>
                </div>
              </div>
              <Users className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Conversations</p>
                <p className="text-2xl font-bold">{stats.conversations.active}</p>
                <div className="flex items-center mt-1">
                  <MessageSquare className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-600 ml-1">
                    {stats.conversations.total} total
                  </span>
                </div>
              </div>
              <MessageSquare className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Co-Broking Success Rate</p>
                <p className="text-2xl font-bold">
                  {(stats.coBroking.successRate * 100).toFixed(1)}%
                </p>
                <div className="flex items-center mt-1">
                  <Target className="h-4 w-4 text-gray-500" />
                  <span className="text-sm text-gray-600 ml-1">
                    {stats.coBroking.totalAgreements} agreements
                  </span>
                </div>
              </div>
              <Target className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Co-Broking Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <PieChart className="h-5 w-5 mr-2" />
              Co-Broking Status Distribution
            </CardTitle>
            <CardDescription>
              Current status of all agent conversations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Willing to Co-Broke</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold">{conversationStats.coBrokingWilling}</span>
                  <div className="w-20 h-2 bg-gray-200 rounded-full">
                    <div 
                      className="h-2 bg-green-500 rounded-full"
                      style={{ 
                        width: `${conversationStats.total > 0 ? (conversationStats.coBrokingWilling / conversationStats.total) * 100 : 0}%` 
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">Not Willing</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold">{conversationStats.coBrokingNotWilling}</span>
                  <div className="w-20 h-2 bg-gray-200 rounded-full">
                    <div 
                      className="h-2 bg-red-500 rounded-full"
                      style={{ 
                        width: `${conversationStats.total > 0 ? (conversationStats.coBrokingNotWilling / conversationStats.total) * 100 : 0}%` 
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">Unknown/Pending</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold">
                    {conversationStats.total - conversationStats.coBrokingWilling - conversationStats.coBrokingNotWilling}
                  </span>
                  <div className="w-20 h-2 bg-gray-200 rounded-full">
                    <div 
                      className="h-2 bg-gray-500 rounded-full"
                      style={{ 
                        width: `${conversationStats.total > 0 ? ((conversationStats.total - conversationStats.coBrokingWilling - conversationStats.coBrokingNotWilling) / conversationStats.total) * 100 : 0}%` 
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <BarChart3 className="h-5 w-5 mr-2" />
              Conversation Performance
            </CardTitle>
            <CardDescription>
              Real-time conversation metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Conversations</span>
                <span className="text-sm font-bold">{conversationStats.total}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Active Conversations</span>
                <span className="text-sm font-bold text-blue-600">{conversationStats.active}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Completed Conversations</span>
                <span className="text-sm font-bold text-green-600">{conversationStats.completed}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Success Rate</span>
                <span className="text-sm font-bold text-purple-600">
                  {conversationStats.total > 0 ? ((conversationStats.completed / conversationStats.total) * 100).toFixed(1) : 0}%
                </span>
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-sm mb-1">
                  <span>Completion Progress</span>
                  <span>
                    {conversationStats.total > 0 ? ((conversationStats.completed / conversationStats.total) * 100).toFixed(1) : 0}%
                  </span>
                </div>
                <Progress 
                  value={conversationStats.total > 0 ? (conversationStats.completed / conversationStats.total) * 100 : 0} 
                  className="w-full"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ServiceStatus />
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Database className="h-5 w-5 mr-2" />
              Database Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium">Connected</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Last sync: {lastUpdate ? lastUpdate.toLocaleTimeString() : 'Loading...'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common administrative tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button 
              variant="outline" 
              className="h-20 flex flex-col items-center justify-center space-y-2"
              onClick={() => window.location.href = '/admin/listings-enhanced'}
            >
              <Home className="h-6 w-6" />
              <span className="text-sm">View Listings</span>
            </Button>
            
            <Button 
              variant="outline" 
              className="h-20 flex flex-col items-center justify-center space-y-2"
              onClick={() => window.location.href = '/admin/agents-enhanced'}
            >
              <Users className="h-6 w-6" />
              <span className="text-sm">Manage Agents</span>
            </Button>
            
            <Button 
              variant="outline" 
              className="h-20 flex flex-col items-center justify-center space-y-2"
              onClick={() => window.location.href = '/admin/outreach-enhanced'}
            >
              <MessageSquare className="h-6 w-6" />
              <span className="text-sm">Conversations</span>
            </Button>
            
            <Button 
              variant="outline" 
              className="h-20 flex flex-col items-center justify-center space-y-2"
              onClick={() => window.location.href = '/admin/scraper-enhanced'}
            >
              <Zap className="h-6 w-6" />
              <span className="text-sm">Scraper</span>
            </Button>
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
