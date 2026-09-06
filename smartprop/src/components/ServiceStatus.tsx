'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertCircle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MessagingProviderHealth } from '@/lib/wa/provider-health';

interface ServiceStatus {
  flaresolverr: {
    online: boolean;
    ready: boolean;
    error?: string;
  };
  messaging?: MessagingProviderHealth;
  waha?: {
    online: boolean;
    ready: boolean;
    sessionStatus?: string;
    error?: string;
  };
  worker: {
    up: boolean;
    processCount?: number;
    error?: string;
  };
  chromium: {
    processCount: number;
    error?: string;
  };
}

interface ServiceStatusProps {
  initialStatus?: ServiceStatus;
}

export function ServiceStatus({ initialStatus }: ServiceStatusProps) {
  const [status, setStatus] = useState<ServiceStatus | null>(initialStatus ?? null);
  const [isLoading, setIsLoading] = useState(!initialStatus);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/services/status');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        setLastUpdate(new Date());
      } else {
        console.error('Failed to fetch service status');
      }
    } catch (error) {
      console.error('Error fetching service status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (online: boolean, ready: boolean) => {
    if (online && ready) {
      return (
        <Badge variant="default" className="bg-green-500 hover:bg-green-600">
          <CheckCircle className="h-3 w-3 mr-1" />
          Online & Ready
        </Badge>
      );
    } else if (online && !ready) {
      return (
        <Badge variant="default" className="bg-yellow-500 hover:bg-yellow-600">
          <AlertCircle className="h-3 w-3 mr-1" />
          Online (Not Ready)
        </Badge>
      );
    } else {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Offline
        </Badge>
      );
    }
  };

  const messaging = status?.messaging ?? status?.waha;
  const messagingProvider = status?.messaging?.provider ?? (status?.waha ? 'waha' : undefined);
  const messagingLabel = messagingProvider === 'openclaw' ? 'OpenClaw' : messagingProvider === 'waha' ? 'WAHA' : 'WhatsApp';

  if (isLoading && !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Service Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-500">Loading service status...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Service Status</CardTitle>
            <CardDescription>
              Real-time status of all critical services
              {lastUpdate && (
                <span className="ml-2 text-xs">
                  (Updated: {lastUpdate.toLocaleTimeString()})
                </span>
              )}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchStatus}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* FlareSolverr Status */}
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="flex flex-col">
              <span className="font-medium">FlareSolverr</span>
              <span className="text-xs text-gray-500">
                Cloudflare bypass service
              </span>
              {status?.flaresolverr.error && (
                <span className="text-xs text-red-500 mt-1">
                  {status.flaresolverr.error}
                </span>
              )}
            </div>
          </div>
          {status && getStatusBadge(status.flaresolverr.online, status.flaresolverr.ready)}
        </div>

        {/* Messaging Status */}
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="flex flex-col">
              <span className="font-medium">{messagingLabel}</span>
              <span className="text-xs text-gray-500">
                {!messaging && 'Messaging status unavailable'}
                {messagingProvider === 'waha' && 'WhatsApp HTTP API'}
                {messagingProvider === 'openclaw' && `WhatsApp account ${status?.messaging?.account ?? 'unknown'}`}
                {messaging?.sessionStatus && (
                  <span className="ml-1">({messaging.sessionStatus})</span>
                )}
              </span>
              {messaging?.error && (
                <span className="text-xs text-red-500 mt-1">
                  {messaging.error}
                </span>
              )}
            </div>
          </div>
          {status && getStatusBadge(messaging?.online ?? false, messaging?.ready ?? false)}
        </div>

        {/* Worker Status */}
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="flex flex-col">
              <span className="font-medium">Scraper Worker</span>
              <span className="text-xs text-gray-500">
                Background job processor
                {status?.worker.processCount !== undefined && (
                  <span className="ml-1">
                    ({status.worker.processCount} process{status.worker.processCount !== 1 ? 'es' : ''})
                  </span>
                )}
              </span>
              {status?.worker.error && (
                <span className="text-xs text-red-500 mt-1">
                  {status.worker.error}
                </span>
              )}
            </div>
          </div>
          {status && (
            status.worker.up ? (
              <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                <CheckCircle className="h-3 w-3 mr-1" />
                Running
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Stopped
              </Badge>
            )
          )}
        </div>

        {/* Chromium Processes */}
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="flex flex-col">
              <span className="font-medium">Chromium Processes</span>
              <span className="text-xs text-gray-500">
                Active browser instances
              </span>
              {status?.chromium.error && (
                <span className="text-xs text-red-500 mt-1">
                  {status.chromium.error}
                </span>
              )}
            </div>
          </div>
          {status && (
            <Badge variant="outline" className="text-lg font-semibold">
              {status.chromium.processCount}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
