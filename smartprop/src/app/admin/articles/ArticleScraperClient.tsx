'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Play, 
  Square, 
  Download, 
  FileJson, 
  FileSpreadsheet, 
  Library, 
  History, 
  TrendingUp,
  Clock,
  FileText,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Search,
  Globe,
  Hash,
  AlertTriangle,
  Trash2
} from 'lucide-react';
import { getArticlesAction, getScrapeHistoryAction, deleteScrapeSessionAction, deleteAllHistoryAction } from './actions';

interface Article {
  id: string;
  nid: string;
  title: string;
  thumbnail: string;
  path: string;
  author: string;
  created: string;
  category: string | null;
  description?: string;
  created_on: string;
  first_scraped_at: string;
  scrape_count: number;
}

interface SingleArticleResult {
  nid: string;
  title: string;
  author: string;
  path: string;
  category: string[] | string;
  // MCP scraper fields
  word_count?: number;
  reading_time_minutes?: number;
  text_content?: string;
  paragraphs_count?: number;
  images_count?: number;
  links_count?: number;
  // API scraper fields
  created?: string;
  created_on?: string;
  description?: string;
  thumbnail?: string;
  keywords?: string[];
  content_available?: boolean;
  note?: string;
}

interface ScrapeSession {
  id: string;
  source: string;
  started_at: string;
  completed_at?: string;
  status: string;
  pages_scraped: number;
  articles_scraped: number;
  unique_articles: number;
  duplicates_found: number;
  error_message?: string;
}

interface ScraperProgress {
  currentPage: number;
  totalPages: number;
  currentArticle?: number;           // Current article being scraped on page
  articlesDiscovered?: number;       // Total articles discovered from API
  articlesScraped?: number;          // Articles with full content scraped
  articlesCollected?: number;        // Legacy - same as articlesScraped
  articlesFailed?: number;           // Failed to scrape full content
  totalArticles?: number;            // Total articles available
  maxPagesAvailable?: number;        // Dynamic max from API
  status: 'running' | 'completed' | 'error' | 'stopped';
  message?: string;
  sessionId?: string;
  logMessage?: string;               // Console log message
}

interface Props {
  initialArticles: Article[];
  initialTotal: number;
  initialPages: number;
  initialHistory: ScrapeSession[];
  initialStats: { totalArticles: number; totalSessions: number };
}

export default function ArticleScraperClient({
  initialArticles,
  initialTotal,
  initialPages,
  initialHistory,
  initialStats
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('scrape');
  
  // Scrape tab state
  const [isRunning, setIsRunning] = useState(false);
  const [maxPages, setMaxPages] = useState(10);
  const [maxPagesAvailable, setMaxPagesAvailable] = useState(624); // Dynamic from API, defaults to 624
  const [selectedMethod, setSelectedMethod] = useState('mcp'); // Default to MCP (broader coverage)
  const [progress, setProgress] = useState<ScraperProgress>({
    currentPage: 0,
    totalPages: 0,
    currentArticle: 0,
    articlesDiscovered: 0,
    articlesScraped: 0,
    articlesFailed: 0,
    status: 'stopped'
  });
  const [startTime, setStartTime] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  
  // Library tab state
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [totalArticles, setTotalArticles] = useState(initialTotal);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  
  // History tab state
  const [history, setHistory] = useState<ScrapeSession[]>(initialHistory);
  
  // Stats (reserved for future use)
  const [_stats, _setStats] = useState(initialStats);

  // Single article scraping state
  const [singleArticleUrl, setSingleArticleUrl] = useState('');
  const [isSingleScraping, setIsSingleScraping] = useState(false);
  const [singleArticleResult, setSingleArticleResult] = useState<SingleArticleResult | null>(null);
  const [singleArticleError, setSingleArticleError] = useState<string | null>(null);
  const [scraperType, setScraperType] = useState<'mcp' | 'api'>('mcp');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const startScraping = () => {
    if (isRunning) return;
    
    setIsRunning(true);
    setStartTime(Date.now());
    setLogs([]); // Clear previous logs
    shouldAutoScrollRef.current = true;
    setProgress({
      currentPage: 0,
      totalPages: maxPages,
      currentArticle: 0,
      articlesDiscovered: 0,
      articlesScraped: 0,
      articlesFailed: 0,
      status: 'running',
      message: `Starting ${selectedMethod.toUpperCase()} scraper...`
    });
    
    // Create SSE connection
    console.log('Creating SSE connection to:', `/api/articles/scrape?pages=${maxPages}&method=${selectedMethod}`);
    const eventSource = new EventSource(`/api/articles/scrape?pages=${maxPages}&method=${selectedMethod}`, {
      withCredentials: false,
      // Disable reconnection for better control
      // The server will keep the connection open until the scraper completes
    });
    eventSourceRef.current = eventSource;
    
    console.log('SSE connection created:', eventSource.readyState);
    
    // Test with simple SSE endpoint first (temporarily disabled)
    // const testEventSource = new EventSource('/api/articles/scrape-simple?pages=1');
    // testEventSource.onmessage = (event) => {
    //   console.log('Simple SSE message received:', event.data);
    // };
    // testEventSource.onerror = (error) => {
    //   console.error('Simple SSE error:', error);
    // };
    // testEventSource.onopen = () => {
    //   console.log('Simple SSE connection opened successfully');
    //   setTimeout(() => testEventSource.close(), 3000);
    // };
    
    eventSource.onmessage = (event) => {
      try {
        const data: ScraperProgress = JSON.parse(event.data);
        console.log('Received SSE message:', data);
        setProgress(data);
        
        // Handle log messages
        if (data.logMessage) {
          const timestamp = new Date().toLocaleTimeString();
          setLogs(prevLogs => {
            const updated = [...prevLogs, `[${timestamp}] ${data.logMessage}`];
            // Keep only last 1000 lines to prevent memory issues
            return updated.slice(-1000);
          });
          
          // Auto-scroll to bottom if user hasn't scrolled up
          if (shouldAutoScrollRef.current && logsContainerRef.current) {
            setTimeout(() => {
              if (logsContainerRef.current) {
                logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
              }
            }, 50);
          }
        }
        
        // Update max pages if API provides it
        if (data.maxPagesAvailable && data.maxPagesAvailable > 0) {
          setMaxPagesAvailable(data.maxPagesAvailable);
        }
        
        if (data.status === 'completed' || data.status === 'error' || data.status === 'stopped') {
          console.log('Scraper finished with status:', data.status);
          setIsRunning(false);
          eventSource.close();
          eventSourceRef.current = null;
          
          // Refresh library and history after completion
          if (data.status === 'completed') {
            refreshData();
          }
        }
      } catch (error) {
        console.error('Failed to parse SSE data:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      console.error('EventSource readyState:', eventSource.readyState);
      console.error('EventSource url:', eventSource.url);

      // Only show error if we haven't received any progress data yet
      // If we're running and have received some progress, assume it's just a temporary disconnect
      // and the scraper is continuing in the background
      if (progress.articlesDiscovered === 0) {
        // True connection failure - never received any data
        const errorMessage = 'Connection failed. Please check your network connection and try again.';
        setProgress(prev => ({
          ...prev,
          status: 'error',
          message: errorMessage
        }));
        setIsRunning(false);
        eventSource.close();
        eventSourceRef.current = null;
      } else if (progress.status === 'running') {
        // Connection interrupted but scraper was running - assume it's continuing
        console.log('Connection interrupted, but scraper appears to be continuing in background');
        setProgress(prev => ({
          ...prev,
          message: 'Connection interrupted. Scraping may continue in the background. Please check back in a few minutes.'
        }));
        // Don't close the EventSource - let it try to reconnect
        // Don't set isRunning to false - the scraper might still be running
      } else {
        // Other error states
        eventSource.close();
        eventSourceRef.current = null;
      }
    };
    
    eventSource.onopen = () => {
      console.log('SSE connection opened successfully');
    };
    
    // Add a small delay to see if connection establishes
    setTimeout(() => {
      if (eventSource.readyState === 1) {
        console.log('SSE connection is OPEN after delay');
      } else {
        console.log('SSE connection state after delay:', eventSource.readyState);
        // If connection didn't open, this might be a connection issue
        if (eventSource.readyState === 2 && progress.articlesDiscovered === 0) {
          console.error('SSE connection failed to open - likely a network issue');
          setProgress(prev => ({
            ...prev,
            status: 'error',
            message: 'Failed to establish connection. Please check your network and try again.'
          }));
          setIsRunning(false);
          eventSource.close();
          eventSourceRef.current = null;
        }
      }
    }, 2000); // Increased timeout to 2 seconds
  };
  
  const stopScraping = async () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    try {
      await fetch('/api/articles/scrape?action=stop');
      setIsRunning(false);
      setProgress(prev => ({ ...prev, status: 'stopped', message: 'Stopped by user' }));
    } catch (error) {
      console.error('Failed to stop scraper:', error);
    }
  };
  
  const refreshData = async () => {
    const [articlesRes, historyRes] = await Promise.all([
      getArticlesAction(currentPage, searchQuery, categoryFilter),
      getScrapeHistoryAction(100) // Get more history records
    ]);
    
    if (articlesRes.success && articlesRes.data) {
      setArticles(articlesRes.data.articles);
      setTotalArticles(articlesRes.data.total);
    }
    
    if (historyRes.success && historyRes.data) {
      setHistory(historyRes.data);
    }
  };
  
  const loadArticles = async (page: number, search: string = '', category: string = 'all') => {
    const result = await getArticlesAction(page, search, category);
    if (result.success && result.data) {
      setArticles(result.data.articles);
      setTotalArticles(result.data.total);
      setCurrentPage(page);
    }
  };
  
  const handleSearch = () => {
    setCurrentPage(1);
    loadArticles(1, searchQuery, categoryFilter);
  };
  
  const exportData = (format: 'json' | 'csv') => {
    const articlesParam = encodeURIComponent(JSON.stringify(articles));
    window.open(`/api/articles/export?format=${format}&articles=${articlesParam}`, '_blank');
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to delete this scrape session? This action cannot be undone.')) {
      return;
    }
    
    const result = await deleteScrapeSessionAction(sessionId);
    if (result.success) {
      await refreshData();
    } else {
      alert(`Failed to delete session: ${result.error}`);
    }
  };

  const deleteAllHistory = async () => {
    if (!confirm('Are you sure you want to delete ALL scrape history? This action cannot be undone and will remove all scrape sessions and their associated data.')) {
      return;
    }
    
    const result = await deleteAllHistoryAction();
    if (result.success) {
      await refreshData();
    } else {
      alert(`Failed to delete history: ${result.error}`);
    }
  };

  const scrapeSingleArticle = async () => {
    if (!singleArticleUrl.trim()) {
      setSingleArticleError('Please enter a valid EdgeProp article URL');
      return;
    }

    setIsSingleScraping(true);
    setSingleArticleError(null);
    setSingleArticleResult(null);

    try {
      const response = await fetch('/api/articles/scrape-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          url: singleArticleUrl.trim(),
          scraperType: scraperType 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to scrape article');
      }

      setSingleArticleResult(data.article);
      // Refresh the articles list to include the new article
      await refreshData();
    } catch (error) {
      console.error('Single article scraping error:', error);
      setSingleArticleError(error instanceof Error ? error.message : 'Failed to scrape article');
    } finally {
      setIsSingleScraping(false);
    }
  };
  
  // Extract categories
  const categories = Array.from(new Set(
    articles.flatMap(a => Array.isArray(a.category) ? a.category : [a.category])
  )).filter(Boolean);
  
  const progressPercent = progress.totalPages > 0 ? (progress.currentPage / progress.totalPages) * 100 : 0;
  const elapsedTime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Scraper method descriptions
  const scraperMethods = {
    mcp: {
      name: 'MCP Scraper',
      description: 'Comprehensive discovery of all article types with full content extraction',
      features: '🔍 All Article Types • ✅ Full Content • ✅ Comprehensive',
      performance: '~1 min/page • ~50KB/article',
      color: 'green'
    },
    unified: {
      name: 'Unified Scraper',
      description: 'API interception + content extraction (experimental)',
      features: '🧪 Experimental • ⚠️ API Issues • ✅ Full Content',
      performance: '~1 min/page • ~50KB/article',
      color: 'orange'
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="scrape" className="flex items-center gap-2">
          <Loader2 className="w-4 h-4" />
          <span>Current Scrape</span>
        </TabsTrigger>
        <TabsTrigger value="library" className="flex items-center gap-2">
          <Library className="w-4 h-4" />
          <span>Library ({totalArticles})</span>
        </TabsTrigger>
        <TabsTrigger value="history" className="flex items-center gap-2">
          <History className="w-4 h-4" />
          <span>History ({history.length})</span>
        </TabsTrigger>
      </TabsList>

      {/* TAB 1: Current Scrape */}
      <TabsContent value="scrape" className="space-y-6">
        {/* Quick Action Header */}
        <Card className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-gray-900">Start New Scrape</h2>
                  <Badge className={`bg-${scraperMethods[selectedMethod as keyof typeof scraperMethods]?.color}-600 text-white`}>
                    {scraperMethods[selectedMethod as keyof typeof scraperMethods]?.name}
                  </Badge>
                </div>
                <p className="text-gray-600 text-sm">{scraperMethods[selectedMethod as keyof typeof scraperMethods]?.description}</p>
                <p className="text-xs text-blue-600 mt-1">{scraperMethods[selectedMethod as keyof typeof scraperMethods]?.performance} • {scraperMethods[selectedMethod as keyof typeof scraperMethods]?.features}</p>
              </div>
            </div>
            
            {/* Scraper Method Selector */}
            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Scraper Method</label>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {Object.entries(scraperMethods).map(([key, method]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedMethod(key)}
                    disabled={isRunning}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      selectedMethod === key
                        ? `border-${method.color}-500 bg-${method.color}-50`
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    } ${isRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="font-medium text-sm mb-1">{method.name}</div>
                    <div className="text-xs text-gray-600">{method.description}</div>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Pages Selector and Start Button */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="text-right">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pages to Scrape</label>
                  <Input 
                    type="number" 
                    value={maxPages}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow empty or partial input while typing
                      if (val === '') {
                        setMaxPages(1);
                        return;
                      }
                      const num = parseInt(val);
                      if (!isNaN(num)) {
                        setMaxPages(num);
                      }
                    }}
                    onBlur={(e) => {
                      // Validate on blur (when user finishes typing)
                      const num = parseInt(e.target.value);
                      if (isNaN(num) || num < 1) {
                        setMaxPages(1);
                      } else if (num > maxPagesAvailable) {
                        setMaxPages(maxPagesAvailable);
                      }
                    }}
                    min={1}
                    max={maxPagesAvailable}
                    disabled={isRunning}
                    className="w-28 text-center text-lg font-semibold"
                    placeholder={`1-${maxPagesAvailable}`}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Max: {maxPagesAvailable} pages
                    {progress.articlesDiscovered && progress.articlesDiscovered > 0 && (
                      <span className="text-green-600 ml-1">
                        (~{progress.articlesDiscovered.toLocaleString()} discovered)
                      </span>
                    )}
                  </p>
                </div>
                
                {!isRunning ? (
                  <ShimmerButton 
                    onClick={startScraping}
                    className="px-8 py-6 text-lg flex items-center gap-2"
                  >
                    <Play className="w-5 h-5" />
                    Start Scraping
                  </ShimmerButton>
                ) : (
                  <Button 
                    onClick={stopScraping}
                    variant="destructive"
                    className="px-8 py-6 text-lg flex items-center gap-2"
                  >
                    <Square className="w-5 h-5" />
                    Stop Scraping
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Single Article Scraper */}
        <Card className="p-6 border-2 border-purple-200 bg-purple-50">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600 rounded-lg">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900">Quick Single Article Scrape</h2>
                <p className="text-gray-600 text-sm">Scrape a specific EdgeProp article by URL</p>
              </div>
            </div>
            
            {/* Scraper Type Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Scraper Type</label>
              <Select value={scraperType} onValueChange={(value: 'mcp' | 'api') => setScraperType(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select scraper type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcp">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span>MCP Scraper</span>
                      <span className="text-xs text-gray-500">(Full content + metadata)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="api">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <span>API Scraper</span>
                      <span className="text-xs text-gray-500">(Metadata only)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  type="url"
                  placeholder="https://www.edgeprop.sg/property-news/..."
                  value={singleArticleUrl}
                  onChange={(e) => setSingleArticleUrl(e.target.value)}
                  disabled={isSingleScraping}
                  className="text-sm"
                />
                {singleArticleError && (
                  <p className="text-red-600 text-xs mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {singleArticleError}
                  </p>
                )}
              </div>
              <Button
                onClick={scrapeSingleArticle}
                disabled={isSingleScraping || !singleArticleUrl.trim()}
                className="px-6 flex items-center gap-2 bg-purple-600 hover:bg-purple-700"
              >
                {isSingleScraping ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scraping...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Scrape Article
                  </>
                )}
              </Button>
            </div>

            {singleArticleResult && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-green-800 font-medium text-sm">Article scraped successfully!</span>
                </div>
                <div className="text-sm text-gray-700">
                  <p className="font-medium">{singleArticleResult.title}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    By {singleArticleResult.author}
                    {singleArticleResult.word_count && singleArticleResult.reading_time_minutes && (
                      <> • {singleArticleResult.word_count} words • {singleArticleResult.reading_time_minutes} min read</>
                    )}
                    {singleArticleResult.description && !singleArticleResult.word_count && (
                      <> • {singleArticleResult.description.substring(0, 100)}...</>
                    )}
                  </p>
                  {singleArticleResult.category && singleArticleResult.category.length > 0 && (
                    <div className="mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {Array.isArray(singleArticleResult.category) ? singleArticleResult.category[0] : singleArticleResult.category}
                      </Badge>
                    </div>
                  )}
                  {singleArticleResult.note && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                      <span className="font-medium">Note:</span> {singleArticleResult.note}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Live Progress Dashboard */}
        {(isRunning || progress.currentPage > 0) && (
          <Card className="p-6 border-2 border-blue-300">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                {isRunning ? (
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                ) : progress.status === 'completed' ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                ) : progress.status === 'error' ? (
                  <XCircle className="w-5 h-5 text-red-600" />
                ) : (
                  <Pause className="w-5 h-5 text-gray-400" />
                )}
                <span>Live Progress</span>
              </h2>
              <Badge 
                variant={isRunning ? 'default' : progress.status === 'completed' ? 'default' : progress.status === 'error' ? 'destructive' : 'secondary'}
                className="text-sm px-4 py-1"
              >
                {isRunning ? 'RUNNING' : progress.status === 'completed' ? 'COMPLETED' : progress.status === 'error' ? 'ERROR' : 'IDLE'}
              </Badge>
            </div>

            {/* Progress Bar with Percentage */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Overall Progress</span>
                <span className="text-sm font-bold text-blue-600">{progressPercent.toFixed(1)}%</span>
              </div>
              <Progress value={progressPercent} className="h-4" />
              <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                <span>Page {progress.currentPage} of {progress.totalPages}</span>
                <span>{elapsedTime > 0 && `${formatTime(elapsedTime)} elapsed`}</span>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Hash className="w-4 h-4 text-blue-600" />
                  <div className="text-xs font-medium text-blue-700 uppercase tracking-wider">Current Page</div>
                </div>
                <div className="text-3xl font-bold text-blue-900">{progress.currentPage}</div>
                <div className="text-xs text-blue-600 mt-1">of {progress.totalPages} total</div>
              </div>
              
              <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-xl border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-green-600" />
                  <div className="text-xs font-medium text-green-700 uppercase tracking-wider">Articles Scraped</div>
                </div>
                <div className="text-3xl font-bold text-green-900">{progress.articlesScraped || 0}</div>
                <div className="text-xs text-green-600 mt-1">
                  {progress.articlesFailed ? `${progress.articlesFailed} failed` : 'with full content'}
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-purple-600" />
                  <div className="text-xs font-medium text-purple-700 uppercase tracking-wider">Time Elapsed</div>
                </div>
                <div className="text-3xl font-bold text-purple-900">{formatTime(elapsedTime)}</div>
                <div className="text-xs text-purple-600 mt-1">
                  {progress.totalPages > 0 && progress.currentPage > 0 && elapsedTime > 0 && (
                    `~${formatTime(Math.floor((elapsedTime / progress.currentPage) * (progress.totalPages - progress.currentPage)))} remaining`
                  )}
                </div>
              </div>
              
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-xl border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-orange-600" />
                  <div className="text-xs font-medium text-orange-700 uppercase tracking-wider">Speed</div>
                </div>
                <div className="text-3xl font-bold text-orange-900">
                  {elapsedTime > 0 && progress.currentPage > 0 ? 
                    `${(progress.currentPage / (elapsedTime / 60)).toFixed(1)}` : 
                    '0'}
                </div>
                <div className="text-xs text-orange-600 mt-1">pages/min</div>
              </div>
            </div>

            {/* Status Message */}
            {progress.message && (
              <div className="p-4 bg-blue-50 border-l-4 border-blue-500 rounded-r-lg">
                <div className="flex items-start gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-blue-900 text-sm">{progress.message}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Console Logs Section */}
            <div className="pt-4 border-t mt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Console Logs {showLogs && isRunning && <span className="text-green-500 text-xs">● Live</span>}
                  {showLogs && !isRunning && progress.status === 'completed' && <span className="text-gray-500 text-xs">● Completed</span>}
                </span>
                <Button
                  onClick={() => setShowLogs(!showLogs)}
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                >
                  {showLogs ? 'Hide Logs' : 'Show Logs'}
                </Button>
              </div>
              {showLogs && (
                <div 
                  ref={logsContainerRef}
                  className="bg-gray-900 p-4 rounded-lg font-mono text-xs overflow-auto max-h-96"
                  onScroll={() => {
                    // Track if user scrolled up
                    if (logsContainerRef.current) {
                      const isNearBottom = 
                        logsContainerRef.current.scrollHeight - logsContainerRef.current.scrollTop - logsContainerRef.current.clientHeight < 100;
                      shouldAutoScrollRef.current = isNearBottom;
                    }
                  }}
                >
                  {logs.length === 0 ? (
                    <div className="text-white">No logs yet. Logs will appear here as scraping progresses...</div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-white">
                      {logs.join('\n')}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Quick Actions */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button 
              onClick={() => exportData('json')} 
              variant="outline" 
              className="h-20 flex-col gap-2 hover:bg-blue-50 hover:border-blue-300 transition-all"
              disabled={articles.length === 0}
            >
              <FileJson className="w-6 h-6 text-blue-600" />
              <span className="font-medium">Export JSON</span>
            </Button>
            <Button 
              onClick={() => exportData('csv')} 
              variant="outline" 
              className="h-20 flex-col gap-2 hover:bg-green-50 hover:border-green-300 transition-all"
              disabled={articles.length === 0}
            >
              <FileSpreadsheet className="w-6 h-6 text-green-600" />
              <span className="font-medium">Export CSV</span>
            </Button>
            <Button 
              onClick={() => setActiveTab('library')} 
              variant="outline" 
              className="h-20 flex-col gap-2 hover:bg-purple-50 hover:border-purple-300 transition-all"
            >
              <Library className="w-6 h-6 text-purple-600" />
              <span className="font-medium">View Library</span>
            </Button>
            <Button 
              onClick={() => setActiveTab('history')} 
              variant="outline" 
              className="h-20 flex-col gap-2 hover:bg-orange-50 hover:border-orange-300 transition-all"
            >
              <History className="w-6 h-6 text-orange-600" />
              <span className="font-medium">View History</span>
            </Button>
          </div>
        </Card>
      </TabsContent>

      {/* TAB 2: Article Library */}
      <TabsContent value="library" className="space-y-6">
        {/* Search/Filter */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Search className="w-5 h-5" />
            <span>Search & Filter</span>
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Input 
                placeholder="Search articles by title or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="h-10"
              />
            </div>
            
            <div className="flex gap-2">
              <select 
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md h-10"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              
              <Button onClick={handleSearch} className="flex items-center gap-2">
                <Search className="w-4 h-4" />
                Search
              </Button>
            </div>
          </div>
        </Card>

        {/* Articles Table */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5" />
              <span>Articles ({totalArticles} total)</span>
            </h2>
            <Button onClick={refreshData} variant="outline" size="sm" className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Refresh
            </Button>
          </div>

          {articles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No articles yet. Start scraping to collect data.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Image</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Author</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scraped</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Count</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {articles.map((article) => {
                      const cats = Array.isArray(article.category) ? article.category : [article.category];
                      return (
                        <tr 
                          key={article.id} 
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => router.push(`/admin/articles/${article.id}`)}
                        >
                          <td className="px-4 py-3">
                            {article.thumbnail ? (
                              <img 
                                src={article.thumbnail} 
                                alt={article.title}
                                className="w-20 h-14 object-cover rounded"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2260%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%2260%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22 font-size=%2210%22%3ENo Image%3C/text%3E%3C/svg%3E';
                                }}
                              />
                            ) : (
                              <div className="w-20 h-14 bg-gray-100 rounded flex items-center justify-center">
                                <span className="text-gray-400 text-xs">No Image</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 max-w-md">{article.title}</div>
                            {article.description && article.description !== article.title && (
                              <div className="text-sm text-gray-500 mt-1">{article.description.substring(0, 100)}...</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {cats.map((cat, idx) => {
                                // Clean up messy concatenated categories
                                const cleanCat = cat.toString()
                                  .replace(/Tags:/gi, '')
                                  .replace(/PROPERTY NEWS/gi, 'Property News')
                                  .replace(/\s+/g, ' ')
                                  .trim();
                                
                                // Split concatenated categories that might be joined without separators
                                const subCats = cleanCat.split(/(?=[A-Z][a-z])/).filter((sub: string) => sub.trim().length > 0);
                                
                                return subCats.map((subCat: string, subIdx: number) => (
                                  <Badge key={`${idx}-${subIdx}`} variant="secondary" className="text-xs">
                                    {subCat.trim()}
                                  </Badge>
                                ));
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{article.author || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(article.first_scraped_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline">{article.scrape_count}x</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <a 
                              href={`https://www.edgeprop.sg${article.path?.toString().startsWith('/') ? '' : '/'}${article.path}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1"
                            >
                              <Globe className="w-3 h-3" />
                              View
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Page {currentPage} of {initialPages}
                </div>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => loadArticles(currentPage - 1, searchQuery, categoryFilter)}
                    disabled={currentPage === 1}
                    variant="outline"
                    size="sm"
                  >
                    Previous
                  </Button>
                  <Button 
                    onClick={() => loadArticles(currentPage + 1, searchQuery, categoryFilter)}
                    disabled={currentPage >= initialPages}
                    variant="outline"
                    size="sm"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </TabsContent>

      {/* TAB 3: Scrape History */}
      <TabsContent value="history" className="space-y-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <History className="w-5 h-5" />
              <span>Scrape History ({history.length} sessions)</span>
            </h2>
            <div className="flex gap-2">
              <Button onClick={refreshData} variant="outline" size="sm" className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Refresh
              </Button>
              {history.length > 0 && (
                <Button 
                  onClick={deleteAllHistory} 
                  variant="destructive" 
                  size="sm" 
                  className="flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Clear All
                </Button>
              )}
            </div>
          </div>

          {history.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No scrape history yet.
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((session) => (
                <div key={session.id} className="border rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Badge 
                        variant={
                          session.status === 'completed' ? 'default' :
                          session.status === 'running' ? 'default' :
                          session.status === 'error' ? 'destructive' : 'secondary'
                        }
                        className="flex items-center gap-1"
                      >
                        {session.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> : 
                         session.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : 
                         session.status === 'error' ? <XCircle className="w-3 h-3" /> : <Pause className="w-3 h-3" />} 
                        {session.status}
                      </Badge>
                      <span className="font-medium">{session.source}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">
                        {new Date(session.started_at).toLocaleString()}
                      </span>
                      <Button
                        onClick={() => deleteSession(session.id)}
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-800 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Pages:</span>
                      <span className="font-medium ml-1">{session.pages_scraped}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Articles:</span>
                      <span className="font-medium ml-1">{session.articles_scraped}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Unique:</span>
                      <span className="font-medium ml-1 text-green-600">{session.unique_articles}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Duplicates:</span>
                      <span className="font-medium ml-1 text-orange-600">{session.duplicates_found}</span>
                    </div>
                  </div>
                  
                  {session.error_message && (
                    <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                      {session.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </TabsContent>
    </Tabs>
  );
}

