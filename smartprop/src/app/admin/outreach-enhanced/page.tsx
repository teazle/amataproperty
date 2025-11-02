/**
 * Enhanced Outreach Page with Real-Time Co-Broking State Management
 * Uses Zustand for live conversation updates and better UX
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Search, Send, Pause, Play, RotateCcw, Download, MessageSquare, Clock, Users, Target, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useConversationSelectors, useConversationStore, subscribeToConversationUpdates } from '@/lib/stores/conversation-store';
import { ConversationViewer } from '@/components/conversation/ConversationViewer';
import { useConversationSync } from '@/hooks/useConversationSync';

export default function EnhancedOutreachPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  
  // Use Zustand store
  const conversations = useConversationSelectors.useFilteredConversations();
  const stats = useConversationSelectors.useStats();
  const loading = useConversationSelectors.useLoading();
  const filters = useConversationSelectors.useFilters();
  
  // Store actions
  const { setFilters, fetchConversations, markAsActive, markAsInactive } = useConversationStore();
  
  // Real-time sync
  useConversationSync();

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Real-time updates
  useEffect(() => {
    const unsubscribe = subscribeToConversationUpdates((conversations) => {
      console.log('🔄 Conversations updated:', conversations.size);
    });

    return unsubscribe;
  }, []);

  const handleFilterChange = (key: string, value: string) => {
    setFilters({ [key]: value });
  };

  const handleConversationClick = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setIsViewerOpen(true);
    markAsActive(conversationId);
  };

  const handleCloseViewer = () => {
    if (selectedConversationId) {
      markAsInactive(selectedConversationId);
    }
    setIsViewerOpen(false);
    setSelectedConversationId(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'replied':
        return 'bg-green-100 text-green-800';
      case 'sent':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'opted_out':
        return 'bg-gray-100 text-gray-800';
      case 'signed':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getCoBrokingStatusIcon = (status: string) => {
    switch (status) {
      case 'willing':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'not_willing':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'needs_discussion':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'timeslots_received':
        return 'bg-blue-100 text-blue-800';
      case 'co_broking_discussion':
        return 'bg-yellow-100 text-yellow-800';
      case 'gracefully_ended':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Co-Broking Conversations</h1>
        <p className="text-gray-600 mt-2">Real-time tracking of agent conversations and co-broking status</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Play className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Active</p>
                <p className="text-2xl font-bold">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-2xl font-bold">{stats.completed}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Willing</p>
                <p className="text-2xl font-bold">{stats.coBrokingWilling}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Not Willing</p>
                <p className="text-2xl font-bold">{stats.coBrokingNotWilling}</p>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search agents, properties..."
                value={filters.searchTerm}
                onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={filters.status} onValueChange={(value) => handleFilterChange('status', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="replied">Replied</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="opted_out">Opted Out</SelectItem>
                  <SelectItem value="signed">Signed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="phase">Phase</Label>
              <Select value={filters.phase} onValueChange={(value) => handleFilterChange('phase', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Phases" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Phases</SelectItem>
                  <SelectItem value="initial">Initial</SelectItem>
                  <SelectItem value="agent_engaging">Agent Engaging</SelectItem>
                  <SelectItem value="timeslots_received">Timeslots Received</SelectItem>
                  <SelectItem value="co_broking_discussion">Co-Broking Discussion</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="gracefully_ended">Gracefully Ended</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="coBroking">Co-Broking</Label>
              <Select value={filters.coBrokingStatus} onValueChange={(value) => handleFilterChange('coBrokingStatus', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="All Co-Broking" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Co-Broking</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="willing">Willing</SelectItem>
                  <SelectItem value="not_willing">Not Willing</SelectItem>
                  <SelectItem value="needs_discussion">Needs Discussion</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversations Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Conversations</CardTitle>
              <CardDescription>
                {loading ? 'Loading...' : `${conversations.length} conversation${conversations.length !== 1 ? 's' : ''} found`}
              </CardDescription>
            </div>
            <Button onClick={() => fetchConversations()} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Co-Broking</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Last Message</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conversations.map((conversation) => (
                  <TableRow 
                    key={conversation.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleConversationClick(conversation.id)}
                  >
                    <TableCell>
                      <div>
                        <div className="font-medium">{conversation.agentName}</div>
                        <div className="text-sm text-gray-500">{conversation.agentPhone}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-xs">
                        <div className="font-medium truncate">{conversation.propertyTitle}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(conversation.status)}>
                        {conversation.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getPhaseColor(conversation.phase.phase)}>
                        {conversation.phase.phase.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {getCoBrokingStatusIcon(conversation.coBrokingStatus.status)}
                        <span className="text-sm">
                          {conversation.coBrokingStatus.status.replace('_', ' ')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {conversation.conversationHistory.length} messages
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-gray-500">
                        {new Date(conversation.lastMessageAt).toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConversationClick(conversation.id);
                        }}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Conversation Viewer Dialog */}
      <Dialog open={isViewerOpen} onOpenChange={setIsViewerOpen}>
        <DialogContent className="max-w-4xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Conversation Details</DialogTitle>
            <DialogDescription>
              Real-time conversation tracking and co-broking status
            </DialogDescription>
          </DialogHeader>
          {selectedConversationId && (
            <ConversationViewer
              conversationId={selectedConversationId}
              onClose={handleCloseViewer}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
