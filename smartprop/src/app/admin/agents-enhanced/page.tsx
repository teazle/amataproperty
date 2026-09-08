/**
 * Enhanced Agents Page with Real-Time Co-Broking Analytics
 * Live updates, co-broking patterns, and performance insights
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from '@/components/ui/table';
import { getShowingRange } from '@/lib/admin-browsing';
import {
BarChart3,
CheckCircle,
Clock,
Download,
Mail,
MessageSquare,
Phone,
RefreshCw,
Target,
TrendingUp,
Users,
XCircle
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';

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
  const [_selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ searchTerm: '', agency: 'all', source: 'all' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const [notifications, setNotifications] = useState<Array<{ id: string; type: 'success' | 'error' | 'warning' | 'info'; title: string; message: string }>>([]);
  const pageSize = 50;
  const notify = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    setNotifications((current) => [...current, { id: crypto.randomUUID(), type, title, message }].slice(-3));
  }, []);
  const fetchAgents = useCallback(async () => {
    const requestId = ++requestSequence.current;
    const searchParams = new URLSearchParams({ page: String(page), limit: String(pageSize), search: filters.searchTerm, agency: filters.agency, source: filters.source });
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/agents?${searchParams}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      if (requestId !== requestSequence.current) return;
      setAgents(result.agents || []);
      setTotal(result.pagination?.total || 0);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      console.error('Error fetching agents:', error);
      setAgents([]);
      setTotal(0);
      setLoadError('Agents could not be loaded.');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [filters.agency, filters.searchTerm, filters.source, page]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleFilterChange = (key: 'searchTerm' | 'agency' | 'source', value: string) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const showing = getShowingRange({ total, page, limit: pageSize, received: agents.length });

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

    notify('success', 'Export Complete', 'Agents exported to CSV successfully');
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
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Property Agents</h1>
          <p className="text-gray-600 mt-2">
            {loading ? 'Loading...' : loadError ? 'Agents unavailable' : `Showing ${showing.start}-${showing.end} of ${total} agents`}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
            Export page
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
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-gray-500">Loading agents...</TableCell></TableRow>
                ) : loadError ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-gray-700"><p>{loadError}</p><Button className="mt-3" size="sm" variant="outline" onClick={fetchAgents}>Retry</Button></TableCell></TableRow>
                ) : agents.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-gray-500">No agents found</TableCell></TableRow>
                ) : agents.map((agent) => {
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
                              notify('info', 'Agent Details', `Viewing details for ${agent.name}`);
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

      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700">
          <span>Showing {showing.start}-{showing.end} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={showing.end >= total} onClick={() => setPage((current) => current + 1)}>Next</Button>
          </div>
        </div>
      )}

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
