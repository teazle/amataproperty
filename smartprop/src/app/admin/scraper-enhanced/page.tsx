/**
 * Enhanced Scraper Page with Real-Time Progress Tracking
 * Live updates, job management, and performance monitoring
 */

'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from '@/components/ui/table';
import { useGlobalStore,useNotificationsSelectors,useScraperSelectors } from '@/lib/stores/global-store';
import {
Activity,
AlertCircle,
CheckCircle,
Clock,
Database,
Play,
RefreshCw,
Square,
TrendingUp,
Zap
} from 'lucide-react';
import { useEffect,useState } from 'react';

export default function EnhancedScraperPage() {
  const [_selectedJobId, setSelectedJobId] = useState<string | null>(null);
  
  // Zustand selectors
  const jobs = useScraperSelectors.useJobs();
  const activeJobs = useScraperSelectors.useActiveJobs();
  const isRunning = useScraperSelectors.useIsRunning();
  const stats = useScraperSelectors.useStats();
  const notifications = useNotificationsSelectors.useNotifications();
  
  // Store actions
  const { 
    startScraping, 
    stopScraping, 
    updateStats,
    addNotification 
  } = useGlobalStore();

  // Auto-refresh stats every 5 seconds when running
  useEffect(() => {
    if (isRunning) {
      const interval = setInterval(() => {
        // Simulate stats update (in real app, this would come from API)
        updateStats({
          totalListings: stats.totalListings + Math.floor(Math.random() * 5),
          newListings: stats.newListings + Math.floor(Math.random() * 3),
          updatedListings: stats.updatedListings + Math.floor(Math.random() * 2),
        });
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [isRunning, stats, updateStats]);

  const handleStartScraping = async (type: 'propertyguru' | 'edgeprop') => {
    try {
      await startScraping(type);
      addNotification({
        type: 'success',
        title: 'Scraping Started',
        message: `${type} scraping job started successfully`,
      });
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Scraping Failed',
        message: 'Failed to start scraping job',
      });
    }
  };

  const handleStopScraping = async (jobId: string) => {
    try {
      await stopScraping(jobId);
      addNotification({
        type: 'info',
        title: 'Scraping Stopped',
        message: 'Scraping job stopped successfully',
      });
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Stop Failed',
        message: 'Failed to stop scraping job',
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Activity className="h-4 w-4 text-green-500 animate-pulse" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const formatDuration = (startedAt?: string, completedAt?: string) => {
    if (!startedAt) return 'N/A';
    
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const duration = Math.floor((end.getTime() - start.getTime()) / 1000);
    
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    
    return `${minutes}m ${seconds}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Property Scraper</h1>
        <p className="text-gray-600 mt-2">Real-time scraping progress and job management</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Database className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Listings</p>
                <p className="text-2xl font-bold">{stats.totalListings.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">New Today</p>
                <p className="text-2xl font-bold">{stats.newListings.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <RefreshCw className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Updated</p>
                <p className="text-2xl font-bold">{stats.updatedListings.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-sm font-medium text-gray-600">Errors</p>
                <p className="text-2xl font-bold">{stats.errors}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Scraper Control</CardTitle>
          <CardDescription>Start and manage scraping jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <Button
              onClick={() => handleStartScraping('propertyguru')}
              disabled={isRunning}
              className="flex items-center space-x-2"
            >
              <Play className="h-4 w-4" />
              <span>Start PropertyGuru</span>
            </Button>
            
            <Button
              onClick={() => handleStartScraping('edgeprop')}
              disabled={isRunning}
              variant="outline"
              className="flex items-center space-x-2"
            >
              <Play className="h-4 w-4" />
              <span>Start EdgeProp</span>
            </Button>

            {isRunning && (
              <div className="flex items-center space-x-2 text-green-600">
                <Activity className="h-4 w-4 animate-pulse" />
                <span className="text-sm font-medium">Scraping in progress...</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Jobs */}
      {activeJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Jobs</CardTitle>
            <CardDescription>Currently running scraping jobs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activeJobs.map((job) => (
                <div key={job.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(job.status)}
                      <span className="font-medium capitalize">{job.type} Scraping</span>
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStopScraping(job.id)}
                    >
                      <Square className="h-4 w-4 mr-1" />
                      Stop
                    </Button>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Progress: {job.current_page} / {job.total_pages} pages</span>
                      <span>Duration: {formatDuration(job.started_at)}</span>
                    </div>
                    
                    <Progress 
                      value={job.total_pages > 0 ? (job.current_page / job.total_pages) * 100 : 0} 
                      className="w-full"
                    />
                    
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Listings found: {job.listings_found}</span>
                      <span>Errors: {job.errors.length}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job History */}
      <Card>
        <CardHeader>
          <CardTitle>Job History</CardTitle>
          <CardDescription>Recent scraping jobs and their results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Listings</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(jobs.values()).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Zap className="h-4 w-4" />
                        <span className="capitalize">{job.type}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(job.status)}
                        <Badge className={getStatusColor(job.status)}>
                          {job.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{job.current_page} / {job.total_pages}</span>
                          <span>{Math.round((job.current_page / Math.max(job.total_pages, 1)) * 100)}%</span>
                        </div>
                        <Progress 
                          value={job.total_pages > 0 ? (job.current_page / job.total_pages) * 100 : 0} 
                          className="w-full h-2"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>Found: {job.listings_found}</div>
                        <div className="text-red-500">Errors: {job.errors.length}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {formatDuration(job.started_at, job.completed_at)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-gray-500">
                        {job.started_at ? new Date(job.started_at).toLocaleString() : 'N/A'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedJobId(job.id)}
                        >
                          <Activity className="h-4 w-4" />
                        </Button>
                        {job.status === 'running' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStopScraping(job.id)}
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
