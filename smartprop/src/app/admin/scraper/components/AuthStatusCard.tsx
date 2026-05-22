'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { triggerReAuth, checkAuthStatus } from '../actions';
import { toast } from 'sonner';
import type { AuthPlatformStatus, AuthStatus } from '../types';

interface AuthStatusCardProps {
  authStatus: AuthStatus;
  onAuthStatusChange: (newStatus: AuthStatus) => void;
}

export function AuthStatusCard({ authStatus, onAuthStatusChange }: AuthStatusCardProps) {
  const [isReAuthenticating, setIsReAuthenticating] = useState<string | null>(null);

  const handleReAuth = async (platform: 'propertyguru' | 'edgeprop') => {
    setIsReAuthenticating(platform);

    const result = await triggerReAuth(platform);

    if (result.success) {
      toast.success(result.message);
      // Refresh auth status
      const newStatus = await checkAuthStatus();
      if (newStatus.success) {
        onAuthStatusChange(newStatus.auth);
      }
    } else {
      toast.error(result.error || 'Re-authentication failed');
    }

    setIsReAuthenticating(null);
  };

  const formatLastAuth = (lastAuth: string | null) => {
    if (!lastAuth) return 'Never';

    const date = new Date(lastAuth);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours > 24) {
      return `${Math.floor(diffHours / 24)}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else {
      return `${diffMins}m ago`;
    }
  };

  const renderPlatform = (label: string, platform: 'propertyguru' | 'edgeprop', status: AuthPlatformStatus) => {
    const badgeVariant = status.isAuthenticated ? 'default' : status.exists ? 'secondary' : 'destructive';
    const badgeLabel = status.isAuthenticated
      ? 'Fresh State'
      : status.exists
        ? 'Stale State'
        : 'Missing State';

    return (
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex items-center gap-4">
          <div>
            <p className="font-semibold text-gray-900">{label}</p>
            <p className="text-sm text-gray-700">
              Last auth: {formatLastAuth(status.lastAuth)}
            </p>
            <p className="text-sm text-gray-600">
              {status.cookieCount} cookies
              {typeof status.stateAgeHours === 'number' ? `, ${status.stateAgeHours.toFixed(1)}h old` : ''}
            </p>
            {status.failureReason && (
              <p className="text-sm text-amber-700">
                {status.failureReason}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={badgeVariant}>
            {badgeLabel}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleReAuth(platform)}
            disabled={isReAuthenticating === platform}
          >
            {isReAuthenticating === platform ? 'Re-authenticating...' : 'Re-auth'}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          🔐 Authentication Status
        </CardTitle>
        <CardDescription>
          Login status for PropertyGuru and EdgeProp scrapers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderPlatform('PropertyGuru', 'propertyguru', authStatus.propertyguru)}
        {renderPlatform('EdgeProp', 'edgeprop', authStatus.edgeprop)}
      </CardContent>
    </Card>
  );
}
