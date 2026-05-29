/**
 * Real-Time Conversation Viewer Component
 * Displays co-broking conversations with live updates
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { CoBrokingStatus,ConversationMessage,subscribeToConversation,useConversationSelectors } from '@/lib/stores/conversation-store';
import { AlertCircle,CheckCircle,Clock,MessageSquare,Target,Users,XCircle } from 'lucide-react';
import { useEffect,useState } from 'react';

interface ConversationViewerProps {
  conversationId: string;
  onClose?: () => void;
}

export function ConversationViewer({ conversationId, onClose }: ConversationViewerProps) {
  const [conversation, setConversation] = useState(useConversationSelectors.useConversation(conversationId));
  const [isLive, _setIsLive] = useState(true);

  // Subscribe to real-time updates for this conversation
  useEffect(() => {
    const unsubscribe = subscribeToConversation(conversationId, (updatedConversation) => {
      setConversation(updatedConversation);
    });

    return unsubscribe;
  }, [conversationId]);

  if (!conversation) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-500">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Conversation not found</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getCoBrokingStatusIcon = (status: CoBrokingStatus) => {
    switch (status.status) {
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

  const getCoBrokingStatusText = (status: CoBrokingStatus) => {
    switch (status.status) {
      case 'willing':
        return 'Open to Co-Broking';
      case 'not_willing':
        return 'Not Open to Co-Broking';
      case 'needs_discussion':
        return 'Needs Discussion';
      default:
        return 'Unknown';
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
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{conversation.agentName}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <span>{conversation.agentPhone}</span>
              <Badge variant="outline" className="text-xs">
                {conversation.propertyTitle}
              </Badge>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isLive && (
              <div className="flex items-center gap-1 text-green-600 text-sm">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Live
              </div>
            )}
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                ×
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        {/* Status Overview */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium">Phase</span>
            </div>
            <Badge className={getPhaseColor(conversation.phase.phase)}>
              {conversation.phase.phase.replace('_', ' ').toUpperCase()}
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium">Co-Broking</span>
            </div>
            <div className="flex items-center gap-2">
              {getCoBrokingStatusIcon(conversation.coBrokingStatus)}
              <span className="text-sm">
                {getCoBrokingStatusText(conversation.coBrokingStatus)}
              </span>
            </div>
          </div>
        </div>

        {/* Objectives Status */}
        <div className="mb-6">
          <h4 className="text-sm font-medium mb-2">Objectives</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              {conversation.phase.objectives.timeslotsReceived ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Clock className="h-4 w-4 text-gray-400" />
              )}
              <span className="text-sm">Timeslots</span>
            </div>
            <div className="flex items-center gap-2">
              {conversation.phase.objectives.coBrokingConfirmed ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Clock className="h-4 w-4 text-gray-400" />
              )}
              <span className="text-sm">Co-Broking</span>
            </div>
          </div>
        </div>

        <Separator className="mb-4" />

        {/* Conversation Messages */}
        <div className="flex-1">
          <h4 className="text-sm font-medium mb-3">Conversation</h4>
          <ScrollArea className="h-96">
            <div className="space-y-4">
              {conversation.conversationHistory.map((message, index) => (
                <MessageBubble key={index} message={message} />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Conversation Stats */}
        <div className="mt-4 pt-4 border-t">
          <div className="grid grid-cols-3 gap-4 text-center text-sm text-gray-600">
            <div>
              <div className="font-medium">{conversation.autoReplyCount}</div>
              <div>Auto Replies</div>
            </div>
            <div>
              <div className="font-medium">{conversation.deflectionCount}</div>
              <div>Deflections</div>
            </div>
            <div>
              <div className="font-medium">{conversation.daysElapsed}</div>
              <div>Days Elapsed</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';
  const timestamp = new Date(message.timestamp).toLocaleTimeString();

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        <div className="text-sm">{message.message}</div>
        <div className={`text-xs mt-1 ${
          isUser ? 'text-blue-100' : 'text-gray-500'
        }`}>
          {timestamp}
        </div>
      </div>
    </div>
  );
}
