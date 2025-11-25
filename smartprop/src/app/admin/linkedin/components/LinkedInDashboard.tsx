'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  MessageSquare, 
  Send, 
  Settings, 
  History, 
  Activity, 
  CheckCircle, 
  XCircle,
  Play,
  Square,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';

const DEFAULT_SCHEDULE_TIME = '09:00';

function scheduleToTime(schedule?: string | null): string {
  if (!schedule) return DEFAULT_SCHEDULE_TIME;
  const parts = schedule.trim().split(/\s+/);
  let minute = '00';
  let hour = '09';

  if (parts.length === 5) {
    minute = parts[0];
    hour = parts[1];
  } else if (parts.length >= 6) {
    minute = parts[1];
    hour = parts[2];
  }

  const pad = (value: string) => value.padStart(2, '0').slice(-2);
  const sanitizedHour = pad(hour.replace(/\D/g, '') || '09');
  const sanitizedMinute = pad(minute.replace(/\D/g, '') || '00');
  return `${sanitizedHour}:${sanitizedMinute}`;
}

function timeToSchedule(time: string): string {
  const [hourStr = '09', minuteStr = '00'] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (isNaN(hour) || isNaN(minute)) {
    return '0 9 * * *';
  }
  return `${minute} ${hour} * * *`;
}

interface LinkedInSettings {
  id: string;
  profile_url: string | null;
  company_url: string;
  daily_limit: number; // Kept for backward compatibility
  messages_per_job: number; // New: messages per job
  min_delay: number;
  max_delay: number;
  message_template_profile: string;
  message_template_company: string;
  enabled: boolean;
  auto_run_schedule: string | null;
  timezone: string;
}

interface LinkedInStatus {
  success: boolean;
  settings: LinkedInSettings | null;
  isRunning: boolean;
  hasSession: boolean;
  today: {
    messagesSent: number;
    messagesLimit: number;
    dailyStats: any;
  };
  lastScanTime: string | null;
  lockData: any;
}

interface LinkedInMessage {
  id: string;
  contact_name: string | null;
  contact_profile_url: string;
  message_type: 'birthday' | 'work_anniversary' | 'job_change' | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sent_at: string | null;
  created_at: string;
}

export function LinkedInDashboard() {
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [settings, setSettings] = useState<LinkedInSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<LinkedInMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [runHeaded, setRunHeaded] = useState(false);
  const [autoRunTime, setAutoRunTime] = useState(DEFAULT_SCHEDULE_TIME);
  const logsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Form state
  const [formData, setFormData] = useState<Partial<LinkedInSettings>>({});

  // Load initial data on mount
  useEffect(() => {
    loadStatus();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Extract isRunning to a stable value for dependencies
  const isRunning = status?.isRunning ?? false;

  // Poll status every 5 seconds if running
  useEffect(() => {
    if (!isRunning) return;
    
    const interval = setInterval(() => {
      loadStatus();
      loadHistory();
    }, 5000);
    
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  useEffect(() => {
    setAutoRunTime(scheduleToTime(settings?.auto_run_schedule));
  }, [settings?.auto_run_schedule]);

  // Load logs when showing logs and refresh every 3 seconds if automation is running
  useEffect(() => {
    // Clear any existing interval
    if (logsIntervalRef.current) {
      clearInterval(logsIntervalRef.current);
      logsIntervalRef.current = null;
    }

    if (!showLogs) return;
    
    // Load immediately
    loadLogs();
    
    // Refresh logs every 3 seconds if automation is running
    if (isRunning) {
      logsIntervalRef.current = setInterval(() => {
        loadLogs();
      }, 3000);
    }
    
    return () => {
      if (logsIntervalRef.current) {
        clearInterval(logsIntervalRef.current);
        logsIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLogs, isRunning]);

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/linkedin/status');
      const data = await res.json();
      if (data.success) {
        setStatus(data);
        setSettings(data.settings);
        if (data.settings) {
          setFormData(data.settings);
        }
      }
    } catch (error) {
      console.error('Error loading status:', error);
      toast.error('Failed to load status');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/linkedin/history?limit=50');
      const data = await res.json();
      if (data.success) {
        setHistory(data.messages || []);
      } else {
        console.error('Failed to load history:', data.error);
        toast.error(data.error || 'Failed to load message history');
      }
    } catch (error: any) {
      console.error('Error loading history:', error);
      toast.error(error.message || 'Failed to load message history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDeleteMessage = async (id: string, contactName: string) => {
    if (!confirm(`Are you sure you want to delete the message for ${contactName}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/linkedin/messages?id=${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast.success('Message deleted successfully');
        loadHistory(); // Reload history
      } else {
        toast.error(data.error || 'Failed to delete message');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete message');
    }
  };

  const handleDeleteAllMessages = async () => {
    if (!confirm('Are you sure you want to delete ALL messages? This action cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch('/api/linkedin/messages?all=true', {
        method: 'DELETE'
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast.success('All messages deleted successfully');
        setHistory([]); // Clear history immediately
        loadStatus(); // Refresh status to update today's count
      } else {
        toast.error(data.error || 'Failed to delete all messages');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete all messages');
    }
  };

  const loadLogs = async () => {
    // Don't set loading state if we're in auto-refresh mode to avoid flickering
    const isAutoRefresh = logsIntervalRef.current !== null;
    if (!isAutoRefresh) {
      setLogsLoading(true);
    }
    try {
      const res = await fetch('/api/linkedin/logs?lines=500&tail=true', {
        cache: 'no-store', // Prevent caching
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
        // Auto-scroll to bottom
        setTimeout(() => {
          const container = document.getElementById('logs-container');
          if (container) {
            container.scrollTop = container.scrollHeight;
          }
        }, 100);
      } else {
        console.error('Failed to load logs:', data.error);
      }
    } catch (error: any) {
      console.error('Error loading logs:', error);
      // Don't show toast on every auto-refresh failure to avoid spam
      if (!isAutoRefresh) {
        toast.error('Failed to load logs. Please try refreshing manually.');
      }
    } finally {
      if (!isAutoRefresh) {
        setLogsLoading(false);
      }
    }
  };

  const autoRunEnabled = Boolean(formData.auto_run_schedule);

  const handleStart = async (dryRun: boolean = false) => {
    setStarting(true);
    setLogs([]);
    if (!showLogs) {
      setShowLogs(true);
    }
    try {
      const res = await fetch('/api/linkedin/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, headed: runHeaded })
      });
      const data = await res.json();
      
      if (res.ok) {
        toast.success(dryRun ? 'Dry run started' : 'Automation started');
        loadLogs();
        setTimeout(() => {
          loadStatus();
          loadHistory();
        }, 1000);
      } else {
        toast.error(data.error || 'Failed to start automation');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to start automation');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      const res = await fetch('/api/linkedin/stop', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success('Stop signal sent');
      } else {
        toast.error(data.error || 'Failed to stop automation');
      }
      setTimeout(() => {
        loadStatus();
        loadHistory();
        if (showLogs) {
          loadLogs();
        }
      }, 1000);
    } catch (error: any) {
      toast.error(error.message || 'Failed to stop automation');
    } finally {
      setStopping(false);
    }
  };

  const handleAutoRunToggle = (checked: boolean) => {
    setFormData({
      ...formData,
      auto_run_schedule: checked ? timeToSchedule(autoRunTime) : null
    });
  };

  const handleAutoRunTimeChange = (value: string) => {
    setAutoRunTime(value);
    if (autoRunEnabled) {
      setFormData({ ...formData, auto_run_schedule: timeToSchedule(value) });
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/linkedin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      
      if (res.ok) {
        toast.success('Settings saved');
        setSettings(data.settings);
        await loadStatus();
      } else {
        toast.error(data.error || 'Failed to save settings');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (time: string | null) => {
    if (!time) return 'Never';
    return new Date(time).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return <Badge className="bg-green-100 text-green-800">Sent</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
      case 'skipped':
        return <Badge className="bg-yellow-100 text-yellow-800">Skipped</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Pending</Badge>;
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Status Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Today's Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.today.messagesSent || 0}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Messages sent today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Session Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {status?.hasSession ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="font-medium">Logged In</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  <span className="font-medium">Not Logged In</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Last Scan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {status?.lastScanTime ? formatTime(status.lastScanTime) : 'Never'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>Start or stop LinkedIn automation</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Button
            onClick={() => handleStart(false)}
            disabled={starting || status?.isRunning || !status?.hasSession}
          >
            {starting ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Automation
              </>
            )}
          </Button>
          
          <Button
            variant="outline"
            onClick={() => handleStart(true)}
            disabled={starting || status?.isRunning || !status?.hasSession}
          >
            <Send className="h-4 w-4 mr-2" />
            Dry Run
          </Button>

          <Button
            variant="destructive"
            onClick={handleStop}
            disabled={stopping || !status?.isRunning}
          >
            {stopping ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Stopping...
              </>
            ) : (
              <>
                <Square className="h-4 w-4 mr-2" />
                Stop Automation
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={loadStatus}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>

            <div className="ml-auto flex items-center gap-2">
              <Switch
                id="run_headed"
                checked={runHeaded}
                onCheckedChange={(checked) => setRunHeaded(checked)}
              />
              <Label htmlFor="run_headed" className="text-xs font-medium">
                Run in headed browser
              </Label>
            </div>

          {status?.isRunning && (
            <Badge className="ml-auto flex items-center gap-2">
              <Activity className="h-4 w-4 animate-pulse" />
              Running...
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Logs Viewer */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Job Logs</CardTitle>
              <CardDescription>Console output from current automation job</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {showLogs && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadLogs()}
                  disabled={logsLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${logsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              )}
              <Button
                variant={showLogs ? "secondary" : "outline"}
                size="sm"
                onClick={() => {
                  setShowLogs(!showLogs);
                  if (!showLogs) {
                    loadLogs();
                  }
                }}
              >
                {showLogs ? 'Hide Logs' : 'Show Logs'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {showLogs && (
          <CardContent>
            {logsLoading && logs.length === 0 ? (
              <div className="text-center text-gray-500 py-8">Loading logs...</div>
            ) : logs.length === 0 ? (
              <div className="text-center text-gray-500 py-8">No logs available yet</div>
            ) : (
              <div
                id="logs-container"
                className="bg-black font-mono text-sm p-4 rounded-lg overflow-auto max-h-[600px] text-white"
                style={{ 
                  scrollBehavior: 'smooth',
                  fontFamily: 'monospace',
                  color: '#ffffff'
                }}
              >
                {logs.map((log, index) => (
                  <div 
                    key={index} 
                    className="whitespace-pre-wrap break-words mb-1 text-white"
                    style={{ color: '#ffffff' }}
                  >
                    {log}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Configure LinkedIn automation settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="profile_url">Profile URL</Label>
              <Input
                id="profile_url"
                value={formData.profile_url || ''}
                onChange={(e) => setFormData({ ...formData, profile_url: e.target.value })}
                placeholder="https://www.linkedin.com/in/your-profile"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company_url">Company Page URL</Label>
              <Input
                id="company_url"
                value={formData.company_url || ''}
                onChange={(e) => setFormData({ ...formData, company_url: e.target.value })}
                placeholder="https://www.linkedin.com/company/..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="messages_per_job">Messages Per Job</Label>
              <Input
                id="messages_per_job"
                type="text"
                inputMode="numeric"
                value={formData.messages_per_job !== undefined && formData.messages_per_job !== null ? String(formData.messages_per_job) : ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  // Allow empty or numbers only
                  if (val === '' || /^\d+$/.test(val)) {
                    if (val === '') {
                      setFormData({ ...formData, messages_per_job: undefined });
                    } else {
                      const num = parseInt(val, 10);
                      if (!isNaN(num)) {
                        setFormData({ ...formData, messages_per_job: num });
                      }
                    }
                  }
                }}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  const num = parseInt(val, 10);
                  if (val === '' || isNaN(num) || num < 1 || num > 500) {
                    setFormData({ ...formData, messages_per_job: 50 });
                  } else {
                    setFormData({ ...formData, messages_per_job: num });
                  }
                }}
              />
              <p className="text-xs text-gray-500">
                Number of messages to send before stopping (default: 50)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="auto_run_schedule">Daily Schedule</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="auto_run_schedule"
                  checked={autoRunEnabled}
                  onCheckedChange={handleAutoRunToggle}
                />
                <span className="text-sm text-gray-500">
                  {autoRunEnabled
                    ? `Runs daily at ${autoRunTime}`
                    : 'Auto-run disabled'}
                </span>
              </div>
              <Input
                id="auto_run_time"
                type="time"
                value={autoRunTime}
                onChange={(e) => handleAutoRunTimeChange(e.target.value)}
                disabled={!autoRunEnabled}
              />
              <p className="text-xs text-gray-500">
                The automation will trigger every day at the selected time ({settings?.timezone || 'Asia/Singapore'} timezone) using the configured messages per job limit.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="min_delay">Min Delay (ms)</Label>
              <Input
                id="min_delay"
                type="text"
                inputMode="numeric"
                value={formData.min_delay !== undefined && formData.min_delay !== null ? String(formData.min_delay) : ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  // Allow empty or numbers only
                  if (val === '' || /^\d+$/.test(val)) {
                    if (val === '') {
                      setFormData({ ...formData, min_delay: undefined });
                    } else {
                      const num = parseInt(val, 10);
                      if (!isNaN(num)) {
                        setFormData({ ...formData, min_delay: num });
                      }
                    }
                  }
                }}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  const num = parseInt(val, 10);
                  if (val === '' || isNaN(num) || num < 1000 || num > 30000) {
                    setFormData({ ...formData, min_delay: 3000 });
                  } else {
                    setFormData({ ...formData, min_delay: num });
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max_delay">Max Delay (ms)</Label>
              <Input
                id="max_delay"
                type="text"
                inputMode="numeric"
                value={formData.max_delay !== undefined && formData.max_delay !== null ? String(formData.max_delay) : ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  // Allow empty or numbers only
                  if (val === '' || /^\d+$/.test(val)) {
                    if (val === '') {
                      setFormData({ ...formData, max_delay: undefined });
                    } else {
                      const num = parseInt(val, 10);
                      if (!isNaN(num)) {
                        setFormData({ ...formData, max_delay: num });
                      }
                    }
                  }
                }}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  const num = parseInt(val, 10);
                  if (val === '' || isNaN(num) || num < 1000 || num > 60000) {
                    setFormData({ ...formData, max_delay: 8000 });
                  } else {
                    setFormData({ ...formData, max_delay: num });
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="enabled">Enabled</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="enabled"
                  checked={formData.enabled ?? true}
                  onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                />
                <span className="text-sm text-gray-500">
                  {formData.enabled ? 'Automation enabled' : 'Automation disabled'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message_template_profile">Profile Link Template</Label>
            <Textarea
              id="message_template_profile"
              value={formData.message_template_profile || ''}
              onChange={(e) => setFormData({ ...formData, message_template_profile: e.target.value })}
              placeholder="\n\nFeel free to connect with me: {profile_url}"
              rows={2}
            />
            <p className="text-xs text-gray-500">Use {"{profile_url}"} as placeholder</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message_template_company">Company Link Template</Label>
            <Textarea
              id="message_template_company"
              value={formData.message_template_company || ''}
              onChange={(e) => setFormData({ ...formData, message_template_company: e.target.value })}
              placeholder="Check out our company updates: {company_url}"
              rows={2}
            />
            <p className="text-xs text-gray-500">Use {"{company_url}"} as placeholder</p>
          </div>

          <Button onClick={handleSaveSettings} disabled={saving}>
            {saving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Settings className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Messages</CardTitle>
              <CardDescription>Last 50 messages sent</CardDescription>
            </div>
            {history.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAllMessages}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="text-center text-gray-500 py-8">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-center text-gray-500 py-8">No messages yet</div>
          ) : (
            <div className="space-y-2">
              {history.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="font-medium">{msg.contact_name || 'Unknown'}</div>
                    <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                      {msg.message_type && (
                        <Badge variant="outline" className="mr-2">
                          {msg.message_type.replace('_', ' ')}
                        </Badge>
                      )}
                      <span>{msg.sent_at ? formatTime(msg.sent_at) : formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div>{getStatusBadge(msg.status)}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteMessage(msg.id, msg.contact_name || 'Unknown')}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      title="Delete message"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

