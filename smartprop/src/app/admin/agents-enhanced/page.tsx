/**
 * Enhanced Agents Page with Real-Time Co-Broking Analytics
 * Live updates, co-broking patterns, and performance insights
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { 
  Download, 
  RefreshCw, 
  Users, 
  MessageSquare, 
  TrendingUp,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  BarChart3,
  Phone,
  Mail
} from 'lucide-react';
import { useAgentsSelectors, useGlobalStore } from '@/lib/stores/global-store';
import { useNotificationsSelectors } from '@/lib/stores/global-store';
import { useRealtimeAgents } from '@/hooks/useRealtimeSync';

interface AgentWithStats {
  id: string;
  name: string;
  phone: string;
  email?: string;
  agency?: string;
  cea_reg_no?: string;
  source: string;
  last_seen_at: string;
  total_listings?: number;
  active_conversations?: number;
  co_broking_stats?: {
    willing: number;
    not_willing: number;
    needs_discussion: number;
    unknown: number;
    total: number;
    success_rate: number;
  };
  typically_co_brokes?: boolean;
  co_broking_notes?: string;
}

export default function EnhancedAgentsPage() {
  const [viewMode, setViewMode] = useState<'list' | 'analytics'>('list');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  
  // Zustand selectors
  const agentsFromStore = useAgentsSelectors.useFilteredAgents();
  const agents = agentsFromStore as AgentWithStats[];
  const loading = useAgentsSelectors.useLoading();
  const filters = useAgentsSelectors.useFilters();
  const notifications = useNotificationsSelectors.useNotifications();
  
  // Store actions
  const { 
    fetchAgents, 
    setFilters, 
    addNotification 
  } = useGlobalStore();

  // Fetch agents on mount
  useEffect(() => {
    fetchAgents();
  }, []); // Only run once on mount

  // Subscribe to real-time updates
  useRealtimeAgents();

  // Real-time updates
  useEffect(() => {
    if (agents.length > 0) {
      addNotification({
        type: 'info',
        title: 'Agents Updated',
        message: `${agents.length} agents loaded successfully`,
      });
    }
  }, [agents.length, addNotification]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters({ [key]: value });
  };

  const handleExport = () => {
    const csvContent = [
      ['Name', 'Phone', 'Email', 'Agency', 'Source', 'Listings', 'Co-Broking Rate', 'Last Seen'],
      ...agents.map(agent => [
        agent.name,
        agent.phone,
        agent.email || '',
        agent.agency || '',
        agent.source,
        (agent.total_listings || 0).toString(),
        agent.co_broking_stats?.success_rate ? `${(agent.co_broking_stats.success_rate * 100).toFixed(1)}%` : 'N/A',
        new Date(agent.last_seen_at).toLocaleDateString(),
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agents-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    addNotification({
      type: 'success',
      title: 'Export Complete',
      message: 'Agents exported to CSV successfully',
    });
  };

  const getCoBrokingRate = (agent: AgentWithStats) => {
    if (!agent.co_broking_stats || agent.co_broking_stats.total === 0) {
      return { rate: 0, color: 'text-gray-500', bgColor: 'bg-gray-100' };
    }
    
    const rate = agent.co_broking_stats.success_rate;
    if (rate >= 0.7) return { rate, color: 'text-green-600', bgColor: 'bg-green-100' };
    if (rate >= 0.4) return { rate, color: 'text-yellow-600', bgColor: 'bg-yellow-100' };
    return { rate, color: 'text-red-600', bgColor: 'bg-red-100' };
  };

  const getCoBrokingIcon = (agent: AgentWithStats) => {
    if (agent.typically_co_brokes === true) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    if (agent.typically_co_brokes === false) {
      return <XCircle className="h-4 w-4 text-red-500" />;
    }
    return <Clock className="h-4 w-4 text-gray-500" />;
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'propertyguru':
        return 'bg-blue-100 text-blue-800';
      case 'edgeprop':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Calculate analytics
  const analytics = {
    totalAgents: agents.length,
    withListings: agents.filter(agent => (agent.total_listings || 0) > 0).length,
    activeConversations: agents.filter(agent => (agent.active_conversations || 0) > 0).length,
    coBrokingWilling: agents.filter(agent => agent.typically_co_brokes === true).length,
    coBrokingNotWilling: agents.filter(agent => agent.typically_co_brokes === false).length,
    averageCoBrokingRate: agents.reduce((acc, agent) => {
      const rate = agent.co_broking_stats?.success_rate || 0;
      return acc + rate;
    }, 0) / agents.length || 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Property Agents</h1>
          <p className="text-gray-600 mt-2">
            {loading ? 'Loading...' : `${agents.length} agents found`}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            onClick={() => setViewMode(viewMode === 'list' ? 'analytics' : 'list')}
            variant="outline"
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            {viewMode === 'list' ? 'Analytics' : 'List'}
          </Button>
          <Button onClick={fetchAgents} variant="outline" disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handleExport} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Agents</p>
                <p className="text-2xl font-bold">{analytics.totalAgents}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Target className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">With Listings</p>
                <p className="text-2xl font-bold">{analytics.withListings}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Active Chats</p>
                <p className="text-2xl font-bold">{analytics.activeConversations}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Co-Broking Willing</p>
                <p className="text-2xl font-bold">{analytics.coBrokingWilling}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Co-Broking Rate</p>
                <p className="text-2xl font-bold">
                  {(analytics.averageCoBrokingRate * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search agents..."
                value={filters.searchTerm}
                onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="agency">Agency</Label>
              <Select 
                value={filters.agency} 
                onValueChange={(value) => handleFilterChange('agency', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Agencies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agencies</SelectItem>
                  {/* Add agencies dynamically */}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="source">Source</Label>
              <Select 
                value={filters.source} 
                onValueChange={(value) => handleFilterChange('source', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="propertyguru">PropertyGuru</SelectItem>
                  <SelectItem value="edgeprop">EdgeProp</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agents Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Listings</TableHead>
                  <TableHead>Co-Broking</TableHead>
                  <TableHead>Success Rate</TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => {
                  const coBrokingRate = getCoBrokingRate(agent);
                  return (
                    <TableRow key={agent.id}>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getCoBrokingIcon(agent)}
                          <div>
                            <div className="font-medium">{agent.name}</div>
                            <div className="text-sm text-gray-500">{agent.agency || 'No agency'}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center text-sm">
                            <Phone className="h-3 w-3 mr-1" />
                            {agent.phone}
                          </div>
                          {agent.email && (
                            <div className="flex items-center text-sm text-gray-500">
                              <Mail className="h-3 w-3 mr-1" />
                              {agent.email}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getSourceColor(agent.source)}>
                          {agent.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>Total: {agent.total_listings || 0}</div>
                          <div className="text-gray-500">Active: {agent.active_conversations || 0}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getCoBrokingIcon(agent)}
                          <span className="text-sm">
                            {agent.typically_co_brokes === true ? 'Willing' :
                             agent.typically_co_brokes === false ? 'Not Willing' : 'Unknown'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className={`text-sm font-medium ${coBrokingRate.color}`}>
                              {(coBrokingRate.rate * 100).toFixed(1)}%
                            </span>
                            <div className={`w-16 h-2 rounded-full ${coBrokingRate.bgColor}`}>
                              <div 
                                className={`h-2 rounded-full ${
                                  coBrokingRate.rate >= 0.7 ? 'bg-green-500' :
                                  coBrokingRate.rate >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${coBrokingRate.rate * 100}%` }}
                              />
                            </div>
                          </div>
                          {agent.co_broking_stats && (
                            <div className="text-xs text-gray-500">
                              {agent.co_broking_stats.willing}/{agent.co_broking_stats.total} willing
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-500">
                          {new Date(agent.last_seen_at).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedAgentId(agent.id)}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              addNotification({
                                type: 'info',
                                title: 'Agent Details',
                                message: `Viewing details for ${agent.name}`,
                              });
                            }}
                          >
                            <Target className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
